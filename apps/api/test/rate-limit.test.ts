import { afterAll, beforeAll, expect, it } from 'vitest';
import { setupApp, type TestCtx } from './helpers';

let ctx: TestCtx;
beforeAll(async () => {
  ctx = await setupApp({ rateLimit: true });
});
afterAll(() => ctx.close());

it('throttles login attempts per IP', async () => {
  const codes: number[] = [];
  for (let i = 0; i < 12; i++) {
    const res = await ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'x@y.it', password: 'nope' } });
    codes.push(res.statusCode);
  }
  expect(codes.slice(0, 10).every((c) => c === 401)).toBe(true);
  expect(codes.at(-1)).toBe(429);
});
