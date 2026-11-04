import mongoose from 'mongoose';
import { env } from '../src/config';
import { Admin } from '../src/models';
import { hashPassword } from '../src/services/adminAuthService';

(async () => {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password || password.length < 12) {
    console.error('Set ADMIN_EMAIL and ADMIN_PASSWORD (min 12 chars) in the environment for this one command.');
    process.exit(1);
  }
  await mongoose.connect(env.MONGODB_URI);
  await Admin.create({ email, passwordHash: await hashPassword(password), role: 'superadmin' });
  console.log('superadmin created:', email);
  await mongoose.disconnect();
})();
