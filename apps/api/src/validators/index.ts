import { z } from 'zod';

const id = z.string().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/);
const b64 = z.string().min(20).max(4096);

export const proofSchema = z.object({
  publicKey: b64,
  challenge: z.string().min(20).max(1024),
  signature: b64,
});

export const createOrderBody = z.object({ productId: z.string().min(1).max(64) });
export const orderIdParams = z.object({ orderId: id });
export const verifyPaymentBody = z.object({ orderId: id, txHash: z.string().min(64).max(66) });

export const entitlementParams = z.object({ entitlementId: id });
export const challengeBody = z.object({ purpose: z.enum(['activate', 'activation:verify', 'session:start']) });
export const activationBody = z.object({ activationCode: z.string().min(16).max(32), proof: proofSchema });

export const startSessionBody = z.object({
  entitlementId: id,
  proof: proofSchema,
  diagnostics: z.object({ appVersion: z.string().max(32).optional(), os: z.string().max(64).optional() }).optional(),
});
export const sessionParams = z.object({ sessionId: id });
export const downloadBody = z.object({ orderId: id });
export const downloadParams = z.object({ token: z.string().min(20).max(1024) });

// ---- admin ----
export const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  status: z.string().max(32).optional(),
});
export const adminLoginBody = z.object({ email: z.string().email(), password: z.string().min(1).max(200) });
export const reasonBody = z.object({ reason: z.string().min(10).max(500) });
export const manualPaymentBody = z.object({
  txHash: z.string().min(64).max(66),
  reason: z.string().min(10).max(500),
});
export const productBody = z.object({
  id: z.string().min(2).max(64).regex(/^[a-z0-9-]+$/),
  name: z.string().min(2).max(120),
  priceUsdt: z.string().regex(/^\d+(\.\d{1,6})?$/),
  version: z.string().min(1).max(32),
  active: z.boolean().default(true),
});
export const productPatchBody = productBody.omit({ id: true }).partial();
export const releaseBody = z.object({
  version: z.string().min(1).max(32),
  filename: z.string().min(1).max(200),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  sizeBytes: z.number().int().positive(),
  storageKey: z.string().min(1).max(300),
  notes: z.string().max(2000).optional(),
});
export const releasePatchBody = z.object({ active: z.boolean() });
export const adminCreateBody = z.object({
  email: z.string().email(),
  password: z.string().min(12).max(200),
  role: z.enum(['superadmin', 'operator', 'support']),
  extraPermissions: z.array(z.string()).default([]),
});
export const adminPatchBody = z.object({
  role: z.enum(['superadmin', 'operator', 'support']).optional(),
  status: z.enum(['active', 'disabled']).optional(),
  extraPermissions: z.array(z.string()).optional(),
});
export const adminIdParams = z.object({ id: z.string().regex(/^[a-f0-9]{24}$/) });
export const idParams = z.object({ id: id });
