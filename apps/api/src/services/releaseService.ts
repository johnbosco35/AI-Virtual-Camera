import fs from 'node:fs';
import path from 'node:path';
import { env } from '../config';
import { Order, Release } from '../models';
import { signToken, verifyToken } from '../utils/crypto';
import { now } from '../utils/clock';
import { AppError } from '../utils/errors';
import { audit, type Actor } from './auditService';

export async function latestRelease() {
  const r = await Release.findOne({ platform: 'win32', active: true }).sort({ createdAt: -1 });
  if (!r) throw new AppError(404, 'NO_RELEASE', 'No release is available yet.');
  return { version: r.version, filename: r.filename, sha256: r.sha256, sizeBytes: r.sizeBytes, notes: r.notes, publishedAt: r.createdAt };
}

/** Short-lived, HMAC-signed link. Issued only for a verified (paid) order. */
export async function issueDownload(orderId: string, actor: Actor) {
  const order = await Order.findById(orderId);
  if (!order || order.status !== 'paid') throw new AppError(403, 'NOT_ENTITLED', 'Download is available after payment is verified.');
  const release = await Release.findOne({ platform: 'win32', active: true }).sort({ createdAt: -1 });
  if (!release) throw new AppError(404, 'NO_RELEASE', 'No release is available yet.');

  const exp = now().getTime() + env.DOWNLOAD_TOKEN_TTL_SECONDS * 1000;
  const token = signToken({ r: release._id.toString(), o: orderId, exp });
  await audit({ actor, action: 'download.issued', targetType: 'Order', targetId: orderId, metadata: { version: release.version } });
  return { url: `/api/downloads/${token}`, expiresAt: new Date(exp), version: release.version, sha256: release.sha256, sizeBytes: release.sizeBytes };
}

export async function openDownload(token: string, actor: Actor) {
  const t = verifyToken<{ r: string; o: string; exp: number }>(token);
  if (t.exp < now().getTime()) throw new AppError(403, 'DOWNLOAD_EXPIRED', 'Download link expired. Request a new one.');
  const order = await Order.findById(t.o);
  if (!order || order.status !== 'paid') throw new AppError(403, 'NOT_ENTITLED', 'Download is not authorized.');
  const release = await Release.findById(t.r);
  if (!release || !release.active) throw new AppError(404, 'NO_RELEASE', 'Release not found.');

  // Path traversal guard: the resolved file must live under the release directory.
  const root = path.resolve(env.RELEASE_STORAGE_DIR);
  const file = path.resolve(root, release.storageKey);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) throw new AppError(404, 'FILE_MISSING', 'Release file is unavailable.');

  await audit({ actor, action: 'download.served', targetType: 'Order', targetId: t.o, metadata: { version: release.version } });
  return { file, filename: release.filename, sha256: release.sha256 };
}
