import { SESSION_DELETE_DELAY_MS, logger } from '../config';
import { Entitlement, VideoSession } from '../models';
import { auditSafe } from '../services/auditService';
import { reconcilePayments } from '../services/paymentService';
import { terminateSession } from '../services/sessionService';
import { now } from '../utils/clock';

/** Backend time enforces expiry. This only closes records for clients that vanished. */
export async function reapExpiredSessions(): Promise<number> {
  const due = await VideoSession.find({ status: 'active', expiresAt: { $lte: now() } }, { _id: 1 }).limit(500);
  for (const s of due) await terminateSession(s._id, 'expired');
  return due.length;
}

/**
 * An entitlement that was consumed but has no session record, within the window where a record
 * must still exist (before TTL could have removed it), means session creation failed after consumption.
 * We record it and keep the entitlement consumed. We never hand the session back automatically.
 */
export async function reconcileOrphanedConsumptions(): Promise<number> {
  const t = now();
  const candidates = await Entitlement.find({
    'session.consumed': true,
    'session.consumedAt': { $lte: new Date(t.getTime() - 30_000), $gte: new Date(t.getTime() - SESSION_DELETE_DELAY_MS) },
  });
  let found = 0;
  for (const ent of candidates) {
    if (!ent.session.sessionId || (await VideoSession.exists({ _id: ent.session.sessionId }))) continue;
    await VideoSession.create({
      _id: ent.session.sessionId,
      entitlementId: ent._id,
      deviceActivationId: ent.binding.deviceActivationId ?? 'unknown',
      deviceFingerprint: ent.binding.deviceFingerprint ?? 'unknown',
      status: 'ended',
      startedAt: ent.session.consumedAt!,
      expiresAt: ent.session.consumedAt!,
      endedAt: t,
      deleteAt: new Date(t.getTime() + SESSION_DELETE_DELAY_MS),
      terminationReason: 'start_failed',
    });
    await auditSafe({ actor: { type: 'system' }, action: 'session.orphan_recorded', targetType: 'Entitlement', targetId: ent._id, severity: 'security' });
    found++;
  }
  return found;
}

/** Detects a missing or wrong TTL index and tries to create it. Cleanup is never relied on for access control. */
export async function verifyTtlIndex(): Promise<boolean> {
  const ok = async () => (await VideoSession.collection.indexes()).some((i) => i.key?.deleteAt === 1 && i.expireAfterSeconds === 0);
  if (await ok().catch(() => false)) return true;
  logger.error('VideoSession TTL index missing; creating it');
  await auditSafe({ actor: { type: 'system' }, action: 'security.ttl_index_missing', severity: 'security' });
  await VideoSession.createIndexes().catch((e) => logger.error({ err: e }, 'TTL index creation failed'));
  const fixed = await ok().catch(() => false);
  if (!fixed) logger.fatal('VideoSession TTL index could not be created. ALERT.');
  return fixed;
}

export function startJobs(): () => void {
  const safe = (name: string, fn: () => Promise<unknown>) => () =>
    fn().catch((err) => logger.error({ err, job: name }, 'job failed'));
  const timers = [
    setInterval(safe('reapExpiredSessions', reapExpiredSessions), 15_000),
    setInterval(safe('reconcileOrphans', reconcileOrphanedConsumptions), 60_000),
    setInterval(safe('reconcilePayments', () => reconcilePayments()), 30_000),
    setInterval(safe('verifyTtlIndex', verifyTtlIndex), 10 * 60_000),
  ];
  return () => timers.forEach(clearInterval);
}
