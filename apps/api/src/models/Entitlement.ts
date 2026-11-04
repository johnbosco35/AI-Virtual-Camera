import { Schema, model, type InferSchemaType } from 'mongoose';
import { newId } from '../utils/ids';

const entitlementSchema = new Schema(
  {
    _id: { type: String, default: () => newId('ent') },
    orderId: { type: String, ref: 'Order', required: true },
    productId: { type: String, ref: 'Product', required: true },
    purchaseStatus: { type: String, enum: ['verified'], default: 'verified' },
    /** Keyed hash only. The code itself is re-derivable from the id and SERVER_SECRET. */
    activationCodeHash: { type: String, required: true },
    status: { type: String, enum: ['active', 'revoked'], default: 'active' },
    binding: {
      state: { type: String, enum: ['unbound', 'bound'], default: 'unbound' },
      deviceFingerprint: String,
      deviceActivationId: String,
      activatedAt: Date,
      recoveryCount: { type: Number, default: 0 },
      recoveries: [{ at: Date, by: String, reason: String, _id: false }],
    },
    /** Durable. Deleting a VideoSession never changes these fields. */
    session: {
      allowance: { type: Number, default: 1 },
      seconds: { type: Number, default: 900 },
      consumed: { type: Boolean, default: false },
      consumedAt: Date,
      sessionId: String,
    },
    revocation: { revokedAt: Date, reason: String, by: String },
  },
  { timestamps: true },
);

entitlementSchema.index({ orderId: 1 }, { unique: true }); // never issue twice for one order
entitlementSchema.index({ activationCodeHash: 1 }, { unique: true });

export type EntitlementDoc = InferSchemaType<typeof entitlementSchema> & { _id: string; createdAt: Date };
export const Entitlement = model('Entitlement', entitlementSchema);
