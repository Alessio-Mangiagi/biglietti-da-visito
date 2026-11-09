import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { inject } from 'vitest';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { migrate } from '../src/db/migrate';
import { createPool, type Db } from '../src/db/pool';
import type { Mail } from '../src/lib/mailer';

export interface TestCtx {
  app: FastifyInstance;
  db: Db;
  mails: Mail[];
  close: () => Promise<void>;
}

export async function setupApp(opts: { rateLimit?: boolean } = {}): Promise<TestCtx> {
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: inject('databaseUrl'),
    DATABASE_SSL: 'disable',
    JWT_SECRET: randomBytes(48).toString('base64'),
    IMAGE_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    APP_URL: 'http://localhost:5173',
    LOG_LEVEL: 'silent',
  });
  const db = createPool(config);
  await migrate(db);
  const mails: Mail[] = [];
  const app = await buildApp(config, db, { logger: false, rateLimit: opts.rateLimit ?? false, mailer: { send: async (m) => void mails.push(m) } });
  await app.ready();
  return {
    app,
    db,
    mails,
    close: async () => {
      await app.close();
      await db.end();
    },
  };
}

let seq = 0;
export async function registerUser(app: FastifyInstance, email = `user${Date.now()}${seq++}@test.it`) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { email, password: 'password-sicura-123', displayName: 'Mario Test', acceptPrivacy: true },
  });
  if (res.statusCode !== 201) throw new Error(`register failed: ${res.body}`);
  const body = res.json() as { accessToken: string; user: { id: string } };
  const cookie = res.cookies.find((c) => c.name === 'cv_refresh')!;
  return { token: body.accessToken, userId: body.user.id, email, cookie: `${cookie.name}=${cookie.value}` };
}

export const auth = (token: string) => ({ authorization: `Bearer ${token}` });
