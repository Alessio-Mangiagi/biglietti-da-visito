import { timingSafeEqual } from 'node:crypto';
import { displayName } from '@cardvault/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse } from '../app';
import { badRequest, HttpError, unauthorized } from '../lib/errors';
import { isPushEndpoint, type PushMessage, type PushSubscriptionKeys } from '../lib/push';

const b64url = z.string().regex(/^[A-Za-z0-9_-]+={0,2}$/).max(200);
const SubscribeBody = z.object({
  endpoint: z.string().max(1000).refine(isPushEndpoint, 'Servizio di notifiche non supportato'),
  keys: z.object({ p256dh: b64url, auth: b64url }),
});
const EndpointBody = z.object({ endpoint: z.string().max(1000) });

const MAX_DEVICES = 10;

export async function pushRoutes(app: FastifyInstance) {
  const { db, push } = app.deps;

  app.get('/push/key', async () => ({ enabled: push.enabled, publicKey: push.publicKey }));

  app.post('/push/subscribe', async (req, reply) => {
    if (!push.enabled) throw new HttpError(503, 'Notifiche non attive su questo server', 'PUSH_DISABLED');
    const { endpoint, keys } = parse(SubscribeBody, req.body);
    const { rows } = await db.query<{ n: string }>('SELECT count(*) AS n FROM push_subscriptions WHERE user_id = $1 AND endpoint <> $2', [
      req.userId,
      endpoint,
    ]);
    if (Number(rows[0]!.n) >= MAX_DEVICES) throw badRequest('Troppi dispositivi con le notifiche attive', 'TOO_MANY_DEVICES');
    // an endpoint belongs to one browser: re-subscribing moves it to whoever is logged in now
    await db.query(
      `INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth, user_agent) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth,
         user_agent = EXCLUDED.user_agent, last_sent_on = NULL`,
      [endpoint, req.userId, keys.p256dh, keys.auth, req.headers['user-agent']?.slice(0, 300) ?? null],
    );
    return reply.status(204).send();
  });

  app.post('/push/unsubscribe', async (req, reply) => {
    const { endpoint } = parse(EndpointBody, req.body);
    await db.query('DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2', [endpoint, req.userId]);
    return reply.status(204).send();
  });

  app.post('/push/test', { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } }, async (req) => {
    if (!push.enabled) throw new HttpError(503, 'Notifiche non attive su questo server', 'PUSH_DISABLED');
    const { rows } = await db.query<PushSubscriptionKeys>('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1', [
      req.userId,
    ]);
    let sent = 0;
    for (const sub of rows) {
      const r = await push.send(sub, { title: 'CardVault', body: 'Le notifiche funzionano: ti avviseremo dei contatti da ricontattare.', url: '/promemoria', tag: 'test' });
      if (r === 'ok') sent++;
      if (r === 'gone') await db.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [sub.endpoint]);
    }
    return { sent };
  });
}

/** Scheduler entry points, authenticated with CRON_SECRET (Vercel Cron sends it as a bearer token). */
export async function cronRoutes(app: FastifyInstance) {
  const { db, push, config } = app.deps;

  app.get('/cron/reminders', { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (req) => {
    const secret = config.CRON_SECRET;
    if (!secret) throw new HttpError(503, 'Cron non configurato', 'CRON_DISABLED');
    const got = Buffer.from(req.headers.authorization ?? '');
    const want = Buffer.from(`Bearer ${secret}`);
    if (got.length !== want.length || !timingSafeEqual(got, want)) throw unauthorized();
    if (!push.enabled) return { users: 0, sent: 0, disabled: true };
    return sendDailyReminders(app);
  });

  /** One notification per device per day, for users with reminders due (Italian calendar day). */
  async function sendDailyReminders(app: FastifyInstance) {
    const { rows } = await db.query<
      PushSubscriptionKeys & { user_id: string; due: string; first_name: string; last_name: string; company: string }
    >(
      `WITH today AS (SELECT (now() AT TIME ZONE 'Europe/Rome')::date AS d),
       due AS (
         SELECT c.user_id, count(*) AS due,
                (array_agg(c.first_name ORDER BY c.follow_up_on, c.id))[1] AS first_name,
                (array_agg(c.last_name ORDER BY c.follow_up_on, c.id))[1] AS last_name,
                (array_agg(c.company ORDER BY c.follow_up_on, c.id))[1] AS company
         FROM contacts c, today WHERE c.follow_up_on <= today.d AND NOT c.is_self GROUP BY c.user_id)
       SELECT s.endpoint, s.p256dh, s.auth, s.user_id, due.due, due.first_name, due.last_name, due.company
       FROM push_subscriptions s JOIN due ON due.user_id = s.user_id, today
       WHERE s.last_sent_on IS NULL OR s.last_sent_on < today.d`,
    );
    let sent = 0;
    const users = new Set<string>();
    for (const r of rows) {
      const n = Number(r.due);
      const who = displayName({ firstName: r.first_name, lastName: r.last_name, company: r.company });
      const msg: PushMessage = {
        title: n === 1 ? 'Da ricontattare oggi' : `${n} contatti da ricontattare`,
        body: n === 1 ? who : `${who} e altri ${n - 1}`,
        url: '/promemoria',
        tag: 'follow-ups',
      };
      const res = await push.send(r, msg);
      if (res === 'gone') {
        await db.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [r.endpoint]);
      } else if (res === 'ok') {
        sent++;
        users.add(r.user_id);
        await db.query(`UPDATE push_subscriptions SET last_sent_on = (now() AT TIME ZONE 'Europe/Rome')::date WHERE endpoint = $1`, [
          r.endpoint,
        ]);
      }
    }
    app.log.info({ users: users.size, sent }, 'promemoria inviati');
    return { users: users.size, sent };
  }
}
