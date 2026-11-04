import { Schema, model, type InferSchemaType } from 'mongoose';
import { newId } from '../utils/ids';

const deviceActivationSchema = new Schema(
  {
    _id: { type: String, default: () => newId('act') },
    entitlementId: { type: String, ref: 'Entitlement', required: true },
    publicKey: { type: String, required: true }, // base64 SPKI. Private keys never reach the server.
    fingerprint: { type: String, required: true },
    status: { type: String, enum: ['active', 'revoked', 'superseded'], default: 'active' },
    activatedAt: { type: Date, required: true },
    lastVerifiedAt: Date,
    revokedAt: Date,
    revokeReason: String,
  },
  { timestamps: true },
);

// At most one live activation per entitlement.
deviceActivationSchema.index(
  { entitlementId: 1 },
  { unique: true, partialFilterExpression: { status: 'active' } },
);
deviceActivationSchema.index({ fingerprint: 1 });

export type DeviceActivationDoc = InferSchemaType<typeof deviceActivationSchema> & { _id: string };
export const DeviceActivation = model('DeviceActivation', deviceActivationSchema);
