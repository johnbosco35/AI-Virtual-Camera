const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function base58Encode(buf: Buffer): string {
  let n = buf.length ? BigInt('0x' + buf.toString('hex')) : 0n;
  let out = '';
  while (n > 0n) {
    out = ALPHABET[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of buf) {
    if (b === 0) out = '1' + out;
    else break;
  }
  return out;
}

export function base58Decode(s: string): Buffer {
  let n = 0n;
  for (const c of s) {
    const i = ALPHABET.indexOf(c);
    if (i < 0) throw new Error('Invalid base58 character');
    n = n * 58n + BigInt(i);
  }
  let hex = n === 0n ? '' : n.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  let zeros = 0;
  for (const c of s) {
    if (c === '1') zeros++;
    else break;
  }
  return Buffer.concat([Buffer.alloc(zeros), Buffer.from(hex, 'hex')]);
}
