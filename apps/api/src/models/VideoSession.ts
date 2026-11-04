import { Schema, model, type InferSchemaType } from 'mongoose';

/** Temporary. Safe to delete: consumption is recorded on the Entitlement, not here. */
const videoSessionSchema = new Schema(
  {
    _id: { type: String, required: true }, // ses_..., pre-generated so the Entitlement can reference it
    entitlementId: { type: String, ref: 'Entitlement', required: true },
    deviceActivationId: { type: String, required: true },
    deviceFingerprint: { type: String, required: true },
    status: { type: String, enum: ['active', 'ended'], default: 'active' },
    startedAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true }, // fixed at start, never extended
    endedAt: Date,
    deleteAt: Date, // set only when ended: endedAt + 5 minutes
    terminationReason: {
      type: String,
      enum: ['user_ended', 'expired', 'revoked', 'admin_terminated', 'start_failed'],
    },
    lastHeartbeatAt: Date,
    diagnostics: { appVersion: String, os: String }, // minimal by design
  },
  { timestamps: true },
);

// TTL cleanup is asynchronous (MongoDB runs it about once a minute). Access control never relies on it.
videoSessionSchema.index({ deleteAt: 1 }, { expireAfterSeconds: 0 });
// A second concurrent active session for one entitlement is impossible.
videoSessionSchema.index({ entitlementId: 1 }, { unique: true, partialFilterExpression: { status: 'active' } });
videoSessionSchema.index({ status: 1, expiresAt: 1 });

export type VideoSessionDoc = InferSchemaType<typeof videoSessionSchema> & { _id: string };
export const VideoSession = model('VideoSession', videoSessionSchema);
