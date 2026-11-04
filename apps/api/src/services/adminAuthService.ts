import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import { env } from '../config';
import { Admin } from '../models';
import { now } from '../utils/clock';
import { AppError } from '../utils/errors';
import { audit, auditSafe, type Actor } from './auditService';

const MAX_FAILS = 5;
const LOCK_MS = 15 * 60_000;
// Used to equalize timing when the email does not exist.
const DUMMY_HASH = '$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHRzb21lc2FsdA$Yq5m2iJqkq0m0Z9tXG0v3Q0o9bV3v0m2b8bq1o3o7iY';

export const hashPassword = (pw: string) => argon2.hash(pw, { type: argon2.argon2id });

export async function login(email: string, password: string, actor: Actor) {
  const admin = await Admin.findOne({ email: email.toLowerCase() });
  const fail = async (why: string) => {
    await auditSafe({ actor, action: 'admin.login_failed', severity: 'security', metadata: { why, email } });
    return new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
  };

  if (!admin) {
    await argon2.verify(DUMMY_HASH, password).catch(() => false);
    throw await fail('unknown_email');
  }
  if (admin.status !== 'active') throw await fail('disabled');
  if (admin.lockedUntil && admin.lockedUntil > now()) throw new AppError(429, 'ACCOUNT_LOCKED', 'Too many attempts. Try again later.');

  if (!(await argon2.verify(admin.passwordHash, password).catch(() => false))) {
    const fails = admin.failedLoginCount + 1;
    await Admin.updateOne(
      { _id: admin._id },
      fails >= MAX_FAILS
        ? { $set: { failedLoginCount: 0, lockedUntil: new Date(now().getTime() + LOCK_MS) } }
        : { $set: { failedLoginCount: fails } },
    );
    throw await fail('bad_password');
  }

  await Admin.updateOne({ _id: admin._id }, { $set: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now() } });
  await audit({ actor: { ...actor, id: admin._id.toString() }, action: 'admin.login', targetType: 'Admin', targetId: admin._id.toString() });
  const token = jwt.sign({ sub: admin._id.toString(), role: admin.role }, env.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: env.ADMIN_JWT_TTL_SECONDS,
  });
  return { token, expiresIn: env.ADMIN_JWT_TTL_SECONDS };
}
