import { DeviceActivation, Entitlement } from '../models';
import { activationCodeHash, normalizeActivationCode } from '../utils/crypto';
import { now } from '../utils/clock';
import { AppError, isDuplicateKeyError } from '../utils/errors';
import { audit, auditSafe } from './auditService';
import { verifyChallengeProof } from './deviceProof';

interface Proof {
  publicKey: string;
  challenge: string;
  signature: string;
}

/**
 * Binds an entitlement to one device key. Idempotent for the same key (this is also the
 * reinstall path: the original device proves itself with the same key). A different key is
 * always refused; moving devices needs support (admin recovery) or a new purchase.
 */
export async function activate(args: { activationCode: string; proof: Proof }) {
  const code = normalizeActivationCode(args.activationCode);
  const { fingerprint } = await verifyChallengeProof({ purpose: 'activate', context: code, ...args.proof });

  const ent = await Entitlement.findOne({ activationCodeHash: activationCodeHash(code) });
  if (!ent) {
    await auditSafe({ actor: { type: 'device', id: fingerprint }, action: 'activation.unknown_code', severity: 'warn' });
    throw new AppError(404, 'INVALID_ACTIVATION_CODE', 'Activation code not recognized.');
  }
  if (ent.status !== 'active') throw new AppError(403, 'ENTITLEMENT_REVOKED', 'This purchase is no longer active.');

  const mismatch = async () => {
    await auditSafe({ actor: { type: 'device', id: fingerprint }, action: 'activation.device_mismatch', targetType: 'Entitlement', targetId: ent._id, severity: 'security' });
    return new AppError(409, 'DEVICE_MISMATCH', 'This purchase is already activated on another device. Another device needs a new purchase.');
  };

  let act = await DeviceActivation.findOne({ entitlementId: ent._id, status: 'active' });
  if (act && act.fingerprint !== fingerprint) throw await mismatch();
  if (!act) {
    try {
      act = await DeviceActivation.create({ entitlementId: ent._id, publicKey: args.proof.publicKey, fingerprint, activatedAt: now(), lastVerifiedAt: now() });
    } catch (e) {
      if (!isDuplicateKeyError(e)) throw e;
      act = await DeviceActivation.findOne({ entitlementId: ent._id, status: 'active' });
      if (!act || act.fingerprint !== fingerprint) throw await mismatch();
    }
  }

  const bound = await Entitlement.findOneAndUpdate(
    { _id: ent._id, 'binding.state': 'unbound' },
    { $set: { 'binding.state': 'bound', 'binding.deviceFingerprint': fingerprint, 'binding.deviceActivationId': act._id, 'binding.activatedAt': now() } },
    { new: true },
  );
  const current = bound ?? (await Entitlement.findById(ent._id));
  if (!current || current.binding.deviceFingerprint !== fingerprint) throw await mismatch();

  if (bound) {
    await audit({ actor: { type: 'device', id: fingerprint }, action: 'activation.bound', targetType: 'Entitlement', targetId: ent._id });
  } else {
    await DeviceActivation.updateOne({ _id: act._id }, { $set: { lastVerifiedAt: now() } });
  }
  return viewFor(current);
}

/** Lets the app confirm on launch that this device is still the bound one and what state the session is in. */
export async function verifyActivation(args: { activationCode: string; proof: Proof }) {
  const code = normalizeActivationCode(args.activationCode);
  const { fingerprint } = await verifyChallengeProof({ purpose: 'activation:verify', context: code, ...args.proof });
  const ent = await Entitlement.findOne({ activationCodeHash: activationCodeHash(code) });
  if (!ent || ent.binding.deviceFingerprint !== fingerprint) throw new AppError(403, 'DEVICE_NOT_BOUND', 'This device is not activated for that code.');
  if (ent.status !== 'active') throw new AppError(403, 'ENTITLEMENT_REVOKED', 'This purchase is no longer active.');
  await DeviceActivation.updateOne({ entitlementId: ent._id, status: 'active' }, { $set: { lastVerifiedAt: now() } });
  return viewFor(ent);
}

function viewFor(ent: { _id: string; status: string; session: { consumed: boolean; seconds: number } }) {
  return { entitlementId: ent._id, status: ent.status, bound: true, sessionConsumed: ent.session.consumed, sessionSeconds: ent.session.seconds };
}
