import { z } from 'zod';

const bool = z
  .string()
  .optional()
  .transform(v => v === undefined ? undefined : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase()));

const key32 = z
  .string()
  .min(1, 'is required')
  .refine(v => Buffer.from(v, 'base64').length === 32, 'must be 32 bytes, base64 encoded');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8080),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().min(1),
  CORS_ORIGINS: z.string().default(''),
  CODE_ENCRYPTION_KEY: key32,
  CODE_HMAC_KEY: key32,
  RUN_WORKER: bool,

  PAYMENTS_ADAPTER: z.enum(['mock', 'safaricom']).default('mock'),
  MPESA_BASE_URL: z.string().default('https://apisandbox.safaricom.et'),
  MPESA_CONSUMER_KEY: z.string().default(''),
  MPESA_CONSUMER_SECRET: z.string().default(''),
  MPESA_SHORTCODE: z.string().default(''),
  MPESA_PASSKEY: z.string().default(''),
  PUBLIC_BASE_URL: z.string().default('http://localhost:8080'),
  MPESA_CALLBACK_SECRET: z.string().default(''),

  GIFTCARD_ADAPTER: z.enum(['mock', 'wupex']).default('mock'),
  WUPEX_BASE_URL: z.string().default(''),
  WUPEX_API_KEY: z.string().default(''),
  WUPEX_API_SECRET: z.string().default(''),

  NOTIFY_ADAPTER: z.enum(['log']).default('log')
});

export type Config = z.infer<typeof schema> & { runWorker: boolean; corsOrigins: string[] };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map(i => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid configuration:\n${lines.join('\n')}`);
  }
  const c = parsed.data;
  if (c.NODE_ENV === 'production') {
    if (c.PAYMENTS_ADAPTER === 'mock') throw new Error('PAYMENTS_ADAPTER=mock is not allowed in production');
    if (c.GIFTCARD_ADAPTER === 'mock') throw new Error('GIFTCARD_ADAPTER=mock is not allowed in production');
    if (c.MPESA_CALLBACK_SECRET.length < 24) throw new Error('MPESA_CALLBACK_SECRET must be at least 24 characters in production');
  }
  return {
    ...c,
    runWorker: c.RUN_WORKER ?? c.NODE_ENV !== 'test',
    corsOrigins: c.CORS_ORIGINS.split(',').map(s => s.trim()).filter(Boolean)
  };
}
