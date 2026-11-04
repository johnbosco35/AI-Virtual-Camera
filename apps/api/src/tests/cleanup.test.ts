import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Entitlement, Order, Payment, VideoSession } from '../models';
import { reapExpiredSessions, reconcileOrphanedConsumptions, verifyTtlIndex } from '../jobs/maintenance';
import { endSession, startSession, terminateSession } from '../services/sessionService';
import { setClock } from '../utils/clock';
import { activatedEntitlement, connectDb, resetDb, seedProduct } from './helpers';

beforeAll(connectDb);
beforeEach(async () => {
  await resetDb();
  await seedProduct();
});

const FIVE_MIN = 5 * 60_000;

describe('session cleanup and retention', () => {
  it('has the TTL index on deleteAt with expireAfterSeconds 0', async () => {
    expect(await verifyTtlIndex()).toBe(true);
    const idx = await VideoSession.collection.indexes();
    expect(idx.find((i) => i.key?.deleteAt === 1)?.expireAfterSeconds).toBe(0);
  });

  it('never gives an active session a deleteAt', async () => {
    const { entitlementId, device } = await activatedEntitlement();
    const s = await startSession({ entitlementId, proof: device.proof('session:start', entitlementId) });
    expect((await VideoSession.findById(s.sessionId))!.deleteAt).toBeUndefined();
  });

  it('schedules deletion exactly five minutes after the server-recorded end, and ending is idempotent', async () => {
    const { entitlementId, device } = await activatedEntitlement();
    const s = await startSession({ entitlementId, proof: device.proof('session:start', entitlementId) });
    const h = device.headers('session:end', s.sessionId);
    await endSession(s.sessionId, h.ts, h.signature);
    const first = (await VideoSession.findById(s.sessionId))!;
    expect(first.status).toBe('ended');
    expect(first.deleteAt!.getTime() - first.endedAt!.getTime()).toBe(FIVE_MIN);

    const h2 = device.headers('session:end', s.sessionId);
    await endSession(s.sessionId, h2.ts, h2.signature);
    const second = (await VideoSession.findById(s.sessionId))!;
    expect(second.endedAt!.getTime()).toBe(first.endedAt!.getTime());
    expect(second.deleteAt!.getTime()).toBe(first.deleteAt!.getTime());
  });

  it('reaper terminates abandoned sessions at their original expiry', async () => {
    const { entitlementId, device } = await activatedEntitlement();
    const s = await startSession({ entitlementId, proof: device.proof('session:start', entitlementId) });
    setClock(() => new Date(s.expiresAt.getTime() + 30_000));
    expect(await reapExpiredSessions()).toBe(1);
    const doc = (await VideoSession.findById(s.sessionId))!;
    expect(doc.terminationReason).toBe('expired');
    expect(doc.endedAt!.getTime()).toBe(s.expiresAt.getTime());
    expect(doc.deleteAt!.getTime()).toBe(s.expiresAt.getTime() + FIVE_MIN);
    expect(await reapExpiredSessions()).toBe(0);
  });

  it('deleting the session record never restores the entitlement', async () => {
    const { entitlementId, device, order } = await activatedEntitlement();
    const s = await startSession({ entitlementId, proof: device.proof('session:start', entitlementId) });
    await terminateSession(s.sessionId, 'user_ended');
    await VideoSession.deleteMany({}); // what TTL cleanup eventually does

    const ent = await Entitlement.findById(entitlementId);
    expect(ent!.session.consumed).toBe(true);
    await expect(startSession({ entitlementId, proof: device.proof('session:start', entitlementId) })).rejects.toMatchObject({ code: 'ENTITLEMENT_CONSUMED' });

    // Durable records untouched.
    expect(await Order.findById(order._id)).not.toBeNull();
    expect(await Payment.countDocuments()).toBe(1);
  });

  it('records an orphaned consumption without handing the session back', async () => {
    const { entitlementId, device } = await activatedEntitlement();
    const s = await startSession({ entitlementId, proof: device.proof('session:start', entitlementId) });
    await VideoSession.deleteMany({}); // simulate creation failing after consumption
    setClock(() => new Date(Date.now() + 60_000));
    expect(await reconcileOrphanedConsumptions()).toBe(1);

    const rec = await VideoSession.findById(s.sessionId);
    expect(rec!.terminationReason).toBe('start_failed');
    expect((await Entitlement.findById(entitlementId))!.session.consumed).toBe(true);
  });
});
