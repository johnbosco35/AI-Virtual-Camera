import { createHash, createHmac, createPublicKey, randomBytes, timingSafeEqual, verify } from 'node:crypto';
import { env } from '../config/env';
import { AppError } from './errors';

const hmac = (label: string, data: string) =>
  createHmac('sha256', env.SERVER_SECRET).update(`${label}:${data}`).digest();

const safeEqual = (a: Buffer, b: Buffer) => a.length === b.length && timingSafeEqual(a, b);

// ---- Activation codes -------------------------------------------------------
// Derived from the entitlement id (no plaintext stored). Only a keyed hash is stored for lookup.
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function activationCodeFor(entitlementId: string): string {
  const bytes = hmac('code', entitlementId).subarray(0, 10); // 80 bits
  let bits = 0n;
  for (const b of bytes) bits = (bits << 8n) | BigInt(b);
  let out = '';
  for (let i = 15; i >= 0; i--) out += CROCKFORD[Number((bits >> BigInt(i * 5)) & 31n)];
  return out.match(/.{4}/g)!.join('-');
}

export function normalizeActivationCode(input: string): string {
  return input.toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
}

export const activationCodeHash = (code: string): string =>
  hmac('lookup', normalizeActivationCode(code)).toString('hex');

// ---- Stateless challenges (single use via UsedNonce) ------------------------
export type ChallengePurpose = 'activate' | 'activation:verify' | 'session:start';
const CHALLENGE_TTL_MS = 60_000;

export function issueChallenge(purpose: ChallengePurpose, nowMs: number): { challenge: string; expiresAt: Date } {
  const exp = nowMs + CHALLENGE_TTL_MS;
  const payload = Buffer.from(JSON.stringify({ n: randomBytes(16).toString('base64url'), p: purpose, exp })).toString('base64url');
  const mac = hmac('challenge', payload).toString('base64url');
  return { challenge: `${payload}.${mac}`, expiresAt: new Date(exp) };
}

export function parseChallenge(token: string, purpose: ChallengePurpose, nowMs: number): { nonce: string; exp: number } {
  const [payload, mac] = token.split('.');
  if (!payload || !mac || !safeEqual(Buffer.from(mac, 'base64url'), hmac('challenge', payload))) {
    throw new AppError(401, 'INVALID_CHALLENGE', 'Challenge is not valid.');
  }
  const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { n: string; p: string; exp: number };
  if (data.p !== purpose) throw new AppError(401, 'INVALID_CHALLENGE', 'Challenge purpose mismatch.');
  if (data.exp < nowMs) throw new AppError(401, 'CHALLENGE_EXPIRED', 'Challenge expired. Request a new one.');
  return { nonce: data.n, exp: data.exp };
}

// ---- Ed25519 device keys ----------------------------------------------------
/** publicKeyB64 = base64 of the SPKI DER encoding. Returns the key object and a stable fingerprint. */
export function parseDevicePublicKey(publicKeyB64: string) {
  try {
    const der = Buffer.from(publicKeyB64, 'base64');
    const key = createPublicKey({ key: der, format: 'der', type: 'spki' });
    if (key.asymmetricKeyType !== 'ed25519') throw new Error('not ed25519');
    return { key, fingerprint: createHash('sha256').update(der).digest('hex') };
  } catch {
    throw new AppError(400, 'INVALID_DEVICE_KEY', 'Device public key must be a base64 Ed25519 SPKI key.');
  }
}

export function verifySignature(publicKeyB64: string, message: string, signatureB64: string): boolean {
  const { key } = parseDevicePublicKey(publicKeyB64);
  return verify(null, Buffer.from(message, 'utf8'), key, Buffer.from(signatureB64, 'base64'));
}

// ---- Download tokens --------------------------------------------------------
export function signToken(payload: object): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${hmac('download', body).toString('base64url')}`;
}

export function verifyToken<T>(token: string): T {
  const [body, mac] = token.split('.');
  if (!body || !mac || !safeEqual(Buffer.from(mac, 'base64url'), hmac('download', body))) {
    throw new AppError(403, 'INVALID_DOWNLOAD_TOKEN', 'Download link is not valid.');
  }
  return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T;
}
