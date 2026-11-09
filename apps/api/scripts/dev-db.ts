/**
 * Local PostgreSQL without Docker: downloads nothing at runtime (binaries come from the
 * embedded-postgres npm package), keeps data in apps/api/.pgdata, writes .env on first run.
 *   pnpm dev:db   → leave running, then `pnpm dev` in another terminal
 */
import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';

const root = join(import.meta.dirname, '..');
const dataDir = join(root, '.pgdata');
const port = Number(process.env.DEV_DB_PORT ?? 5433);
const fresh = !existsSync(join(dataDir, 'PG_VERSION'));

const pg = new EmbeddedPostgres({ databaseDir: dataDir, user: 'cardvault', password: 'cardvault', port, persistent: true });
if (fresh) await pg.initialise();
await pg.start();
if (fresh) await pg.createDatabase('cardvault');

const url = `postgres://cardvault:cardvault@127.0.0.1:${port}/cardvault`;
const envFile = join(root, '.env');
if (!existsSync(envFile)) {
  writeFileSync(
    envFile,
    [
      'NODE_ENV=development',
      'PORT=3000',
      `DATABASE_URL=${url}`,
      'DATABASE_SSL=disable',
      `JWT_SECRET=${randomBytes(48).toString('base64')}`,
      `IMAGE_ENCRYPTION_KEY=${randomBytes(32).toString('base64')}`,
      'APP_URL=http://localhost:5173',
      'LOG_LEVEL=info',
      '',
    ].join('\n'),
  );
  console.log('Creato apps/api/.env con segreti casuali');
}
console.log(`PostgreSQL pronto: ${url}  (Ctrl+C per fermare)`);

const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
setInterval(() => {}, 1 << 30);
