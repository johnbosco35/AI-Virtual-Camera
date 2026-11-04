import { tron } from '../../config';
import { TronGridProvider } from './tronGridProvider';
import type { TronProvider } from './types';

let provider: TronProvider | null = null;

/** Production code only ever gets the real provider. Tests inject a stub with setTronProvider. */
export function getTronProvider(): TronProvider {
  provider ??= new TronGridProvider(tron.baseUrl, tron.apiKey);
  return provider;
}
export function setTronProvider(p: TronProvider | null) {
  provider = p;
}
