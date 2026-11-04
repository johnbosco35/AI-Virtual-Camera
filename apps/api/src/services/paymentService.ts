import { tron } from '../config';
import { Order, Payment, type OrderDoc } from '../models';
import { now } from '../utils/clock';
import { AppError, isDuplicateKeyError } from '../utils/errors';
import { audit, auditSafe, type Actor } from './auditService';
import { ensureEntitlement } from './entitlementService';
import { getTronProvider } from './tron/registry';
import type { ChainTransfer } from './tron/types';

export type VerifyStatus =
  | 'awaiting_payment' | 'payment_detected' | 'confirming' | 'verified' | 'failed' | 'expired' | 'already_used';

export interface VerifyOutcome {
  status: VerifyStatus;
  message: string;
  entitlementId?: string;
  idempotent?: boolean;
}

const TX_RE = /^[0-9a-f]{64}$/;
const CLOCK_SKEW_MS = 60_000;

async function setVerification(orderId: string, status: string, message: string, txHash: string) {
  await Order.updateOne(
    { _id: orderId, status: { $in: ['pending', 'expired'] } },
    { $set: { 'verification.status': status, 'verification.message': message, 'verification.lastCheckedAt': now(), 'verification.lastTxHash': txHash } },
  );
}

/**
 * Independent, idempotent verification. The client only names an order and a hash;
 * everything else comes from the blockchain provider.
 */
export async function verifyPayment(input: {
  orderId: string;
  txHash: string;
  actor: Actor;
  /** Admin corrections only: skips the order-expiry upper bound. Chain checks still run in full. */
  ignoreExpiry?: boolean;
}): Promise<VerifyOutcome> {
  const txHash = input.txHash.trim().toLowerCase().replace(/^0x/, '');
  if (!TX_RE.test(txHash)) throw new AppError(400, 'INVALID_TX_HASH', 'Transaction hash must be 64 hex characters.');

  const order = await Order.findById(input.orderId);
  if (!order) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found.');

  // Idempotency: an already-paid order answers the same way forever.
  if (order.status === 'paid') {
    const paid = await Payment.findOne({ orderId: order._id });
    if (paid?.txHash === txHash) {
      return { status: 'verified', message: 'Payment already verified.', idempotent: true };
    }
    await auditSafe({ actor: input.actor, action: 'payment.rejected.order_already_paid', targetType: 'Order', targetId: order._id, severity: 'security', metadata: { txHash } });
    return { status: 'already_used', message: 'This order is already paid with a different transaction.' };
  }
  if (order.status === 'failed') throw new AppError(409, 'ORDER_FAILED', 'This order was closed. Create a new order.');

  // Replay protection: a hash that paid another order can never pay this one.
  const prior = await Payment.findOne({ network: tron.network, txHash });
  if (prior && prior.orderId !== order._id) {
    await auditSafe({ actor: input.actor, action: 'payment.rejected.replay', targetType: 'Order', targetId: order._id, severity: 'security', metadata: { txHash, usedBy: prior.orderId } });
    return { status: 'already_used', message: 'This transaction was already used for another order.' };
  }

  const tx = await getTronProvider().getTransaction(txHash);

  if (tx.state === 'not_found') {
    await setVerification(order._id, 'none', 'Transaction not found on the network yet.', txHash);
    return { status: 'awaiting_payment', message: 'Transaction not found yet. Check the hash or wait a moment.' };
  }
  if (tx.state === 'failed') {
    await setVerification(order._id, 'failed', tx.reason, txHash);
    await auditSafe({ actor: input.actor, action: 'payment.rejected.chain_failed', targetType: 'Order', targetId: order._id, metadata: { txHash } });
    return { status: 'failed', message: tx.reason };
  }

  const toUs = tx.transfers.filter((t: ChainTransfer) => t.contractAddress === tron.usdtContract && t.to === tron.destination);
  const exact = toUs.find((t: ChainTransfer) => t.amountBaseUnits === order.expectedAmountBaseUnits);
  if (!exact) {
    const reason = toUs.length
      ? 'Amount does not match this order. Send the exact amount shown.'
      : 'No USDT (TRC-20) transfer to the payment address found in this transaction.';
    await setVerification(order._id, 'failed', reason, txHash);
    await auditSafe({ actor: input.actor, action: 'payment.rejected.no_match', targetType: 'Order', targetId: order._id, severity: 'warn', metadata: { txHash, sawTransfersToUs: toUs.length } });
    return { status: 'failed', message: reason };
  }

  // Chain time, not request time, decides whether it was paid in time.
  const ts = tx.blockTimestampMs;
  if (tx.state === 'confirmed') {
    const early = ts < order.createdAt.getTime() - CLOCK_SKEW_MS;
    const late = !input.ignoreExpiry && ts > order.expiresAt.getTime();
    if (early || late) {
      await setVerification(order._id, 'failed', 'Transaction is outside this order’s payment window.', txHash);
      await auditSafe({ actor: input.actor, action: 'payment.rejected.window', targetType: 'Order', targetId: order._id, severity: 'warn', metadata: { txHash, early, late } });
      return { status: 'expired', message: 'This transaction is outside the order’s payment window.' };
    }
  } else {
    const status = tx.blockNumber ? 'confirming' : 'detected';
    const message = tx.blockNumber ? 'Waiting for the network to finalize the transaction.' : 'Payment detected.';
    await setVerification(order._id, status, message, txHash);
    return { status: tx.blockNumber ? 'confirming' : 'payment_detected', message };
  }

  return finalize(order, tx.txHash, exact, tx.blockTimestampMs, tx.blockNumber, input.actor);
}

async function finalize(
  order: OrderDoc,
  txHash: string,
  transfer: ChainTransfer,
  blockTimestampMs: number,
  blockNumber: number | undefined,
  actor: Actor,
): Promise<VerifyOutcome> {
  let payment;
  try {
    payment = await Payment.create({
      network: tron.network,
      txHash,
      tokenContract: transfer.contractAddress,
      sender: transfer.from,
      destination: transfer.to,
      amountBaseUnits: transfer.amountBaseUnits,
      orderId: order._id,
      blockTimestamp: new Date(blockTimestampMs),
      blockNumber,
      verifiedAt: now(),
      provider: getTronProvider().name,
    });
  } catch (e) {
    if (!isDuplicateKeyError(e)) throw e;
    // Concurrent or repeated verification. Resolve to the existing record.
    const existing = await Payment.findOne({ network: tron.network, txHash });
    if (existing && existing.orderId === order._id) payment = existing;
    else if (existing) return { status: 'already_used', message: 'This transaction was already used for another order.' };
    else return { status: 'already_used', message: 'This order is already paid with a different transaction.' };
  }

  // Each step below is idempotent, so a crash between them is repaired by the reconciler.
  const flipped = await Order.updateOne(
    { _id: order._id, status: { $in: ['pending', 'expired'] } },
    { $set: { status: 'paid', paidAt: now(), paymentId: payment._id, 'verification.status': 'verified', 'verification.message': 'Payment verified.', 'verification.lastTxHash': txHash } },
  );
  const entitlement = await ensureEntitlement(order);
  if (flipped.modifiedCount === 1) {
    await audit({ actor, action: 'payment.verified', targetType: 'Order', targetId: order._id, metadata: { txHash, amountBaseUnits: transfer.amountBaseUnits, entitlementId: entitlement._id } });
  }
  return { status: 'verified', message: 'Payment verified.', entitlementId: entitlement._id, idempotent: flipped.modifiedCount === 0 };
}

/**
 * Scheduled reconciliation:
 * 1. expire stale pending orders,
 * 2. auto-match confirmed incoming transfers to orders by exact amount,
 * 3. repair payments whose order or entitlement step did not complete.
 */
export async function reconcilePayments(actor: Actor = { type: 'system' }) {
  const t = now();
  const expired = await Order.updateMany({ status: 'pending', expiresAt: { $lte: t } }, { $set: { status: 'expired' } });

  const horizon = new Date(t.getTime() - 24 * 3600_000);
  const open = await Order.find({ status: { $in: ['pending', 'expired'] }, createdAt: { $gte: horizon } });
  let matched = 0;
  if (open.length) {
    const since = Math.min(...open.map((o) => o.createdAt.getTime()));
    const incoming = await getTronProvider().listIncomingTransfers({ toAddress: tron.destination, contractAddress: tron.usdtContract, sinceMs: since });
    for (const tr of incoming) {
      if (await Payment.exists({ network: tron.network, txHash: tr.txHash })) continue;
      const order = open.find(
        (o) => o.expectedAmountBaseUnits === tr.amountBaseUnits && o.createdAt.getTime() - CLOCK_SKEW_MS <= tr.blockTimestampMs && o.expiresAt.getTime() >= tr.blockTimestampMs,
      );
      if (!order) continue;
      const out = await verifyPayment({ orderId: order._id, txHash: tr.txHash, actor });
      if (out.status === 'verified') matched++;
    }
  }

  let repaired = 0;
  for (const p of await Payment.find({ createdAt: { $gte: horizon } })) {
    const order = await Order.findById(p.orderId);
    if (order && order.status !== 'paid') {
      await Order.updateOne({ _id: order._id, status: { $in: ['pending', 'expired'] } }, { $set: { status: 'paid', paidAt: p.verifiedAt, paymentId: p._id, 'verification.status': 'verified' } });
      repaired++;
    }
    if (order) await ensureEntitlement(order);
  }
  return { expiredOrders: expired.modifiedCount, matched, repaired };
}
