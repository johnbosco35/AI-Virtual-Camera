import { Schema, model } from 'mongoose';

/** Durable. Intentionally has no TTL index and no delete path. */
const auditLogSchema = new Schema({
  at: { type: Date, required: true, default: () => new Date() },
  actorType: { type: String, enum: ['system', 'admin', 'device', 'customer'], required: true },
  actorId: String,
  action: { type: String, required: true },
  targetType: String,
  targetId: String,
  severity: { type: String, enum: ['info', 'warn', 'security'], default: 'info' },
  ip: String,
  metadata: Schema.Types.Mixed,
});
auditLogSchema.index({ at: -1 });
auditLogSchema.index({ action: 1, at: -1 });
auditLogSchema.index({ targetType: 1, targetId: 1, at: -1 });

export const AuditLog = model('AuditLog', auditLogSchema);
