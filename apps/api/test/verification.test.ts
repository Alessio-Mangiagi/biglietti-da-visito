import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupApp, type TestCtx } from './helpers';

let ctx: TestCtx;
beforeAll(async () => {
  ctx = await setupApp({ env: { EMAIL_VERIFICATION: 'required' } });
});
afterAll(() => ctx.close());

const register = (email: string, password = 'Mela-verde-2026') =>
  ctx.app.inject({ method: 'POST', url: '/api/auth/register', payload: { email, password, displayName: 'Anna', acceptPrivacy: true } });
const login = (email: string, password = 'Mela-verde-2026') =>
  ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });
const linkToken = (text: string) => decodeURIComponent(/token=([^\s]+)/.exec(text)![1]!);

describe('e-mail verification', () => {
  it('registers without a session and sends a confirmation link', async () => {
    const email = `v${Date.now()}@test.it`;
    const res = await register(email);
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ status: 'verification_sent' });
    expect(res.cookies.find((c) => c.name === 'cv_refresh')).toBeUndefined();
    expect(ctx.mails.at(-1)).toMatchObject({ to: email, subject: expect.stringMatching(/Conferma/) });

    expect((await login(email)).json().code).toBe('EMAIL_NOT_VERIFIED');

    const verified = await ctx.app.inject({ method: 'POST', url: '/api/auth/verify-email', payload: { token: linkToken(ctx.mails.at(-1)!.text) } });
    expect(verified.statusCode).toBe(200);
    expect(verified.json().user.email).toBe(email);
    expect((await login(email)).statusCode).toBe(200);
  });

  it('answers identically for a taken address and warns its owner by e-mail', async () => {
    const email = `t${Date.now()}@test.it`;
    await register(email);
    await ctx.app.inject({ method: 'POST', url: '/api/auth/verify-email', payload: { token: linkToken(ctx.mails.at(-1)!.text) } });

    const again = await register(email, 'Altra-password-99');
    expect(again.statusCode).toBe(202);
    expect(again.json()).toEqual({ status: 'verification_sent' });
    expect(ctx.mails.at(-1)).toMatchObject({ to: email, subject: expect.stringMatching(/Tentativo di registrazione/) });
    // the original password still works: nothing was overwritten
    expect((await login(email)).statusCode).toBe(200);
  });

  it('a confirmation link works once', async () => {
    const email = `o${Date.now()}@test.it`;
    await register(email);
    const token = linkToken(ctx.mails.at(-1)!.text);
    expect((await ctx.app.inject({ method: 'POST', url: '/api/auth/verify-email', payload: { token } })).statusCode).toBe(200);
    expect((await ctx.app.inject({ method: 'POST', url: '/api/auth/verify-email', payload: { token } })).statusCode).toBe(400);
  });

  it('resends the link only to unconfirmed accounts', async () => {
    const email = `r${Date.now()}@test.it`;
    await register(email);
    const n = ctx.mails.length;
    expect((await ctx.app.inject({ method: 'POST', url: '/api/auth/resend-verification', payload: { email } })).statusCode).toBe(204);
    expect(ctx.mails.length).toBe(n + 1);
    await ctx.app.inject({ method: 'POST', url: '/api/auth/resend-verification', payload: { email: 'mai.visto@test.it' } });
    expect(ctx.mails.length).toBe(n + 1);
  });
});
