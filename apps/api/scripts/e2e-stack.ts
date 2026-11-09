/**
 * Throwaway stack for end-to-end tests: fresh embedded PostgreSQL + API on :3100.
 * Started by Playwright (see playwright.config.ts); data is deleted on exit.
 */
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { migrate } from '../src/db/migrate';
import { createPool } from '../src/db/pool';

const dir = mkdtempSync(join(tmpdir(), 'cardvault-e2e-'));
const pgPort = 55_432;
const pg = new EmbeddedPostgres({ databaseDir: dir, user: 'e2e', password: 'e2e', port: pgPort, persistent: false });
await pg.initialise();
await pg.start();
await pg.createDatabase('cardvault');

const config = loadConfig({
  NODE_ENV: 'test',
  HOST: '127.0.0.1',
  PORT: '3100',
  LOG_LEVEL: 'warn',
  DATABASE_URL: `postgres://e2e:e2e@127.0.0.1:${pgPort}/cardvault`,
  DATABASE_SSL: 'disable',
  JWT_SECRET: randomBytes(48).toString('base64'),
  IMAGE_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  APP_URL: 'http://localhost:4173',
  CORS_ORIGINS: 'http://localhost:4173,http://127.0.0.1:4173',
});
const db = createPool(config);
await migrate(db);
const app = await buildApp(config, db, { rateLimit: false });
await app.listen({ host: config.HOST, port: config.PORT });

const stop = async () => {
  await app.close();
  await db.end();
  await pg.stop();
  rmSync(dir, { recursive: true, force: true });
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
