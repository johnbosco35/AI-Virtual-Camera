import 'dotenv/config';
import { z } from 'zod';
import { isValidTronAddress } from '../utils/tronAddress';

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().default(4000),
    MONGODB_URI: z.string().min(1),
    CORS_ORIGINS: z.string().default('http://localhost:5173'),
    TRUST_PROXY: z.coerce.number().int().default(0),
    JWT_SECRET: z.string().min(32),
    ADMIN_JWT_TTL_SECONDS: z.coerce.number().int().default(900),
    SERVER_SECRET: z.string().min(32),
    TRON_NETWORK: z.enum(['mainnet', 'shasta', 'nile']).default('nile'),
    TRON_API_KEY: z.string().optional(),
    TRON_USDT_CONTRACT: z.string().optional(),
    PAYMENT_DESTINATION_ADDRESS: z.string(),
    ORDER_TTL_MINUTES: z.coerce.number().int().min(5).default(30),
    RELEASE_STORAGE_DIR: z.string().default('./releases'),
    DOWNLOAD_TOKEN_TTL_SECONDS: z.coerce.number().int().default(300),
    JOBS_ENABLED: z.enum(['true', 'false']).default('true'),
    LOG_LEVEL: z.string().default('info'),
    PRODUCT_PRICE_USDT: z.string().default('25.00'),
  })
  .superRefine((v, ctx) => {
    if (!isValidTronAddress(v.PAYMENT_DESTINATION_ADDRESS)) {
      ctx.addIssue({ code: 'custom', path: ['PAYMENT_DESTINATION_ADDRESS'], message: 'Must be a valid TRON base58 address' });
    }
    if (v.TRON_NETWORK !== 'mainnet' && !v.TRON_USDT_CONTRACT) {
      ctx.addIssue({ code: 'custom', path: ['TRON_USDT_CONTRACT'], message: 'Required on testnets' });
    }
    if (v.NODE_ENV === 'production' && v.TRON_NETWORK !== 'mainnet') {
      ctx.addIssue({ code: 'custom', path: ['TRON_NETWORK'], message: 'Production must use mainnet' });
    }
    if (v.NODE_ENV === 'production' && /replace-with|change-me/i.test(v.JWT_SECRET + v.SERVER_SECRET)) {
      ctx.addIssue({ code: 'custom', path: ['JWT_SECRET'], message: 'Placeholder secrets are not allowed in production' });
    }
  });

export const env = schema.parse(process.env);

/** Official USDT TRC-20 contract on TRON mainnet. */
const MAINNET_USDT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

export const tron = {
  network: env.TRON_NETWORK,
  baseUrl: {
    mainnet: 'https://api.trongrid.io',
    shasta: 'https://api.shasta.trongrid.io',
    nile: 'https://nile.trongrid.io',
  }[env.TRON_NETWORK],
  usdtContract: env.TRON_USDT_CONTRACT ?? MAINNET_USDT,
  destination: env.PAYMENT_DESTINATION_ADDRESS,
  apiKey: env.TRON_API_KEY,
};

export const SESSION_SECONDS = 900;
export const SESSION_DELETE_DELAY_MS = 5 * 60 * 1000;
