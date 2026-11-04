import mongoose from 'mongoose';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { reapExpiredSessions, verifyTtlIndex } from '../jobs/maintenance';
import { AuditLog, DeviceActivation, Entitlement, Order, Payment, VideoSession } from '../models';
import { endSession, startSession } from '../services/sessionService';
import { setClock } from '../utils/clock';
import { activatedEntitlement, connectDb, resetDb, seedProduct } from './helpers';

beforeAll(connectDb);
beforeEach(async () => {
  await resetDb();
  await seedProduct();
});

async function waitUntil(check: () => Promise<boolean>, timeoutMs: number) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

/**
 * Runs against a real mongod (test instance started with ttlMonitorSleepSecs=1).
 * Production TTL monitoring runs about every 60 s, so real deletion is always "eventually".
 */
describe('TTL cleanup against a real MongoDB', () => {
  it('eventually deletes an ended session, and only that, leaving every durable record intact', async () => {
    const { entitlementId, device, order } = await activatedEntitlement();
    const s = await startSession({ entitlementId, proof: device.proof('session:start', entitlementId) });

    // Active sessions have no deleteAt, so the TTL monitor can never touch them.
    await new Promise((r) => setTimeout(r, 2500));
    expect(await VideoSession.exists({ _id: s.sessionId })).not.toBeNull();

    const h = device.headers('session:end', s.sessionId);
    await endSession(s.sessionId, h.ts, h.signature);
    expect((await VideoSession.findById(s.sessionId))!.deleteAt).toBeDefined();

    // Real deletion is exercised by moving deleteAt into the past (the 5 minute delay itself is covered
    // by the unit-level assertions). The TTL monitor, not application code, removes the document.
    await VideoSession.collection.updateOne({ _id: s.sessionId as never }, { $set: { deleteAt: new Date(Date.now() - 1000) } });
    const gone = await waitUntil(async () => (await VideoSession.exists({ _id: s.sessionId })) === null, 45_000);
    expect(gone).toBe(true);

    const ent = await Entitlement.findById(entitlementId);
    expect(ent!.session.consumed).toBe(true);
    expect(await Order.findById(order._id)).not.toBeNull();
    expect(await Payment.countDocuments()).toBe(1);
    expect(await DeviceActivation.countDocuments({ entitlementId, status: 'active' })).toBe(1);
    expect(await AuditLog.countDocuments({ action: 'payment.verified' })).toBe(1);
    await expect(startSession({ entitlementId, proof: device.proof('session:start', entitlementId) })).rejects.toMatchObject({ code: 'ENTITLEMENT_CONSUMED' });
  }, 90_000);

  it('detects a missing TTL index and repairs it', async () => {
    await VideoSession.collection.dropIndex('deleteAt_1');
    expect((await VideoSession.collection.indexes()).some((i) => i.key?.deleteAt === 1)).toBe(false);
    expect(await verifyTtlIndex()).toBe(true);
    expect((await VideoSession.collection.indexes()).find((i) => i.key?.deleteAt === 1)?.expireAfterSeconds).toBe(0);
    expect(await AuditLog.countDocuments({ action: 'security.ttl_index_missing' })).toBe(1);
  });

  it('keeps working after a backend restart (all cleanup state lives in the database)', async () => {
    const { entitlementId, device } = await activatedEntitlement();
    const s = await startSession({ entitlementId, proof: device.proof('session:start', entitlementId) });

    await mongoose.disconnect(); // "restart"
    await connectDb();

    setClock(() => new Date(s.expiresAt.getTime() + 10_000));
    expect(await reapExpiredSessions()).toBe(1);
    const doc = await VideoSession.findById(s.sessionId);
    expect(doc!.status).toBe('ended');
    expect(doc!.deleteAt!.getTime() - doc!.endedAt!.getTime()).toBe(5 * 60_000);
    expect(await verifyTtlIndex()).toBe(true);
  });
});
