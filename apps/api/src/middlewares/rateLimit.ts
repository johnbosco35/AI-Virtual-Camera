import rateLimit from 'express-rate-limit';
import { env } from '../config';

const make = (windowMs: number, limit: number) =>
  rateLimit({
    windowMs,
    limit: env.NODE_ENV === 'test' ? 10_000 : limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: { code: 'RATE_LIMITED', message: 'Too many requests. Slow down.' } },
  });

export const globalLimiter = make(60_000, 300);
export const orderLimiter = make(60_000, 10);
export const paymentVerifyLimiter = make(60_000, 20);
export const activationLimiter = make(60_000, 15);
export const sessionLimiter = make(60_000, 60);
export const adminLoginLimiter = make(15 * 60_000, 10);
