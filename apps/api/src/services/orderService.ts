import { randomInt } from 'node:crypto';
import { env, tron } from '../config';
import { Entitlement, Order, Payment, Product } from '../models';
import { activationCodeFor } from '../utils/crypto';
import { now } from '../utils/clock';
import { AppError, isDuplicateKeyError } from '../utils/errors';
import { formatBaseUnits } from '../utils/money';
import { audit, type Actor } from './auditService';

export async function createOrder(productId: string, actor: Actor) {
  const product = await Product.findOne({ _id: productId, active: true });
  if (!product) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product is not available.');

  const base = BigInt(product.priceBaseUnits);
  const createdAt = now();
  const expiresAt = new Date(createdAt.getTime() + env.ORDER_TTL_MINUTES * 60_000);

  for (let attempt = 0; attempt < 25; attempt++) {
    const suffix = BigInt(1 + randomInt(9999)); // 0.000001 to 0.009999 USDT
    try {
      const order = await Order.create({
        productId: product._id,
        expectedAmountBaseUnits: (base + suffix).toString(),
        tokenContract: tron.usdtContract,
        destination: tron.destination,
        expiresAt,
        createdAt,
      });
      await audit({ actor, action: 'order.created', targetType: 'Order', targetId: order._id });
      return order;
    } catch (e) {
      if (!isDuplicateKeyError(e)) throw e; // amount collision with another pending order: pick another suffix
    }
  }
  throw new AppError(503, 'ORDER_BUSY', 'Could not allocate a payment amount. Try again.');
}

export type PublicOrderStatus =
  | 'awaiting_payment' | 'payment_detected' | 'confirming' | 'verified' | 'failed' | 'expired';

export async function getOrderView(orderId: string) {
  const order = await Order.findById(orderId);
  if (!order) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found.');

  let status: PublicOrderStatus;
  if (order.status === 'paid') status = 'verified';
  else if (order.status === 'failed') status = 'failed';
  else if (order.status === 'expired' || order.expiresAt <= now()) status = 'expired';
  else status = ({ none: 'awaiting_payment', detected: 'payment_detected', confirming: 'confirming', verified: 'verified', failed: 'awaiting_payment' } as const)[order.verification?.status ?? 'none'];

  const view: Record<string, unknown> = {
    orderId: order._id,
    status,
    network: 'TRON',
    token: 'USDT (TRC-20)',
    tokenContract: order.tokenContract,
    destination: order.destination,
    expectedAmount: formatBaseUnits(BigInt(order.expectedAmountBaseUnits)),
    expectedAmountBaseUnits: order.expectedAmountBaseUnits,
    expiresAt: order.expiresAt,
    message: order.verification?.message,
  };

  if (order.status === 'paid') {
    const [payment, entitlement] = await Promise.all([Payment.findOne({ orderId }), Entitlement.findOne({ orderId })]);
    view.paidAt = order.paidAt;
    view.txHash = payment?.txHash;
    if (entitlement) {
      view.entitlementId = entitlement._id;
      view.activationCode = activationCodeFor(entitlement._id);
    }
  }
  return view;
}
