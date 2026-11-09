import {
  ChangePasswordSchema,
  ForgotPasswordSchema,
  LoginSchema,
  RegisterSchema,
  ResetPasswordSchema,
  VerifyEmailSchema,
  type AuthResponse,
  type RegisterPending,
  type User,
} from '@cardvault/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { parse } from '../app';
import { withTransaction } from '../db/pool';
import { newToken, sha256 } from '../lib/crypto';
import { HttpError, unauthorized } from '../lib/errors';
import { burnPasswordCheck, hashPassword, verifyPassword } from '../lib/password';

export const REFRESH_COOKIE = 'cv_refresh';
/** Wrong passwords allowed from one IP for one account within LOCK_MINUTES. */
const MAX_FAILED_LOGINS = 10;
/** Across all IPs: only a distributed attack gets here. */
const MAX_FAILED_LOGINS_ACCOUNT = 100;
const LOCK_MINUTES = 15;
const RESET_TTL_MINUTES = 60;
const VERIFY_TTL_HOURS = 48;
/** Two tabs refreshing at once present the same token; tolerate that briefly. */
const REUSE_GRACE_SECONDS = 30;
/** forgot-password always takes at least this long (hides DB + SMTP time for real accounts). */
export const FORGOT_MIN_MS = Number(process.env.FORGOT_MIN_MS ?? 1500);

interface UserRow {
  id: string;
  email: string;
  display_name: string;
  password_hash: string;
  failed_logins: number;
  locked_until: Date | null;
  email_verified_at: Date | null;
  created_at: Date;
}

export const toUser = (r: Pick<UserRow, 'id' | 'email' | 'display_name' | 'created_at'>): User => ({
  id: r.id,
  email: r.email,
  displayName: r.display_name,
  createdAt: r.created_at.toISOString(),
});

const authLimit = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

export async function authRoutes(app: FastifyInstance) {
  const { db, config, tokens, mailer } = app.deps;

  const cookieOpts = {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: config.COOKIE_SAMESITE,
    path: '/api/auth',
    domain: config.COOKIE_DOMAIN,
  } as const;

  /** Cookie-authenticated endpoints accept only our own origins (CSRF defence in depth). */
  function checkOrigin(req: FastifyRequest) {
    const origin = req.headers.origin;
    if (origin && !config.corsOrigins.includes(origin)) throw new HttpError(403, 'Origine non consentita', 'BAD_ORIGIN');
  }

  async function startSession(reply: FastifyReply, req: FastifyRequest, user: User, familyId?: string): Promise<AuthResponse> {
    const raw = newToken();
    await db.query(
      `INSERT INTO refresh_tokens (user_id, family_id, token_hash, user_agent, expires_at)
       VALUES ($1, coalesce($2::uuid, gen_random_uuid()), $3, $4, now() + make_interval(days => $5))`,
      [user.id, familyId ?? null, sha256(raw), req.headers['user-agent']?.slice(0, 300) ?? null, config.REFRESH_TOKEN_TTL_DAYS],
    );
    reply.setCookie(REFRESH_COOKIE, raw, { ...cookieOpts, maxAge: config.REFRESH_TOKEN_TTL_DAYS * 86400 });
    return { accessToken: await tokens.sign(user.id), expiresIn: tokens.ttl, user };
  }

  const appUrl = config.APP_URL.replace(/\/$/, '');
  /** Pads a response to a fixed minimum duration so timing does not reveal account existence. */
  const atLeast = (started: number) => new Promise((r) => setTimeout(r, Math.max(0, FORGOT_MIN_MS - (Date.now() - started))));

  async function sendVerification(user: Pick<UserRow, 'id' | 'email' | 'display_name'>) {
    const raw = newToken();
    await db.query('DELETE FROM email_verifications WHERE user_id = $1', [user.id]);
    await db.query(
      `INSERT INTO email_verifications (token_hash, user_id, expires_at) VALUES ($1, $2, now() + make_interval(hours => $3))`,
      [sha256(raw), user.id, VERIFY_TTL_HOURS],
    );
    await mailer.send({
      to: user.email,
      subject: 'Conferma il tuo indirizzo email per CardVault',
      text: `Ciao ${user.display_name},\n\nper attivare il tuo account CardVault apri questo link entro ${VERIFY_TTL_HOURS} ore:\n${appUrl}/conferma-email?token=${encodeURIComponent(raw)}\n\nSe non hai creato tu l'account, ignora questa email.\n\nCardVault`,
    });
  }

  app.post('/register', authLimit, async (req, reply) => {
    const started = Date.now();
    const body = parse(RegisterSchema, req.body);
    const passwordHash = await hashPassword(body.password);
    const { rows } = await db.query<UserRow>(
      `INSERT INTO users (email, password_hash, display_name, privacy_accepted_at, email_verified_at)
       VALUES ($1, $2, $3, now(), CASE WHEN $4 THEN NULL ELSE now() END) ON CONFLICT DO NOTHING RETURNING *`,
      [body.email, passwordHash, body.displayName, config.emailVerification],
    );

    if (!config.emailVerification) {
      // no mail configured (development): immediate session, as before
      if (!rows[0]) throw new HttpError(409, 'Esiste già un account con questa email', 'EMAIL_TAKEN');
      reply.status(201);
      return startSession(reply, req, toUser(rows[0]));
    }

    // Same answer whether the address is new or taken: the owner of a taken address is
    // told by e-mail instead, so the form cannot be used to discover who is registered.
    try {
      if (rows[0]) {
        await sendVerification(rows[0]);
      } else {
        const existing = await db.query<UserRow>('SELECT * FROM users WHERE lower(email) = lower($1)', [body.email]);
        const user = existing.rows[0];
        if (user && !user.email_verified_at) await sendVerification(user);
        else if (user) {
          await mailer.send({
            to: user.email,
            subject: 'Tentativo di registrazione su CardVault',
            text: `Ciao ${user.display_name},\n\nqualcuno (forse tu) ha provato a creare un account CardVault con questo indirizzo, che è già registrato.\n\nPer entrare: ${appUrl}/accedi\nSe hai dimenticato la password: ${appUrl}/password-dimenticata\n\nSe non sei stato tu, puoi ignorare questa email: il tuo account non è stato modificato.\n\nCardVault`,
          });
        }
      }
    } catch (err) {
      req.log.error({ err }, 'invio email di registrazione fallito');
    }
    await atLeast(started);
    reply.status(202);
    return { status: 'verification_sent' } satisfies RegisterPending;
  });

  app.post('/verify-email', authLimit, async (req, reply) => {
    const { token } = parse(VerifyEmailSchema, req.body);
    const user = await withTransaction(db, async (tx) => {
      const { rows } = await tx.query<{ user_id: string }>(
        'DELETE FROM email_verifications WHERE token_hash = $1 AND expires_at > now() RETURNING user_id',
        [sha256(token)],
      );
      const userId = rows[0]?.user_id;
      if (!userId) return null;
      await tx.query('DELETE FROM email_verifications WHERE user_id = $1', [userId]);
      const u = await tx.query<UserRow>(
        'UPDATE users SET email_verified_at = coalesce(email_verified_at, now()), updated_at = now() WHERE id = $1 RETURNING *',
        [userId],
      );
      return u.rows[0] ?? null;
    });
    if (!user) throw new HttpError(400, 'Link scaduto o già usato. Accedi per riceverne uno nuovo.', 'VERIFY_INVALID');
    return startSession(reply, req, toUser(user));
  });

  app.post('/resend-verification', { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } }, async (req, reply) => {
    const started = Date.now();
    const { email } = parse(ForgotPasswordSchema, req.body);
    if (config.emailVerification) {
      const { rows } = await db.query<UserRow>('SELECT * FROM users WHERE lower(email) = lower($1)', [email]);
      const user = rows[0];
      if (user && !user.email_verified_at) await sendVerification(user).catch((err) => req.log.error({ err }, 'invio verifica fallito'));
    }
    await atLeast(started);
    return reply.status(204).send();
  });

  app.post('/login', authLimit, async (req, reply) => {
    const body = parse(LoginSchema, req.body);
    const invalid = new HttpError(401, 'Email o password non corretti', 'BAD_CREDENTIALS');
    const locked = new HttpError(429, 'Troppi tentativi falliti. Riprova tra qualche minuto.', 'LOCKED');
    // Failures are counted per (account, IP): a stranger cannot lock the owner out by
    // guessing from elsewhere. Unknown e-mails get the same treatment, so the lock
    // message does not reveal which addresses are registered.
    const pairKey = `login-fail|${body.email.toLowerCase()}|${req.ip}`;
    const pair = await db.query<{ hits: number }>(
      `SELECT hits FROM rate_limits WHERE key = $1 AND window_start > now() - make_interval(mins => $2)`,
      [pairKey, LOCK_MINUTES],
    );
    if ((pair.rows[0]?.hits ?? 0) >= MAX_FAILED_LOGINS) throw locked;
    const countFailure = () =>
      db.query(
        `INSERT INTO rate_limits AS r (key, window_start, hits) VALUES ($1, now(), 1)
         ON CONFLICT (key) DO UPDATE SET
           hits = CASE WHEN r.window_start <= now() - make_interval(mins => $2) THEN 1 ELSE r.hits + 1 END,
           window_start = CASE WHEN r.window_start <= now() - make_interval(mins => $2) THEN now() ELSE r.window_start END`,
        [pairKey, LOCK_MINUTES],
      );

    const { rows } = await db.query<UserRow>('SELECT * FROM users WHERE lower(email) = lower($1)', [body.email]);
    const user = rows[0];
    if (!user) {
      await burnPasswordCheck(body.password);
      await countFailure();
      throw invalid;
    }
    // last line of defence against a distributed attack: lock the account itself
    if (user.locked_until && user.locked_until > new Date()) throw locked;
    if (!(await verifyPassword(user.password_hash, body.password))) {
      await countFailure();
      await db.query(
        `UPDATE users SET
           locked_until = CASE WHEN failed_logins + 1 >= $2 THEN now() + make_interval(mins => $3) ELSE locked_until END,
           failed_logins = CASE WHEN failed_logins + 1 >= $2 THEN 0 ELSE failed_logins + 1 END
         WHERE id = $1`,
        [user.id, MAX_FAILED_LOGINS_ACCOUNT, LOCK_MINUTES],
      );
      throw invalid;
    }
    await db.query('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = $1', [user.id]);
    await db.query('DELETE FROM rate_limits WHERE key = $1', [pairKey]);
    // right password but address never confirmed (only reachable by its owner)
    if (config.emailVerification && !user.email_verified_at) {
      throw new HttpError(403, "Conferma il tuo indirizzo: apri il link che ti abbiamo inviato per email.", 'EMAIL_NOT_VERIFIED');
    }
    return startSession(reply, req, toUser(user));
  });

  app.post('/refresh', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    checkOrigin(req);
    const raw = req.cookies[REFRESH_COOKIE];
    const fail = () => {
      reply.clearCookie(REFRESH_COOKIE, cookieOpts);
      return unauthorized('Sessione scaduta, accedi di nuovo');
    };
    // No cookie sent: answer 401 but do NOT expire the cookie. A cookie-less request (the
    // start-up check) can finish after a sign-in that just set one; clearing here would
    // delete the brand-new session in the browser.
    if (!raw) throw unauthorized('Sessione scaduta, accedi di nuovo');

    const result = await withTransaction(db, async (tx) => {
      const { rows } = await tx.query<{
        id: string;
        user_id: string;
        family_id: string;
        expires_at: Date;
        revoked_at: Date | null;
        rotated_at: Date | null;
        in_grace: boolean;
      }>(
        `SELECT id, user_id, family_id, expires_at, revoked_at, rotated_at,
                coalesce(rotated_at > now() - make_interval(secs => $2), false) AS in_grace
         FROM refresh_tokens WHERE token_hash = $1 FOR UPDATE`,
        [sha256(raw), REUSE_GRACE_SECONDS],
      );
      const token = rows[0];
      if (!token || token.revoked_at || token.expires_at < new Date()) return null;
      if (token.rotated_at && !token.in_grace) {
        // a superseded token came back: assume theft, end every session of this family
        await tx.query('UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL', [token.family_id]);
        req.log.warn({ userId: token.user_id }, 'refresh token riutilizzato: famiglia revocata');
        return null;
      }
      if (!token.rotated_at) await tx.query('UPDATE refresh_tokens SET rotated_at = now() WHERE id = $1', [token.id]);
      const u = await tx.query<UserRow>('SELECT * FROM users WHERE id = $1', [token.user_id]);
      return u.rows[0] ? { user: toUser(u.rows[0]), familyId: token.family_id } : null;
    });
    if (!result) throw fail();
    return startSession(reply, req, result.user, result.familyId);
  });

  app.post('/logout', async (req, reply) => {
    checkOrigin(req);
    const raw = req.cookies[REFRESH_COOKIE];
    if (raw) {
      await db.query(
        `UPDATE refresh_tokens SET revoked_at = now()
         WHERE family_id = (SELECT family_id FROM refresh_tokens WHERE token_hash = $1) AND revoked_at IS NULL`,
        [sha256(raw)],
      );
    }
    reply.clearCookie(REFRESH_COOKIE, cookieOpts);
    return reply.status(204).send();
  });

  /** Lives under /api/auth so the refresh cookie is sent: the current session survives, the others end. */
  app.post('/change-password', { ...authLimit, onRequest: app.authenticate }, async (req, reply) => {
    checkOrigin(req);
    const body = parse(ChangePasswordSchema, req.body);
    const { rows } = await db.query<UserRow>('SELECT * FROM users WHERE id = $1', [req.userId]);
    if (!rows[0]) throw unauthorized();
    if (!(await verifyPassword(rows[0].password_hash, body.currentPassword))) {
      throw new HttpError(403, 'La password attuale non è corretta', 'BAD_PASSWORD');
    }
    // access tokens of every other device stop working now; this one is refreshed by the client
    await db.query('UPDATE users SET password_hash = $2, tokens_valid_after = now(), updated_at = now() WHERE id = $1', [
      req.userId,
      await hashPassword(body.newPassword),
    ]);
    const raw = req.cookies[REFRESH_COOKIE];
    await db.query(
      `UPDATE refresh_tokens SET revoked_at = now()
       WHERE user_id = $1 AND revoked_at IS NULL
         AND family_id IS DISTINCT FROM (SELECT family_id FROM refresh_tokens WHERE token_hash = $2)`,
      [req.userId, raw ? sha256(raw) : null],
    );
    return reply.status(204).send();
  });

  app.post('/forgot-password', { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } }, async (req, reply) => {
    const started = Date.now();
    const { email } = parse(ForgotPasswordSchema, req.body);
    const { rows } = await db.query<UserRow>('SELECT * FROM users WHERE lower(email) = lower($1)', [email]);
    const user = rows[0];
    if (user) {
      const raw = newToken();
      await db.query('DELETE FROM password_resets WHERE user_id = $1', [user.id]);
      await db.query(
        `INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES ($1, $2, now() + make_interval(mins => $3))`,
        [sha256(raw), user.id, RESET_TTL_MINUTES],
      );
      const link = `${config.APP_URL.replace(/\/$/, '')}/reimposta-password?token=${encodeURIComponent(raw)}`;
      // awaited: serverless platforms may freeze work left running after the response
      await mailer
        .send({
          to: user.email,
          subject: 'Reimposta la password di CardVault',
          text: `Ciao ${user.display_name},\n\nper scegliere una nuova password apri questo link entro ${RESET_TTL_MINUTES} minuti:\n${link}\n\nSe non hai chiesto tu il reset, ignora questa email: la password attuale resta valida.\n\nCardVault`,
        })
        .catch((err) => req.log.error({ err }, 'invio email reset fallito'));
    }
    // same answer, and the same minimum time, whether or not the account exists
    await new Promise((r) => setTimeout(r, Math.max(0, FORGOT_MIN_MS - (Date.now() - started))));
    return reply.status(204).send();
  });

  app.post('/reset-password', authLimit, async (req, reply) => {
    const body = parse(ResetPasswordSchema, req.body);
    const passwordHash = await hashPassword(body.password);
    const ok = await withTransaction(db, async (tx) => {
      const { rows } = await tx.query<{ user_id: string }>(
        `UPDATE password_resets SET used_at = now()
         WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() RETURNING user_id`,
        [sha256(body.token)],
      );
      const userId = rows[0]?.user_id;
      if (!userId) return false;
      await tx.query('UPDATE users SET password_hash = $2, failed_logins = 0, locked_until = NULL, tokens_valid_after = now(), email_verified_at = coalesce(email_verified_at, now()), updated_at = now() WHERE id = $1', [
        userId,
        passwordHash,
      ]);
      await tx.query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
      // a proven owner is no longer locked out from any IP
      await tx.query(
        `DELETE FROM rate_limits WHERE starts_with(key, 'login-fail|' || (SELECT lower(email) FROM users WHERE id = $1) || '|')`,
        [userId],
      );
      return true;
    });
    if (!ok) throw new HttpError(400, 'Link scaduto o già usato. Richiedi un nuovo reset.', 'RESET_INVALID');
    return reply.status(204).send();
  });
}
