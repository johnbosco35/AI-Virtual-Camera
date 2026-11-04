import { logger } from '../config';
import { AuditLog } from '../models';
import { now } from '../utils/clock';

export interface Actor {
  type: 'system' | 'admin' | 'device' | 'customer';
  id?: string;
  ip?: string;
}

const SENSITIVE_KEY = /key|secret|password|signature|token|frame|code/i;

function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => sanitize(v, depth + 1));
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, SENSITIVE_KEY.test(k) ? '[redacted]' : sanitize(v, depth + 1)]),
  );
}

export interface AuditInput {
  actor: Actor;
  action: string;
  targetType?: string;
  targetId?: string;
  severity?: 'info' | 'warn' | 'security';
  metadata?: Record<string, unknown>;
}

/** Fail-closed: callers that need a guaranteed trail (admin changes, consumption) await and let errors propagate. */
export async function audit(input: AuditInput): Promise<void> {
  await AuditLog.create({
    at: now(),
    actorType: input.actor.type,
    actorId: input.actor.id,
    ip: input.actor.ip,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    severity: input.severity ?? 'info',
    metadata: sanitize(input.metadata ?? {}),
  });
}

/** Best-effort variant for noisy security events where blocking the request makes no sense. */
export async function auditSafe(input: AuditInput): Promise<void> {
  try {
    await audit(input);
  } catch (e) {
    logger.error({ err: e, action: input.action }, 'audit write failed');
  }
}
