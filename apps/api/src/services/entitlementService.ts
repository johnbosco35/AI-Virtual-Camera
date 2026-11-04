import { Entitlement, DeviceActivation, VideoSession, Product } from '../models';
import { activationCodeFor, activationCodeHash } from '../utils/crypto';
import { now } from '../utils/clock';
import { AppError, isDuplicateKeyError } from '../utils/errors';
import { newId } from '../utils/ids';
import { audit, type Actor } from './auditService';
import { terminateSession } from './sessionService';

/** Idempotent: at most one entitlement per order, enforced by a unique index. */
export async function ensureEntitlement(order: { _id: string; productId: string }) {
  const product = await Product.findById(order.productId);
  const id = newId('ent');
  const doc = {
    _id: id,
    productId: order.productId,
    activationCodeHash: activationCodeHash(activationCodeFor(id)),
    session: {
      allowance: product?.entitlementConfig?.sessionAllowance ?? 1,
      seconds: product?.entitlementConfig?.sessionSeconds ?? 900,
      consumed: false,
    },
  };
  try {
    const ent = await Entitlement.findOneAndUpdate({ orderId: order._id }, { $setOnInsert: doc }, { upsert: true, new: true });
    if (ent._id === id) {
      await audit({ actor: { type: 'system' }, action: 'entitlement.created', targetType: 'Entitlement', targetId: id, metadata: { orderId: order._id } });
    }
    return ent;
  } catch (e) {
    if (!isDuplicateKeyError(e)) throw e;
    const existing = await Entitlement.findOne({ orderId: order._id }); // lost the upsert race
    if (!existing) throw e;
    return existing;
  }
}

export async function getEntitlementView(entitlementId: string, activationCode: string | undefined) {
  const ent = await Entitlement.findById(entitlementId);
  // Same error for missing and wrong code so ids cannot be probed.
  if (!ent || !activationCode || ent.activationCodeHash !== activationCodeHash(activationCode)) {
    throw new AppError(404, 'ENTITLEMENT_NOT_FOUND', 'Entitlement not found.');
  }
  return {
    entitlementId: ent._id,
    status: ent.status,
    bound: ent.binding.state === 'bound',
    sessionConsumed: ent.session.consumed,
    sessionSeconds: ent.session.seconds,
  };
}

export async function revokeEntitlement(entitlementId: string, reason: string, actor: Actor) {
  const ent = await Entitlement.findOneAndUpdate(
    { _id: entitlementId, status: 'active' },
    { $set: { status: 'revoked', revocation: { revokedAt: now(), reason, by: actor.id } } },
    { new: true },
  );
  if (!ent) throw new AppError(404, 'ENTITLEMENT_NOT_REVOCABLE', 'Entitlement not found or already revoked.');
  await DeviceActivation.updateMany({ entitlementId, status: 'active' }, { $set: { status: 'revoked', revokedAt: now(), revokeReason: reason } });
  const live = await VideoSession.find({ entitlementId, status: 'active' }, { _id: 1 });
  for (const s of live) await terminateSession(s._id, 'revoked');
  await audit({ actor, action: 'entitlement.revoked', targetType: 'Entitlement', targetId: entitlementId, severity: 'warn', metadata: { reason } });
  return ent;
}

/**
 * Admin-only device recovery (lost key, new computer for the same purchase after verification by support).
 * Never grants another session: refused once the session has been consumed.
 */
export async function recoverDevice(entitlementId: string, reason: string, actor: Actor) {
  const ent = await Entitlement.findOneAndUpdate(
    { _id: entitlementId, status: 'active', 'binding.state': 'bound', 'session.consumed': false },
    {
      $set: { 'binding.state': 'unbound', 'binding.deviceFingerprint': null, 'binding.deviceActivationId': null },
      $inc: { 'binding.recoveryCount': 1 },
      $push: { 'binding.recoveries': { at: now(), by: actor.id, reason } },
    },
    { new: true },
  );
  if (!ent) {
    throw new AppError(409, 'RECOVERY_NOT_ALLOWED', 'Recovery needs an active, bound entitlement whose session is unused.');
  }
  await DeviceActivation.updateMany(
    { entitlementId, status: 'active' },
    { $set: { status: 'superseded', revokedAt: now(), revokeReason: `recovery: ${reason}` } },
  );
  await audit({ actor, action: 'activation.recovered', targetType: 'Entitlement', targetId: entitlementId, severity: 'warn', metadata: { reason } });
  return ent;
}
