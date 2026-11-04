import { createHash } from 'node:crypto';
import { base58Decode, base58Encode } from './base58';

const sha256 = (b: Buffer) => createHash('sha256').update(b).digest();
const checksum = (payload: Buffer) => sha256(sha256(payload)).subarray(0, 4);

/** Hex (20 bytes, optional 0x, or 21 bytes with 0x41 prefix) -> base58check T... address. */
export function hexToBase58(hex: string): string {
  let h = hex.toLowerCase().replace(/^0x/, '');
  if (h.length === 40) h = '41' + h;
  if (!/^41[0-9a-f]{40}$/.test(h)) throw new Error('Invalid TRON hex address');
  const payload = Buffer.from(h, 'hex');
  return base58Encode(Buffer.concat([payload, checksum(payload)]));
}

export function isValidTronAddress(address: string): boolean {
  try {
    const raw = base58Decode(address);
    if (raw.length !== 25 || raw[0] !== 0x41) return false;
    return checksum(raw.subarray(0, 21)).equals(raw.subarray(21));
  } catch {
    return false;
  }
}

/** Accepts base58 or hex and returns canonical base58. Throws on garbage. */
export function normalizeTronAddress(address: string): string {
  return isValidTronAddress(address) ? address : hexToBase58(address);
}
