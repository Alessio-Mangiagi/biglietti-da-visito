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
  // TLS is configured explicitly below; sslmode/channel_binding in hosted URLs (Neon)
  // would otherwise override it with different semantics
  const url = new URL(config.DATABASE_URL);
  for (const k of ['sslmode', 'sslrootcert', 'channel_binding']) url.searchParams.delete(k);
  const pool = new pg.Pool({
    connectionString: url.toString(),
    ssl,
    max: config.DATABASE_POOL_MAX,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: 'cardvault-api',
  });
  // An idle client dropped by the server (DB restart, network blip) emits 'error' on the
  // pool; unhandled, it would crash the process. The pool replaces the client on next use.
  pool.on('error', (err) => onError(err));
  return pool;
}

let onError: (err: Error) => void = (err) => console.error('PostgreSQL: connessione inattiva persa', err.message);
export function onPoolError(fn: (err: Error) => void) {
  onError = fn;
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
