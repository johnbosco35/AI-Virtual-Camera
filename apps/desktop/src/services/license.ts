/**
 * MOCK licensing service for Section 1.
 * Replace with the real API client from packages/api-client once Section 2 exists.
 * The backend, not this file, is authoritative for activation and session expiry.
 */
import { SESSION_SECONDS } from '@/lib/time';

export type Entitlement =
  | { status: 'none' }
  | { status: 'activated'; code: string }
  | { status: 'active'; code: string; expiresAt: number; serverOffsetMs: number }
  | { status: 'consumed'; code: string };

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function activate(code: string, fingerprint: string): Promise<Entitlement> {
  await delay(600);
  if (!/^[A-Z0-9]{4}(-[A-Z0-9]{4}){3}$/.test(code)) throw new Error('That code is not in the right format.');
  if (fingerprint.length !== 64) throw new Error('Device could not be verified.');
  return { status: 'activated', code };
}

export async function startSession(current: Entitlement): Promise<Entitlement> {
  await delay(400);
  if (current.status !== 'activated') throw new Error('This activation has no session left.');
  const serverNow = Date.now();
  return {
    status: 'active',
    code: current.code,
    expiresAt: serverNow + SESSION_SECONDS * 1000,
    serverOffsetMs: serverNow - Date.now(),
  };
}

export async function endSession(current: Entitlement): Promise<Entitlement> {
  if (current.status !== 'active') return current;
  return { status: 'consumed', code: current.code };
}
