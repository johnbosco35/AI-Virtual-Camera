import pino from 'pino';
import { env } from './env';

export const logger = pino({
  level: env.NODE_ENV === 'test' ? 'silent' : env.LOG_LEVEL,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers["x-activation-code"]',
      'req.headers["x-avc-sig"]',
      '*.password',
      '*.signature',
      '*.publicKey',
      '*.activationCode',
      '*.token',
    ],
    censor: '[redacted]',
  },
});
