/** All payment math uses integer base units (BigInt). Never floating point. */
export const USDT_DECIMALS = 6;

export function parseDecimalToBaseUnits(value: string, decimals = USDT_DECIMALS): bigint {
  const re = new RegExp(`^\\d+(\\.\\d{1,${decimals}})?$`);
  if (!re.test(value)) throw new Error(`Invalid amount: ${value}`);
  const [whole, frac = ''] = value.split('.');
  return BigInt(whole + frac.padEnd(decimals, '0'));
}

export function formatBaseUnits(value: bigint, decimals = USDT_DECIMALS): string {
  const s = value.toString().padStart(decimals + 1, '0');
  return `${s.slice(0, -decimals)}.${s.slice(-decimals)}`;
}
