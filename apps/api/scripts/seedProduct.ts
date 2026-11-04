import mongoose from 'mongoose';
import { env } from '../src/config';
import { Product } from '../src/models';
import { parseDecimalToBaseUnits } from '../src/utils/money';

(async () => {
  await mongoose.connect(env.MONGODB_URI);
  await Product.updateOne(
    { _id: 'avc-standard' },
    { $setOnInsert: { name: 'AI Virtual Camera: one device, one 15-minute session', priceBaseUnits: parseDecimalToBaseUnits(env.PRODUCT_PRICE_USDT).toString(), version: '0.1.0', active: true } },
    { upsert: true },
  );
  console.log('product seeded (price is only set on first insert)');
  await mongoose.disconnect();
})();
