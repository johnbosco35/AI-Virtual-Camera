import { Schema, model, type InferSchemaType } from 'mongoose';
import { newId } from '../utils/ids';

const orderSchema = new Schema(
  {
    _id: { type: String, default: () => newId('ord') },
    productId: { type: String, ref: 'Product', required: true },
    /** Base price plus a small unique suffix so each pending order has a distinct exact amount. */
    expectedAmountBaseUnits: { type: String, required: true, match: /^\d+$/ },
    currency: { type: String, default: 'USDT' },
    network: { type: String, default: 'TRON' },
    tokenContract: { type: String, required: true },
    destination: { type: String, required: true },
    status: { type: String, enum: ['pending', 'paid', 'expired', 'failed'], default: 'pending' },
    expiresAt: { type: Date, required: true },
    paidAt: Date,
    paymentId: { type: String, ref: 'Payment' },
    verification: {
      status: { type: String, enum: ['none', 'detected', 'confirming', 'verified', 'failed'], default: 'none' },
      lastCheckedAt: Date,
      lastTxHash: String,
      message: String,
    },
  },
  { timestamps: true },
);

// Two pending orders can never share an exact amount to the same destination.
orderSchema.index(
  { destination: 1, expectedAmountBaseUnits: 1 },
  { unique: true, partialFilterExpression: { status: 'pending' } },
);
orderSchema.index({ status: 1, expiresAt: 1 });

export type OrderDoc = InferSchemaType<typeof orderSchema> & { _id: string; createdAt: Date; updatedAt: Date };
export const Order = model('Order', orderSchema);
