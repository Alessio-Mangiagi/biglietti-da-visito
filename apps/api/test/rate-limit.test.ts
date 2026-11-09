import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupApp, type TestCtx } from './helpers';

const login = (ctx: TestCtx, xff?: string) =>
  ctx.app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: 'x@y.it', password: 'nope' },
    headers: xff ? { 'x-forwarded-for': xff } : {},
  });

describe('rate limiting (memory store)', () => {
  let ctx: TestCtx;
  beforeAll(async () => {
    ctx = await setupApp({ rateLimit: true });
  });
  afterAll(() => ctx.close());

  it('throttles login attempts per IP', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) codes.push((await login(ctx)).statusCode);
    expect(codes.slice(0, 10).every((c) => c === 401)).toBe(true);
    expect(codes.at(-1)).toBe(429);
  });
});

describe('rate limiting behind one proxy, shared PostgreSQL store', () => {
  let ctx: TestCtx;
  beforeAll(async () => {
    ctx = await setupApp({ rateLimit: true, env: { TRUST_PROXY: '1', RATE_LIMIT_STORE: 'postgres' } });
    await ctx.db.query('DELETE FROM rate_limits');
  });
  afterAll(() => ctx.close());

  it('cannot be dodged by forging X-Forwarded-For', async () => {
    const codes: number[] = [];
    // the client prepends a random fake address; the proxy appends the real one (203.0.113.7)
    for (let i = 0; i < 12; i++) codes.push((await login(ctx, `10.0.0.${i}, 203.0.113.7`)).statusCode);
    expect(codes.at(-1)).toBe(429);
  });

  it('keeps separate budgets for different real clients', async () => {
    expect((await login(ctx, '1.2.3.4, 198.51.100.9')).statusCode).toBe(401);
  });

  it('stores counters in PostgreSQL so every instance sees them', async () => {
    const { rows } = await ctx.db.query(`SELECT hits FROM rate_limits WHERE key LIKE '%/api/auth/login|203.0.113.7'`);
    expect(rows[0]?.hits).toBeGreaterThanOrEqual(12);
  });
});
