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
  /**
   * Number of reverse proxies in front of the API ('true' = 1). Only that many hops of
   * X-Forwarded-For are trusted: the client can prepend fake entries to the header, so
   * trusting all of it would let anyone pick their IP and dodge rate limits.
   */
  TRUST_PROXY: z
    .string()
    .default('false')
    .transform((v, ctx) => {
      if (v === 'false' || v === '0') return 0;
      if (v === 'true') return 1;
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0 || n > 5) {
        ctx.addIssue({ code: 'custom', message: 'TRUST_PROXY: true, false o numero di proxy (0-5)' });
        return z.NEVER;
      }
      return n;
    }),

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
  /** memory: one API process (VPS). postgres: counters shared by many instances (serverless). */
  RATE_LIMIT_STORE: z.enum(['memory', 'postgres']).default('memory'),

  /** Public origin of the PWA, used for CORS and links in e-mails. */
  APP_URL: z.string().url(),
  CORS_ORIGINS: z.string().optional(),
  COOKIE_SECURE: bool.optional(),
  COOKIE_SAMESITE: z.enum(['strict', 'lax', 'none']).default('lax'),
  COOKIE_DOMAIN: z.string().optional(),

  /** smtp(s)://user:pass@host:port — when missing, e-mails are written to the log. */
  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default('CardVault <no-reply@localhost>'),
  /** AgentMail (Vercel Marketplace): set by the integration; takes precedence over SMTP. */
  AGENTMAIL_API_KEY: z.string().optional(),
  /** Optional: reuse an existing inbox instead of the app's own one. */
  AGENTMAIL_INBOX_ID: z.string().optional(),
  AGENTMAIL_USERNAME: z.string().default('cardvault-notifiche'),
  /** auto: required as soon as the app can send e-mail (AgentMail or SMTP). */
  EMAIL_VERIFICATION: z.enum(['auto', 'required', 'off']).default('auto'),
});

export type Env = z.infer<typeof EnvSchema>;

export interface Config extends Env {
  corsOrigins: string[];
  cookieSecure: boolean;
  databaseCa?: string;
  imageKey: Buffer;
  /** New accounts must confirm their e-mail before the first login. */
  emailVerification: boolean;
}

/**
 * On Vercel the platform provides the public URL and the Neon integration provides
 * POSTGRES_URL/DATABASE_URL: fill the gaps so only the secrets must be set by hand.
 */
function withPlatformDefaults(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (!env.VERCEL) return env;
  const host = env.VERCEL_PROJECT_PRODUCTION_URL ?? env.VERCEL_URL;
  const origins = [env.VERCEL_PROJECT_PRODUCTION_URL, env.VERCEL_URL, env.VERCEL_BRANCH_URL]
    .filter(Boolean)
    .map((h) => `https://${h}`);
  return {
    NODE_ENV: 'production',
    TRUST_PROXY: 'true',
    RATE_LIMIT_STORE: 'postgres',
    ...env,
    DATABASE_URL: env.DATABASE_URL ?? env.POSTGRES_URL,
    APP_URL: env.APP_URL ?? (host ? `https://${host}` : undefined),
    // previews have their own URL: let their refresh requests through the origin check
    CORS_ORIGINS: env.CORS_ORIGINS ?? (origins.length ? [...new Set(origins)].join(',') : undefined),
  };
}

export function loadConfig(rawEnv: NodeJS.ProcessEnv = process.env): Config {
  const env = withPlatformDefaults(rawEnv);
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
    emailVerification:
      e.EMAIL_VERIFICATION === 'required' || (e.EMAIL_VERIFICATION === 'auto' && !!(e.AGENTMAIL_API_KEY || e.SMTP_URL)),
  };
}
