import { Schema, model, type InferSchemaType } from 'mongoose';

const releaseSchema = new Schema(
  {
    version: { type: String, required: true },
    platform: { type: String, enum: ['win32'], default: 'win32' },
    filename: { type: String, required: true },
    sha256: { type: String, required: true, match: /^[0-9a-f]{64}$/ },
    sizeBytes: { type: Number, required: true },
    storageKey: { type: String, required: true }, // path under RELEASE_STORAGE_DIR (or object key)
    notes: String,
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);
releaseSchema.index({ platform: 1, version: 1 }, { unique: true });

export type ReleaseDoc = InferSchemaType<typeof releaseSchema> & { _id: import('mongoose').Types.ObjectId; createdAt: Date };
export const Release = model('Release', releaseSchema);
