import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, registerUser, setupApp, type TestCtx } from './helpers';

let ctx: TestCtx;
beforeAll(async () => {
  ctx = await setupApp();
});
afterAll(() => ctx.close());

describe('security regressions', () => {
  it('a vCard download link cannot be used as an API session', async () => {
    const u = await registerUser(ctx.app);
    const c = await ctx.app.inject({ method: 'POST', url: '/api/contacts', headers: auth(u.token), payload: { firstName: 'X' } });
    const { url } = (await ctx.app.inject({ method: 'POST', url: `/api/contacts/${c.json().contact.id}/vcard-link`, headers: auth(u.token) })).json();
    const linkToken = url.split('/').pop();
    const res = await ctx.app.inject({ method: 'GET', url: '/api/contacts', headers: auth(linkToken) });
    expect(res.statusCode).toBe(401);
  });

  it('a password reset ends access tokens already issued', async () => {
    const u = await registerUser(ctx.app);
    await ctx.app.inject({ method: 'POST', url: '/api/auth/forgot-password', payload: { email: u.email } });
    const token = decodeURIComponent(/token=([^\s]+)/.exec(ctx.mails.at(-1)!.text)![1]!);
    // tokens carry whole seconds: let the old one be issued in an earlier second
    await new Promise((r) => setTimeout(r, 1100));
    await ctx.app.inject({ method: 'POST', url: '/api/auth/reset-password', payload: { token, password: 'Nuova-Password-77' } });
    expect((await ctx.app.inject({ method: 'GET', url: '/api/me', headers: auth(u.token) })).statusCode).toBe(401);
  });

  it('tokens of a deleted account stop working', async () => {
    const u = await registerUser(ctx.app);
    await ctx.app.inject({ method: 'DELETE', url: '/api/me', headers: auth(u.token), payload: { password: 'password-sicura-123' } });
    expect((await ctx.app.inject({ method: 'GET', url: '/api/contacts', headers: auth(u.token) })).statusCode).toBe(401);
  });

  it('personal data is never cacheable', async () => {
    const u = await registerUser(ctx.app);
    const res = await ctx.app.inject({ method: 'GET', url: '/api/me', headers: auth(u.token) });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('forgot-password takes the same minimum time for unknown e-mails', async () => {
    const t0 = Date.now();
    await ctx.app.inject({ method: 'POST', url: '/api/auth/forgot-password', payload: { email: 'nessuno@x.it' } });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(Number(process.env.FORGOT_MIN_MS ?? 1500) - 20);
  });
});
