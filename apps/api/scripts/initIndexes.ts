import mongoose from 'mongoose';
import { env } from '../src/config';
import { verifyTtlIndex } from '../src/jobs/maintenance';
import { Admin, AuditLog, DeviceActivation, Entitlement, Order, Payment, Product, Release, UsedNonce, VideoSession } from '../src/models';

(async () => {
  await mongoose.connect(env.MONGODB_URI);
  for (const m of [Admin, AuditLog, DeviceActivation, Entitlement, Order, Payment, Product, Release, UsedNonce, VideoSession]) {
    await m.createIndexes();
    console.log('indexes ok:', m.modelName);
  }
  console.log('TTL index verified:', await verifyTtlIndex());
  await mongoose.disconnect();
})();
