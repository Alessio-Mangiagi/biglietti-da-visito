import { readFileSync } from 'node:fs';
import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  TRUST_PROXY: bool.default(false),

  DATABASE_URL: z.string().url(),
  /** disable (dev only) | require (TLS, no CA check) | verify-full (TLS + CA + hostname). */
  DATABASE_SSL: z.enum(['disable', 'require', 'verify-full']).default('verify-full'),
  DATABASE_CA_FILE: z.string().optional(),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).default(10),

  /** ≥ 32 random bytes, base64. `openssl rand -base64 48` */
  JWT_SECRET: z.string().min(43, 'JWT_SECRET troppo corto (min 32 byte base64)'),
  ACCESS_TOKEN_TTL: z.coerce.number().int().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().default(30),
  /** 32 bytes base64 — AES-256-GCM key for card images. `openssl rand -base64 32` */
  IMAGE_ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, 'base64').length === 32, 'IMAGE_ENCRYPTION_KEY deve essere 32 byte base64'),
  MAX_IMAGE_BYTES: z.coerce.number().int().default(2 * 1024 * 1024),

  /** Public origin of the PWA, used for CORS and links in e-mails. */
  APP_URL: z.string().url(),
  CORS_ORIGINS: z.string().optional(),
  COOKIE_SECURE: bool.optional(),
  COOKIE_SAMESITE: z.enum(['strict', 'lax', 'none']).default('lax'),
  COOKIE_DOMAIN: z.string().optional(),

  /** smtp(s)://user:pass@host:port — when missing, e-mails are written to the log. */
  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default('CardVault <no-reply@localhost>'),
});

export type Env = z.infer<typeof EnvSchema>;

export interface Config extends Env {
  corsOrigins: string[];
  cookieSecure: boolean;
  databaseCa?: string;
  imageKey: Buffer;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Configurazione non valida:\n${msg}`);
  }
  const e = parsed.data;
  if (e.NODE_ENV === 'production' && e.DATABASE_SSL === 'disable') {
    throw new Error('DATABASE_SSL=disable non è ammesso in produzione');
  }
  return {
    ...e,
    corsOrigins: (e.CORS_ORIGINS ?? new URL(e.APP_URL).origin)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    cookieSecure: e.COOKIE_SECURE ?? e.NODE_ENV === 'production',
    databaseCa: e.DATABASE_CA_FILE ? readFileSync(e.DATABASE_CA_FILE, 'utf8') : undefined,
    imageKey: Buffer.from(e.IMAGE_ENCRYPTION_KEY, 'base64'),
  };
}
