import { SESSION_DELETE_DELAY_MS } from '../config';
import { DeviceActivation, Entitlement, VideoSession } from '../models';
import { now } from '../utils/clock';
import { AppError } from '../utils/errors';
import { newId } from '../utils/ids';
import { audit, auditSafe } from './auditService';
import { verifyChallengeProof, verifyTimestampProof } from './deviceProof';

type Reason = 'user_ended' | 'expired' | 'revoked' | 'admin_terminated' | 'start_failed';

interface SessionLike {
  _id: string;
  status: string;
  startedAt: Date;
  expiresAt: Date;
  endedAt?: Date | null;
  terminationReason?: string | null;
}

function view(s: SessionLike, extra: Record<string, unknown> = {}) {
  const t = now();
  const remaining = s.status === 'active' ? Math.max(0, Math.ceil((s.expiresAt.getTime() - t.getTime()) / 1000)) : 0;
  return {
    sessionId: s._id,
    status: s.status,
    startedAt: s.startedAt,
    expiresAt: s.expiresAt,
    endedAt: s.endedAt ?? undefined,
    terminationReason: s.terminationReason ?? undefined,
    serverTime: t, // the client derives its countdown from this, never from its own clock alone
    remainingSeconds: remaining,
    ...extra,
  };
}

/**
 * Idempotent terminal transition. Sets deleteAt = endedAt + 5 minutes.
 * Expiry is recorded at the authorized expiresAt so late detection never extends or shortens usage.
 */
export async function terminateSession(sessionId: string, reason: Reason) {
  const current = await VideoSession.findById(sessionId);
  if (!current) return null;
  if (current.status === 'ended') return current;

  const endedAt = reason === 'expired' ? current.expiresAt : now();
  const ended = await VideoSession.findOneAndUpdate(
    { _id: sessionId, status: 'active' },
    { $set: { status: 'ended', endedAt, deleteAt: new Date(endedAt.getTime() + SESSION_DELETE_DELAY_MS), terminationReason: reason } },
    { new: true },
  );
  if (ended) {
    await audit({ actor: { type: 'system' }, action: 'session.ended', targetType: 'VideoSession', targetId: sessionId, metadata: { reason, entitlementId: ended.entitlementId } });
  }
  return ended ?? (await VideoSession.findById(sessionId));
}

export async function startSession(args: {
  entitlementId: string;
  proof: { publicKey: string; challenge: string; signature: string };
  diagnostics?: { appVersion?: string; os?: string };
}) {
  const { fingerprint } = await verifyChallengeProof({ purpose: 'session:start', context: args.entitlementId, ...args.proof });

  const ent = await Entitlement.findById(args.entitlementId);
  if (!ent) throw new AppError(404, 'ENTITLEMENT_NOT_FOUND', 'Entitlement not found.');
  if (ent.status !== 'active') throw new AppError(403, 'ENTITLEMENT_REVOKED', 'This purchase is no longer active.');
  if (ent.binding.state !== 'bound') throw new AppError(409, 'NOT_ACTIVATED', 'Activate this device first.');
  if (ent.binding.deviceFingerprint !== fingerprint) {
    await auditSafe({ actor: { type: 'device', id: fingerprint }, action: 'session.start.device_mismatch', targetType: 'Entitlement', targetId: ent._id, severity: 'security' });
    throw new AppError(403, 'DEVICE_MISMATCH', 'This device is not the activated device.');
  }
  const activation = await DeviceActivation.findOne({ entitlementId: ent._id, status: 'active', fingerprint });
  if (!activation) throw new AppError(403, 'ACTIVATION_INVALID', 'Device activation is not valid.');

  const startedAt = now();
  const sessionId = newId('ses');

  // The single atomic step that spends the entitlement. Exactly one caller can win it.
  const consumed = await Entitlement.findOneAndUpdate(
    { _id: ent._id, status: 'active', 'binding.state': 'bound', 'binding.deviceFingerprint': fingerprint, 'session.consumed': false },
    { $set: { 'session.consumed': true, 'session.consumedAt': startedAt, 'session.sessionId': sessionId } },
    { new: true },
  );

  if (!consumed) return resumeOrReject(ent._id, fingerprint);

  const expiresAt = new Date(startedAt.getTime() + consumed.session.seconds * 1000);
  try {
    const session = await VideoSession.create({
      _id: sessionId,
      entitlementId: ent._id,
      deviceActivationId: activation._id,
      deviceFingerprint: fingerprint,
      startedAt,
      expiresAt,
      lastHeartbeatAt: startedAt,
      diagnostics: args.diagnostics,
    });
    await audit({ actor: { type: 'device', id: fingerprint }, action: 'entitlement.consumed', targetType: 'Entitlement', targetId: ent._id, metadata: { sessionId } });
    return view(session, { resumed: false });
  } catch (e) {
    // Never reset the entitlement. The orphan reconciler records this and support handles it explicitly.
    await auditSafe({ actor: { type: 'system' }, action: 'session.create_failed_after_consume', targetType: 'Entitlement', targetId: ent._id, severity: 'security', metadata: { sessionId, error: String(e) } });
    throw new AppError(500, 'SESSION_CREATE_FAILED', 'Session could not be started. Contact support.');
  }
}

async function resumeOrReject(entitlementId: string, fingerprint: string) {
  // A concurrent winner may not have written its session yet. Give it a moment.
  for (let i = 0; i < 6; i++) {
    const existing = await VideoSession.findOne({ entitlementId, status: 'active', deviceFingerprint: fingerprint });
    if (existing) {
      if (existing.expiresAt.getTime() > now().getTime()) return view(existing, { resumed: true });
      await terminateSession(existing._id, 'expired');
      break;
    }
    const ent = await Entitlement.findById(entitlementId);
    if (!ent?.session.consumed) break;
    if (ent.session.consumedAt && now().getTime() - ent.session.consumedAt.getTime() > 3000) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new AppError(409, 'ENTITLEMENT_CONSUMED', 'This purchase’s session has already been used. A new purchase is required.');
}

/** Loads the session and verifies the device signature using the key stored at activation. */
async function authorize(sessionId: string, action: string, ts: string | undefined, signature: string | undefined) {
  const session = await VideoSession.findById(sessionId);
  if (!session) throw new AppError(404, 'SESSION_NOT_FOUND', 'Session not found.');
  const activation = await DeviceActivation.findById(session.deviceActivationId);
  if (!activation || !ts || !signature) throw new AppError(401, 'UNAUTHORIZED_DEVICE', 'Device proof required.');
  verifyTimestampProof({ publicKey: activation.publicKey, action, subject: sessionId, ts, signature });
  return { session, activation };
}

export async function getSession(sessionId: string, ts?: string, signature?: string) {
  const { session } = await authorize(sessionId, 'session:get', ts, signature);
  if (session.status === 'active' && session.expiresAt.getTime() <= now().getTime()) {
    return view((await terminateSession(session._id, 'expired'))!);
  }
  return view(session);
}

export async function heartbeat(sessionId: string, ts?: string, signature?: string) {
  const { session, activation } = await authorize(sessionId, 'session:heartbeat', ts, signature);
  if (session.status === 'ended') throw new AppError(409, 'SESSION_ENDED', 'Session has ended.', view(session));

  if (session.expiresAt.getTime() <= now().getTime()) {
    const ended = await terminateSession(session._id, 'expired');
    throw new AppError(410, 'SESSION_EXPIRED', 'Session time is up.', view(ended!));
  }
  const ent = await Entitlement.findById(session.entitlementId);
  if (!ent || ent.status !== 'active' || activation.status !== 'active') {
    const ended = await terminateSession(session._id, 'revoked');
    throw new AppError(403, 'SESSION_REVOKED', 'Session is no longer authorized.', view(ended!));
  }
  // Only the heartbeat timestamp changes. expiresAt is immutable.
  await VideoSession.updateOne({ _id: session._id, status: 'active' }, { $set: { lastHeartbeatAt: now() } });
  return view(session);
}

export async function endSession(sessionId: string, ts?: string, signature?: string) {
  const { session } = await authorize(sessionId, 'session:end', ts, signature);
  const reason: Reason = session.expiresAt.getTime() <= now().getTime() ? 'expired' : 'user_ended';
  const ended = await terminateSession(session._id, reason);
  return view(ended!);
}
