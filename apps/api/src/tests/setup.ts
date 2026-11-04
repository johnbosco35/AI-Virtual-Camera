import { MongoMemoryServer } from 'mongodb-memory-server';
import { hexToBase58 } from '../utils/tronAddress';

// Must run before any module imports config/env.
// ttlMonitorSleepSecs=1 lets the real TTL monitor run every second so the integration test can observe real deletion.
const mongod = await MongoMemoryServer.create({ instance: { args: ['--setParameter', 'ttlMonitorSleepSecs=1'] } });
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = mongod.getUri('avc_test');
process.env.JWT_SECRET = 'j'.repeat(40);
process.env.SERVER_SECRET = 's'.repeat(40);
process.env.TRON_NETWORK = 'nile';
process.env.TRON_USDT_CONTRACT = hexToBase58('41' + '22'.repeat(20));
process.env.PAYMENT_DESTINATION_ADDRESS = hexToBase58('41' + '11'.repeat(20));
process.env.JOBS_ENABLED = 'false';

import { afterAll } from 'vitest';
afterAll(async () => {
  await mongod.stop();
});
