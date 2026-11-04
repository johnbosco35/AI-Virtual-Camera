import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { env, logger } from './config';
import { errorHandler, notFound } from './middlewares/errorHandler';
import { globalLimiter } from './middlewares/rateLimit';
import { adminRouter } from './routes/admin';
import { publicRouter } from './routes/public';

export function createApp() {
  const app = express();
  app.set('trust proxy', env.TRUST_PROXY);
  app.disable('x-powered-by');

  app.use(helmet());
  const allowed = env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || allowed.includes(origin)), // non-browser clients have no Origin
      allowedHeaders: ['content-type', 'authorization', 'x-activation-code', 'x-avc-ts', 'x-avc-sig'],
    }),
  );
  app.use(pinoHttp({ logger, autoLogging: env.NODE_ENV !== 'test' }));
  app.use(express.json({ limit: '32kb' }));
  app.use(globalLimiter);

  app.use('/api/admin', adminRouter);
  app.use('/api', publicRouter);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
