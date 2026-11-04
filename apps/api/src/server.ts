import mongoose from 'mongoose';
import { createApp } from './app';
import { env, logger } from './config';
import { startJobs, verifyTtlIndex } from './jobs/maintenance';
import { Admin, AuditLog, DeviceActivation, Entitlement, Order, Payment, Product, Release, UsedNonce, VideoSession } from './models';

async function main() {
  await mongoose.connect(env.MONGODB_URI);
  if (env.NODE_ENV !== 'production') {
    await Promise.all([Admin, AuditLog, DeviceActivation, Entitlement, Order, Payment, Product, Release, UsedNonce, VideoSession].map((m) => m.createIndexes()));
  }
  // In production run `npm run db:init-indexes` during deploys. The check below alerts if the TTL index is missing.
  if (!(await verifyTtlIndex())) logger.fatal('TTL index missing: completed sessions will not be cleaned up.');

  const stopJobs = env.JOBS_ENABLED === 'true' ? startJobs() : () => undefined;
  const server = createApp().listen(env.PORT, () => logger.info(`API listening on :${env.PORT} (${env.TRON_NETWORK})`));

  const shutdown = () => {
    stopJobs();
    server.close(() => mongoose.disconnect().finally(() => process.exit(0)));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  logger.fatal({ err }, 'startup failed');
  process.exit(1);
});
