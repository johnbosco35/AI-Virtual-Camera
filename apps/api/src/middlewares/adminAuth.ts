import type { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config';
import { Admin, effectivePermissions } from '../models';
import { AppError } from '../utils/errors';

declare module 'express-serve-static-core' {
  interface Request {
    admin?: { id: string; email: string; permissions: Set<string> };
  }
}

/** Loads the admin on every request, so disabling an account or changing permissions takes effect immediately. */
export const requireAdmin: RequestHandler = async (req, _res, next) => {
  try {
    const header = req.header('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) throw new AppError(401, 'UNAUTHENTICATED', 'Sign in required.');
    let payload: jwt.JwtPayload;
    try {
      payload = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] }) as jwt.JwtPayload;
    } catch {
      throw new AppError(401, 'INVALID_TOKEN', 'Session expired. Sign in again.');
    }
    const admin = await Admin.findById(payload.sub);
    if (!admin || admin.status !== 'active') throw new AppError(401, 'INVALID_TOKEN', 'Session expired. Sign in again.');
    req.admin = { id: admin._id.toString(), email: admin.email, permissions: effectivePermissions(admin) };
    next();
  } catch (e) {
    next(e);
  }
};

export const requirePermission =
  (permission: string): RequestHandler =>
  (req, _res, next) => {
    if (!req.admin?.permissions.has(permission)) return next(new AppError(403, 'FORBIDDEN', 'You do not have permission for this action.'));
    next();
  };
