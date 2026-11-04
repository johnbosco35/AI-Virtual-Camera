import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Entitlement, Order, Payment } from '../models';
import { createOrder } from '../services/orderService';
import { verifyPayment } from '../services/paymentService';
import { setTronProvider } from '../services/tron/registry';
import { tron } from '../config';
import { confirmedTx, connectDb, goodTransfer, hash, resetDb, seedProduct, StubProvider } from './helpers';

const actor = { type: 'customer' as const };
let stub: StubProvider;

beforeAll(connectDb);
beforeEach(async () => {
  await resetDb();
  await seedProduct();
  stub = new StubProvider();
  setTronProvider(stub);
});

describe('payment verification', () => {
  it('verifies once and is idempotent under concurrent repeats', async () => {
    const order = await createOrder('avc-standard', actor);
    stub.add(hash(1), confirmedTx(hash(1), [goodTransfer(order.expectedAmountBaseUnits)]));

    const results = await Promise.all(Array.from({ length: 8 }, () => verifyPayment({ orderId: order._id, txHash: hash(1), actor })));
    expect(results.every((r) => r.status === 'verified')).toBe(true);
    expect(await Payment.countDocuments()).toBe(1);
    expect(await Entitlement.countDocuments()).toBe(1);
    expect((await Order.findById(order._id))!.status).toBe('paid');
  });

  it('refuses a second, different transaction for an already-paid order', async () => {
    const order = await createOrder('avc-standard', actor);
    for (const n of [1, 2]) stub.add(hash(n), confirmedTx(hash(n), [goodTransfer(order.expectedAmountBaseUnits)]));
    await verifyPayment({ orderId: order._id, txHash: hash(1), actor });
    const second = await verifyPayment({ orderId: order._id, txHash: hash(2), actor });
    expect(second.status).toBe('already_used');
    expect(await Entitlement.countDocuments()).toBe(1);
  });

  it('refuses to reuse one transaction for a second order (replay)', async () => {
    const a = await createOrder('avc-standard', actor);
    const b = await createOrder('avc-standard', actor);
    stub.add(hash(1), confirmedTx(hash(1), [goodTransfer(a.expectedAmountBaseUnits)]));
    await verifyPayment({ orderId: a._id, txHash: hash(1), actor });
    const replay = await verifyPayment({ orderId: b._id, txHash: hash(1), actor });
    expect(replay.status).toBe('already_used');
    expect((await Order.findById(b._id))!.status).toBe('pending');
    expect(await Entitlement.countDocuments()).toBe(1);
  });

  it.each([
    ['wrong amount', (amt: string) => goodTransfer((BigInt(amt) + 1n).toString())],
    ['wrong token contract', (amt: string) => goodTransfer(amt, { contractAddress: tron.destination })],
    ['wrong destination', (amt: string) => goodTransfer(amt, { to: tron.usdtContract })],
  ])('rejects %s', async (_name, make) => {
    const order = await createOrder('avc-standard', actor);
    stub.add(hash(3), confirmedTx(hash(3), [make(order.expectedAmountBaseUnits)]));
    const out = await verifyPayment({ orderId: order._id, txHash: hash(3), actor });
    expect(out.status).toBe('failed');
    expect(await Entitlement.countDocuments()).toBe(0);
    expect((await Order.findById(order._id))!.status).toBe('pending');
  });

  it('does not grant anything until the transaction is final', async () => {
    const order = await createOrder('avc-standard', actor);
    stub.add(hash(4), { state: 'unconfirmed', txHash: hash(4), blockTimestampMs: Date.now(), blockNumber: 7, transfers: [goodTransfer(order.expectedAmountBaseUnits)] });
    expect((await verifyPayment({ orderId: order._id, txHash: hash(4), actor })).status).toBe('confirming');
    expect(await Payment.countDocuments()).toBe(0);

    stub.add(hash(4), confirmedTx(hash(4), [goodTransfer(order.expectedAmountBaseUnits)]));
    expect((await verifyPayment({ orderId: order._id, txHash: hash(4), actor })).status).toBe('verified');
  });

  it('reports not-found and failed transactions without granting', async () => {
    const order = await createOrder('avc-standard', actor);
    expect((await verifyPayment({ orderId: order._id, txHash: hash(5), actor })).status).toBe('awaiting_payment');
    stub.add(hash(6), { state: 'failed', reason: 'Transaction failed on chain.' });
    expect((await verifyPayment({ orderId: order._id, txHash: hash(6), actor })).status).toBe('failed');
    expect(await Entitlement.countDocuments()).toBe(0);
  });

  it('rejects transactions paid outside the order window, judged by chain time', async () => {
    const order = await createOrder('avc-standard', actor);
    const late = order.expiresAt.getTime() + 60_000;
    stub.add(hash(7), confirmedTx(hash(7), [goodTransfer(order.expectedAmountBaseUnits)], late));
    expect((await verifyPayment({ orderId: order._id, txHash: hash(7), actor })).status).toBe('expired');
  });

  it('allocates a distinct exact amount to every pending order', async () => {
    const orders = await Promise.all(Array.from({ length: 20 }, () => createOrder('avc-standard', actor)));
    expect(new Set(orders.map((o) => o.expectedAmountBaseUnits)).size).toBe(20);
  });
});
