import { AppError } from '../../utils/errors';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** JSON fetch with a hard timeout and bounded retries on network errors, 429 and 5xx. */
export async function fetchJson<T>(
  url: string,
  init: RequestInit = {},
  opts: { timeoutMs?: number; retries?: number } = {},
): Promise<T> {
  const { timeoutMs = 8000, retries = 3 } = opts;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: ctrl.signal });
      if (res.status === 429 || res.status >= 500) throw new Error(`Provider HTTP ${res.status}`);
      if (!res.ok) throw new AppError(502, 'PROVIDER_ERROR', `Provider returned HTTP ${res.status}`);
      return (await res.json()) as T;
    } catch (e) {
      lastError = e;
      if (e instanceof AppError) throw e;
      if (attempt < retries) await sleep(300 * 2 ** attempt);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new AppError(502, 'PROVIDER_UNAVAILABLE', 'Blockchain provider is unavailable. Try again shortly.', {
    cause: String(lastError),
  });
}
