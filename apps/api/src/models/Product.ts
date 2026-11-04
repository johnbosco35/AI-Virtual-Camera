import { Schema, model, type InferSchemaType } from 'mongoose';

const productSchema = new Schema(
  {
    _id: { type: String, required: true }, // stable slug, e.g. "avc-standard"
    name: { type: String, required: true, trim: true },
    /** Price in USDT base units (6 decimals) as a decimal string. Authoritative; never taken from clients. */
    priceBaseUnits: { type: String, required: true, match: /^\d+$/ },
    currency: { type: String, enum: ['USDT'], default: 'USDT' },
    network: { type: String, enum: ['TRON'], default: 'TRON' },
    version: { type: String, required: true },
    active: { type: Boolean, default: true, index: true },
    entitlementConfig: {
      maxActivations: { type: Number, default: 1, min: 1, max: 1 },
      sessionAllowance: { type: Number, default: 1, min: 1, max: 1 },
      sessionSeconds: { type: Number, default: 900, min: 1, max: 900 },
    },
  },
  { timestamps: true },
);

export type ProductDoc = InferSchemaType<typeof productSchema> & { _id: string };
export const Product = model('Product', productSchema);
