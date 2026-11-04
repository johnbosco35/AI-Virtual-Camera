import { Schema, model } from 'mongoose';

/** Makes challenges single-use. Short-lived by design, so a TTL index is appropriate here. */
const usedNonceSchema = new Schema({
  _id: { type: String, required: true }, // the nonce
  expireAt: { type: Date, required: true },
});
usedNonceSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });

export const UsedNonce = model('UsedNonce', usedNonceSchema);
