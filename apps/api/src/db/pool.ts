import pg from 'pg';
import type { Config } from '../config';

// DATE columns come back as 'YYYY-MM-DD' strings, not JS Dates shifted by the server TZ
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);

export type Db = pg.Pool;

export function createPool(config: Pick<Config, 'DATABASE_URL' | 'DATABASE_SSL' | 'databaseCa' | 'DATABASE_POOL_MAX'>): Db {
  const ssl =
    config.DATABASE_SSL === 'disable'
      ? false
      : config.DATABASE_SSL === 'require'
        ? { rejectUnauthorized: false }
        : { rejectUnauthorized: true, ca: config.databaseCa };
  return new pg.Pool({
    connectionString: config.DATABASE_URL,
    ssl,
    max: config.DATABASE_POOL_MAX,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: 'cardvault-api',
  });
}

export async function withTransaction<T>(db: Db, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
