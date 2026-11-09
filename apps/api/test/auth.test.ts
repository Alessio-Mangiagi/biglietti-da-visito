import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, registerUser, setupApp, type TestCtx } from './helpers';

let ctx: TestCtx;
beforeAll(async () => {
  ctx = await setupApp();
});
afterAll(() => ctx.close());

const cookieOf = (res: { cookies: Array<{ name: string; value: string }> }) => {
  const c = res.cookies.find((x) => x.name === 'cv_refresh');
  return c ? `cv_refresh=${c.value}` : undefined;
};

describe('auth', () => {
  it('registers, rejects duplicate e-mail case-insensitively', async () => {
    const u = await registerUser(ctx.app);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: u.email.toUpperCase(), password: 'altra-password-1', displayName: 'X', acceptPrivacy: true },
    });
    expect(res.statusCode).toBe(409);
  });

  it('requires privacy acceptance and a 10+ char password', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'a@b.it', password: 'corta', displayName: 'X', acceptPrivacy: false },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().issues.map((i: { path: string }) => i.path)).toEqual(expect.arrayContaining(['password', 'acceptPrivacy']));
  });

  it('sets an httpOnly refresh cookie scoped to /api/auth', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: `c${Date.now()}@test.it`, password: 'password-sicura-123', displayName: 'C', acceptPrivacy: true },
    });
    const c = res.cookies.find((x) => x.name === 'cv_refresh')!;
    expect(c.httpOnly).toBe(true);
    expect(c.path).toBe('/api/auth');
    expect(String(c.sameSite).toLowerCase()).toBe('lax');
  });

  it('logs in and rejects bad passwords with the same message as unknown users', async () => {
    const u = await registerUser(ctx.app);
    const ok = await ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: u.email, password: 'password-sicura-123' } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().user.email).toBe(u.email);
    const bad = await ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: u.email, password: 'sbagliata' } });
    const unknown = await ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'nessuno@test.it', password: 'sbagliata' } });
    expect(bad.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(bad.json().message).toBe(unknown.json().message);
  });

  it('rejects requests without a valid access token', async () => {
    expect((await ctx.app.inject({ method: 'GET', url: '/api/contacts' })).statusCode).toBe(401);
    expect((await ctx.app.inject({ method: 'GET', url: '/api/contacts', headers: auth('nope') })).statusCode).toBe(401);
  });

  it('rotates refresh tokens and revokes the family when an old one is replayed', async () => {
    const u = await registerUser(ctx.app);
    const r1 = await ctx.app.inject({ method: 'POST', url: '/api/auth/refresh', headers: { cookie: u.cookie } });
    expect(r1.statusCode).toBe(200);
    const c2 = cookieOf(r1)!;
    expect(c2).not.toBe(u.cookie);
    // old token replayed after the grace window → family revoked
    await ctx.db.query(`UPDATE refresh_tokens SET rotated_at = now() - interval '1 hour' WHERE rotated_at IS NOT NULL AND user_id = $1`, [u.userId]);
    const replay = await ctx.app.inject({ method: 'POST', url: '/api/auth/refresh', headers: { cookie: u.cookie } });
    expect(replay.statusCode).toBe(401);
    const after = await ctx.app.inject({ method: 'POST', url: '/api/auth/refresh', headers: { cookie: c2 } });
    expect(after.statusCode).toBe(401);
  });

  it('tolerates concurrent refresh with the same token (grace window)', async () => {
    const u = await registerUser(ctx.app);
    const [a, b] = await Promise.all([
      ctx.app.inject({ method: 'POST', url: '/api/auth/refresh', headers: { cookie: u.cookie } }),
      ctx.app.inject({ method: 'POST', url: '/api/auth/refresh', headers: { cookie: u.cookie } }),
    ]);
    expect([a.statusCode, b.statusCode]).toEqual([200, 200]);
  });

  it('refuses refresh from a foreign origin', async () => {
    const u = await registerUser(ctx.app);
    const res = await ctx.app.inject({ method: 'POST', url: '/api/auth/refresh', headers: { cookie: u.cookie, origin: 'https://evil.example' } });
    expect(res.statusCode).toBe(403);
  });

  it('logout revokes the session', async () => {
    const u = await registerUser(ctx.app);
    const out = await ctx.app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie: u.cookie } });
    expect(out.statusCode).toBe(204);
    const res = await ctx.app.inject({ method: 'POST', url: '/api/auth/refresh', headers: { cookie: u.cookie } });
    expect(res.statusCode).toBe(401);
  });

  it('password reset: mail link works once and ends other sessions', async () => {
    const u = await registerUser(ctx.app);
    const forgot = await ctx.app.inject({ method: 'POST', url: '/api/auth/forgot-password', payload: { email: u.email } });
    expect(forgot.statusCode).toBe(204);
    const mail = ctx.mails.at(-1)!;
    expect(mail.to).toBe(u.email);
    const token = decodeURIComponent(/token=([^\s]+)/.exec(mail.text)![1]!);
    const reset = await ctx.app.inject({ method: 'POST', url: '/api/auth/reset-password', payload: { token, password: 'nuova-password-456' } });
    expect(reset.statusCode).toBe(204);
    const again = await ctx.app.inject({ method: 'POST', url: '/api/auth/reset-password', payload: { token, password: 'nuova-password-789' } });
    expect(again.statusCode).toBe(400);
    expect((await ctx.app.inject({ method: 'POST', url: '/api/auth/refresh', headers: { cookie: u.cookie } })).statusCode).toBe(401);
    const login = await ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: u.email, password: 'nuova-password-456' } });
    expect(login.statusCode).toBe(200);
  });

  it('forgot-password does not reveal unknown e-mails', async () => {
    const n = ctx.mails.length;
    const res = await ctx.app.inject({ method: 'POST', url: '/api/auth/forgot-password', payload: { email: 'sconosciuto@test.it' } });
    expect(res.statusCode).toBe(204);
    expect(ctx.mails.length).toBe(n);
  });

  it('change-password keeps the current session and ends the others', async () => {
    const u = await registerUser(ctx.app);
    const other = await ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: u.email, password: 'password-sicura-123' } });
    const otherCookie = cookieOf(other)!;
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      headers: { ...auth(u.token), cookie: u.cookie },
      payload: { currentPassword: 'password-sicura-123', newPassword: 'cambiata-password-1' },
    });
    expect(res.statusCode).toBe(204);
    expect((await ctx.app.inject({ method: 'POST', url: '/api/auth/refresh', headers: { cookie: u.cookie } })).statusCode).toBe(200);
    expect((await ctx.app.inject({ method: 'POST', url: '/api/auth/refresh', headers: { cookie: otherCookie } })).statusCode).toBe(401);
  });

  it('locks the account after repeated failures', async () => {
    const u = await registerUser(ctx.app);
    await ctx.db.query('UPDATE users SET failed_logins = 9 WHERE id = $1', [u.userId]);
    await ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: u.email, password: 'sbagliata' } });
    const res = await ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: u.email, password: 'password-sicura-123' } });
    expect(res.statusCode).toBe(429);
  });
});
