import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Entitlement, VideoSession } from '../models';
import { endSession, getSession, heartbeat, startSession } from '../services/sessionService';
import { setClock } from '../utils/clock';
import { activatedEntitlement, connectDb, makeDevice, resetDb, seedProduct } from './helpers';

beforeAll(connectDb);
beforeEach(async () => {
  await resetDb();
  await seedProduct();
});

const start = (d: ReturnType<typeof makeDevice>, entitlementId: string) =>
  startSession({ entitlementId, proof: d.proof('session:start', entitlementId) });

describe('session consumption', () => {
  it('starts with a server-set 900 second expiry and consumes the entitlement', async () => {
    const { entitlementId, device } = await activatedEntitlement();
    const s = await start(device, entitlementId);
    expect(s.expiresAt.getTime() - s.startedAt.getTime()).toBe(900_000);
    expect(s.remainingSeconds).toBeGreaterThan(895);
    const ent = await Entitlement.findById(entitlementId);
    expect(ent!.session.consumed).toBe(true);
    expect(ent!.session.sessionId).toBe(s.sessionId);
  });

  it('creates exactly one session when starts race', async () => {
    const { entitlementId, device } = await activatedEntitlement();
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => start(device, entitlementId)));
    expect(await VideoSession.countDocuments({ entitlementId })).toBe(1);
    const ids = new Set(results.filter((r) => r.status === 'fulfilled').map((r) => (r as PromiseFulfilledResult<{ sessionId: string }>).value.sessionId));
    expect(ids.size).toBe(1); // everyone who succeeded got the same session
  });

  it('resumes the same session with the original expiry after an app restart', async () => {
    const { entitlementId, device } = await activatedEntitlement();
    const first = await start(device, entitlementId);
    const again = await start(device, entitlementId);
    expect(again.sessionId).toBe(first.sessionId);
    expect(again.expiresAt.getTime()).toBe(first.expiresAt.getTime());
    expect(again.resumed).toBe(true);
  });

  it('refuses a second session after the first has ended', async () => {
    const { entitlementId, device } = await activatedEntitlement();
    const s = await start(device, entitlementId);
    await endSession(s.sessionId, ...Object.values(device.headers('session:end', s.sessionId)) as [string, string]);
    await expect(start(device, entitlementId)).rejects.toMatchObject({ code: 'ENTITLEMENT_CONSUMED' });
  });

  it('refuses a device that is not the bound one', async () => {
    const { entitlementId } = await activatedEntitlement();
    const other = makeDevice();
    await expect(start(other, entitlementId)).rejects.toMatchObject({ code: 'DEVICE_MISMATCH' });
    expect((await Entitlement.findById(entitlementId))!.session.consumed).toBe(false);
  });

  it('heartbeat never extends expiresAt', async () => {
    const { entitlementId, device } = await activatedEntitlement();
    const s = await start(device, entitlementId);
    const h = device.headers('session:heartbeat', s.sessionId);
    const beat = await heartbeat(s.sessionId, h.ts, h.signature);
    expect(beat.expiresAt.getTime()).toBe(s.expiresAt.getTime());
    expect((await VideoSession.findById(s.sessionId))!.expiresAt.getTime()).toBe(s.expiresAt.getTime());
  });

  it('enforces expiry on the server even if the client keeps going', async () => {
    const { entitlementId, device } = await activatedEntitlement();
    const s = await start(device, entitlementId);
    const later = s.expiresAt.getTime() + 5_000;
    setClock(() => new Date(later));
    const h = device.headers('session:heartbeat', s.sessionId, later);
    await expect(heartbeat(s.sessionId, h.ts, h.signature)).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
    const doc = await VideoSession.findById(s.sessionId);
    expect(doc!.status).toBe('ended');
    expect(doc!.endedAt!.getTime()).toBe(s.expiresAt.getTime());
    await expect(start(device, entitlementId)).rejects.toMatchObject({ code: 'ENTITLEMENT_CONSUMED' });
  });

  it('rejects requests with a forged or stale device signature', async () => {
    const { entitlementId, device } = await activatedEntitlement();
    const s = await start(device, entitlementId);
    const intruder = makeDevice().headers('session:heartbeat', s.sessionId);
    await expect(heartbeat(s.sessionId, intruder.ts, intruder.signature)).rejects.toMatchObject({ code: 'INVALID_SIGNATURE' });
    const stale = device.headers('session:heartbeat', s.sessionId, Date.now() - 10 * 60_000);
    await expect(heartbeat(s.sessionId, stale.ts, stale.signature)).rejects.toMatchObject({ code: 'STALE_REQUEST' });
    await expect(getSession(s.sessionId)).rejects.toMatchObject({ code: 'UNAUTHORIZED_DEVICE' });
  });
});
