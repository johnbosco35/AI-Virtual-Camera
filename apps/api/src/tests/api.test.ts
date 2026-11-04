import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { Admin, AuditLog, Entitlement, Order } from '../models';
import { hashPassword } from '../services/adminAuthService';
import { setTronProvider } from '../services/tron/registry';
import { connectDb, hash, paidEntitlement, resetDb, seedProduct, StubProvider } from './helpers';

const app = createApp();
const PW = 'correct-horse-battery-1';

async function makeAdmin(email: string, role: 'superadmin' | 'operator' | 'support') {
  await Admin.create({ email, role, passwordHash: await hashPassword(PW) });
}
async function tokenFor(email: string) {
  const res = await request(app).post('/api/admin/auth/login').send({ email, password: PW });
  expect(res.status).toBe(200);
  return res.body.token as string;
}

beforeAll(connectDb);
beforeEach(async () => {
  await resetDb();
  await seedProduct();
});

describe('API validation and error handling', () => {
  it('returns a uniform 400 for invalid bodies', async () => {
    const a = await request(app).post('/api/orders').send({});
    expect(a.status).toBe(400);
    expect(a.body.error.code).toBe('VALIDATION_ERROR');

    const b = await request(app).post('/api/payments/verify').send({ orderId: 'ord_abcdefgh', txHash: 'nothex' });
    expect(b.status).toBe(400);
  });

  it('returns 404 shapes for unknown routes and unknown orders', async () => {
    expect((await request(app).get('/api/nope')).body.error.code).toBe('NOT_FOUND');
    expect((await request(app).get('/api/orders/ord_doesnotexist1')).body.error.code).toBe('ORDER_NOT_FOUND');
  });

  it('never trusts a client-supplied price when creating an order', async () => {
    const res = await request(app).post('/api/orders').send({ productId: 'avc-standard', price: '0.01', expectedAmount: '1' });
    expect(res.status).toBe(201);
    expect(BigInt(res.body.expectedAmountBaseUnits)).toBeGreaterThanOrEqual(25_000_000n);
    expect(BigInt(res.body.expectedAmountBaseUnits)).toBeLessThan(25_010_000n);
  });

  it('does not reveal an entitlement without its activation code', async () => {
    const { entitlementId, code } = await paidEntitlement();
    expect((await request(app).get(`/api/entitlements/${entitlementId}`)).status).toBe(404);
    expect((await request(app).get(`/api/entitlements/${entitlementId}`).set('x-activation-code', 'AAAA-AAAA-AAAA-AAAA')).status).toBe(404);
    const ok = await request(app).get(`/api/entitlements/${entitlementId}`).set('x-activation-code', code);
    expect(ok.status).toBe(200);
    expect(ok.body.sessionConsumed).toBe(false);
  });

  it('refuses downloads until the order is paid', async () => {
    const created = await request(app).post('/api/orders').send({ productId: 'avc-standard' });
    const res = await request(app).post('/api/downloads').send({ orderId: created.body.orderId });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('NOT_ENTITLED');
  });
});

describe('administrator authentication and permissions', () => {
  it('requires a token and rejects garbage tokens', async () => {
    expect((await request(app).get('/api/admin/orders')).status).toBe(401);
    expect((await request(app).get('/api/admin/orders').set('authorization', 'Bearer not.a.token')).status).toBe(401);
  });

  it('locks the account after repeated failures', async () => {
    await makeAdmin('lock@example.com', 'support');
    for (let i = 0; i < 5; i++) {
      expect((await request(app).post('/api/admin/auth/login').send({ email: 'lock@example.com', password: 'wrong-password-x' })).status).toBe(401);
    }
    const locked = await request(app).post('/api/admin/auth/login').send({ email: 'lock@example.com', password: PW });
    expect(locked.status).toBe(429);
    expect(locked.body.error.code).toBe('ACCOUNT_LOCKED');
  });

  it('enforces role permissions and audits the sensitive action', async () => {
    await makeAdmin('support@example.com', 'support');
    await makeAdmin('operator@example.com', 'operator');
    await makeAdmin('root@example.com', 'superadmin');
    const { entitlementId } = await paidEntitlement();
    const reason = { reason: 'Chargeback confirmed by the payment desk' };

    const support = await tokenFor('support@example.com');
    const operator = await tokenFor('operator@example.com');
    const root = await tokenFor('root@example.com');
    const revoke = `/api/admin/entitlements/${entitlementId}/revoke`;

    expect((await request(app).get('/api/admin/orders').set('authorization', `Bearer ${support}`)).status).toBe(200);
    expect((await request(app).post(revoke).set('authorization', `Bearer ${support}`).send(reason)).status).toBe(403);
    expect((await request(app).post(revoke).set('authorization', `Bearer ${operator}`).send(reason)).status).toBe(403);
    expect((await request(app).get('/api/admin/admins').set('authorization', `Bearer ${operator}`)).status).toBe(403);

    // A reason is mandatory.
    expect((await request(app).post(revoke).set('authorization', `Bearer ${root}`).send({ reason: 'x' })).status).toBe(400);

    expect((await request(app).post(revoke).set('authorization', `Bearer ${root}`).send(reason)).status).toBe(200);
    expect((await Entitlement.findById(entitlementId))!.status).toBe('revoked');
    expect(await AuditLog.countDocuments({ action: 'entitlement.revoked', actorType: 'admin' })).toBe(1);
  });

  it('applies a disabled account immediately, even with a valid token', async () => {
    await makeAdmin('gone@example.com', 'support');
    const token = await tokenFor('gone@example.com');
    await Admin.updateOne({ email: 'gone@example.com' }, { $set: { status: 'disabled' } });
    expect((await request(app).get('/api/admin/orders').set('authorization', `Bearer ${token}`)).status).toBe(401);
  });

  it('manual payment correction still needs on-chain proof and cannot mark an order paid by assertion', async () => {
    await makeAdmin('root@example.com', 'superadmin');
    const root = await tokenFor('root@example.com');
    const stub = new StubProvider();
    setTronProvider(stub);
    const created = await request(app).post('/api/orders').send({ productId: 'avc-standard' });

    const res = await request(app)
      .post(`/api/admin/orders/${created.body.orderId}/manual-payment`)
      .set('authorization', `Bearer ${root}`)
      .send({ txHash: hash(99), reason: 'Customer says they paid, checking chain' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('awaiting_payment'); // not on chain, so nothing is granted
    expect((await Order.findById(created.body.orderId))!.status).toBe('pending');
    expect(await Entitlement.countDocuments()).toBe(0);
  });

  it('exposes no endpoint that grants extra sessions', async () => {
    await makeAdmin('root@example.com', 'superadmin');
    const root = await tokenFor('root@example.com');
    const { entitlementId } = await paidEntitlement();
    for (const path of ['grant', 'reset', 'reset-session', 'add-session', 'reissue']) {
      const res = await request(app).post(`/api/admin/entitlements/${entitlementId}/${path}`).set('authorization', `Bearer ${root}`).send({ reason: 'trying to get another session' });
      expect(res.status).toBe(404);
    }
  });
});
