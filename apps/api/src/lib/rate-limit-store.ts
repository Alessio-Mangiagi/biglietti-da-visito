import type { Db } from '../db/pool';

type Cb = (err: Error | null, res?: { current: number; ttl: number }) => void;

/**
 * @fastify/rate-limit store backed by PostgreSQL, so every serverless instance shares the
 * same counters (in-memory limits reset per instance and can be dodged by spreading
 * requests). Fixed window per key; each route gets its own namespace like LocalStore.
 */
export function pgRateLimitStore(db: Db) {
  return class PgRateLimitStore {
    private ns: string;

    constructor(ns?: unknown) {
      this.ns = typeof ns === 'string' ? ns : 'global';
    }

    incr(key: string, cb: Cb, timeWindow: number) {
      db.query<{ hits: number; ttl: string }>(
        `INSERT INTO rate_limits AS r (key, window_start, hits) VALUES ($1, now(), 1)
         ON CONFLICT (key) DO UPDATE SET
           hits = CASE WHEN r.window_start + make_interval(secs => $2::float8 / 1000) <= now() THEN 1 ELSE r.hits + 1 END,
           window_start = CASE WHEN r.window_start + make_interval(secs => $2::float8 / 1000) <= now() THEN now() ELSE r.window_start END
         RETURNING hits,
           greatest(0, extract(epoch FROM (window_start + make_interval(secs => $2::float8 / 1000) - now())) * 1000)::bigint AS ttl`,
        [`${this.ns}|${key}`, timeWindow],
      ).then(
        ({ rows }) => {
          cb(null, { current: rows[0]!.hits, ttl: Number(rows[0]!.ttl) });
          // housekeeping, rarely: expired windows older than a day
          if (Math.random() < 0.01) void db.query(`DELETE FROM rate_limits WHERE window_start < now() - interval '1 day'`).catch(() => {});
        },
        (err: Error) => cb(err),
      );
    }

    child(routeOptions: object) {
      const info = (routeOptions as { routeInfo?: { method?: string; url?: string } }).routeInfo;
      return new PgRateLimitStore(`${info?.method ?? ''} ${info?.url ?? ''}`);
    }
  };
}
