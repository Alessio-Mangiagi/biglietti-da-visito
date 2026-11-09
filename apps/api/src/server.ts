import { buildApp } from './app';
import { loadConfig } from './config';
import { migrate } from './db/migrate';
import { createPool } from './db/pool';

const config = loadConfig();
const db = createPool(config);
const app = await buildApp(config, db);

if (process.env.AUTO_MIGRATE !== 'false') {
  await migrate(db, (m) => app.log.info(m));
}

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'arresto in corso');
  await app.close();
  await db.end();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ host: config.HOST, port: config.PORT });
