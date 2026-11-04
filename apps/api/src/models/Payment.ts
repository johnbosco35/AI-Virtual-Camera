import { Schema, model, type InferSchemaType } from 'mongoose';
import { newId } from '../utils/ids';

/** Only payments that passed verification are stored. Rejections go to the audit log. */
const paymentSchema = new Schema(
  {
    _id: { type: String, default: () => newId('pay') },
    network: { type: String, required: true },
    txHash: { type: String, required: true, lowercase: true },
    tokenContract: { type: String, required: true },
    sender: String,
    destination: { type: String, required: true },
    amountBaseUnits: { type: String, required: true },
    orderId: { type: String, ref: 'Order', required: true },
    confirmation: { type: String, enum: ['confirmed'], default: 'confirmed' },
    blockTimestamp: { type: Date, required: true },
    blockNumber: Number,
    verifiedAt: { type: Date, required: true },
    verificationResult: { type: String, enum: ['accepted'], default: 'accepted' },
    provider: { type: String, required: true },
    providerRef: String,
  },
  { timestamps: true },
);

paymentSchema.index({ network: 1, txHash: 1 }, { unique: true }); // replay protection
paymentSchema.index({ orderId: 1 }, { unique: true }); // one payment per order

export type PaymentDoc = InferSchemaType<typeof paymentSchema> & { _id: string };
export const Payment = model('Payment', paymentSchema);
