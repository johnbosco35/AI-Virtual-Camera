import { UsedNonce } from '../models';
import { issueChallenge, parseChallenge, parseDevicePublicKey, verifySignature, type ChallengePurpose } from '../utils/crypto';
import { now } from '../utils/clock';
import { AppError, isDuplicateKeyError } from '../utils/errors';
import { auditSafe } from './auditService';

export function createChallenge(purpose: ChallengePurpose) {
  return issueChallenge(purpose, now().getTime());
}

/**
 * Proof of possession of the device private key.
 * The device signs `${challenge}|${context}` (context = activation code or entitlement id).
 * Challenges are HMAC-signed, expire in 60s and can be used exactly once.
 */
export async function verifyChallengeProof(args: {
  purpose: ChallengePurpose;
  context: string;
  publicKey: string;
  challenge: string;
  signature: string;
}): Promise<{ fingerprint: string }> {
  const { fingerprint } = parseDevicePublicKey(args.publicKey);
  const parsed = parseChallenge(args.challenge, args.purpose, now().getTime());

  if (!verifySignature(args.publicKey, `${args.challenge}|${args.context}`, args.signature)) {
    await auditSafe({ actor: { type: 'device', id: fingerprint }, action: 'device.bad_signature', severity: 'security', metadata: { purpose: args.purpose } });
    throw new AppError(401, 'INVALID_SIGNATURE', 'Device signature is not valid.');
  }
  try {
    await UsedNonce.create({ _id: parsed.nonce, expireAt: new Date(parsed.exp + 60_000) });
  } catch (e) {
    if (isDuplicateKeyError(e)) {
      await auditSafe({ actor: { type: 'device', id: fingerprint }, action: 'device.challenge_replay', severity: 'security', metadata: { purpose: args.purpose } });
      throw new AppError(401, 'CHALLENGE_REPLAY', 'Challenge was already used. Request a new one.');
    }
    throw e;
  }
  return { fingerprint };
}

/** Signed-timestamp proof for in-session calls, verified against the key stored at activation. */
export function verifyTimestampProof(args: { publicKey: string; action: string; subject: string; ts: string; signature: string }) {
  const tsNum = Number(args.ts);
  if (!Number.isFinite(tsNum) || Math.abs(now().getTime() - tsNum) > 60_000) {
    throw new AppError(401, 'STALE_REQUEST', 'Request timestamp is outside the allowed window.');
  }
  if (!verifySignature(args.publicKey, `${args.action}|${args.subject}|${args.ts}`, args.signature)) {
    throw new AppError(401, 'INVALID_SIGNATURE', 'Device signature is not valid.');
  }
}
