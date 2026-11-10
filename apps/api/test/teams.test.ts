import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PushMessage, PushSender, PushSubscriptionKeys } from '../src/lib/push';
import { auth, registerUser, setupApp, type TestCtx } from './helpers';

let ctx: TestCtx;
const sent: Array<{ sub: PushSubscriptionKeys; msg: PushMessage }> = [];
const fakePush: PushSender = {
  enabled: true,
  publicKey: 'BTestKey',
  send: async (sub, msg) => {
    sent.push({ sub, msg });
    return sub.endpoint.endsWith('/gone') ? 'gone' : 'ok';
  },
};
const CRON_SECRET = 'cron-secret-di-prova-1234567890';

beforeAll(async () => {
  ctx = await setupApp({ env: { CRON_SECRET }, push: fakePush });
});
afterAll(() => ctx.close());

const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
  'base64',
);

async function req(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, token: string, payload?: unknown) {
  return ctx.app.inject({ method, url, headers: auth(token), payload: payload as never });
}

async function contact(token: string, data: Record<string, unknown>) {
  const res = await req('POST', '/api/contacts', token, data);
  expect(res.statusCode).toBe(201);
  return (res.json() as { contact: { id: string } }).contact.id;
}

describe('teams', () => {
  let anna: Awaited<ReturnType<typeof registerUser>>;
  let bruno: Awaited<ReturnType<typeof registerUser>>;
  let carla: Awaited<ReturnType<typeof registerUser>>;
  let teamId: string;
  let token: string;
  let cardId: string;

  beforeAll(async () => {
    [anna, bruno, carla] = [await registerUser(ctx.app), await registerUser(ctx.app), await registerUser(ctx.app)];
    cardId = await contact(anna.token, {
      firstName: 'Marta',
      lastName: 'Colombo',
      company: 'Cosedil S.p.A.',
      emails: ['m.colombo@cosedil.it'],
      notes: 'segreto-cantiere',
      tags: ['personale'],
      metAt: 'SAIE',
    });
    await ctx.app.inject({
      method: 'PUT',
      url: `/api/contacts/${cardId}/images/front`,
      headers: { ...auth(anna.token), 'content-type': 'image/jpeg' },
      payload: JPEG,
    });
  });

  it('creates a team with the creator as admin', async () => {
    const res = await req('POST', '/api/teams', anna.token, { name: 'Cosedil' });
    expect(res.statusCode).toBe(201);
    const team = res.json();
    expect(team).toMatchObject({ name: 'Cosedil', role: 'admin', memberCount: 1, contactCount: 0 });
    teamId = team.id;
  });

  it('only admins hand out invites; the link carries the token in the fragment', async () => {
    const res = await req('POST', `/api/teams/${teamId}/invites`, anna.token);
    expect(res.statusCode).toBe(201);
    const { url } = res.json() as { url: string };
    expect(url).toMatch(/^http:\/\/localhost:5173\/team\/invito#[A-Za-z0-9_-]{32}$/);
    token = url.split('#')[1]!;
    // outsiders do not even learn the team exists
    expect((await req('POST', `/api/teams/${teamId}/invites`, bruno.token)).statusCode).toBe(404);
  });

  it('previews and joins with an invite', async () => {
    const preview = await req('POST', '/api/teams/join/preview', bruno.token, { token });
    expect(preview.json()).toMatchObject({ teamName: 'Cosedil', memberCount: 1, alreadyMember: false });
    const join = await req('POST', '/api/teams/join', bruno.token, { token });
    expect(join.statusCode).toBe(200);
    expect(join.json()).toMatchObject({ role: 'member', memberCount: 2 });
    // joining twice is harmless
    expect((await req('POST', '/api/teams/join', bruno.token, { token })).json().memberCount).toBe(2);
    expect((await req('POST', '/api/teams/join', carla.token, { token: 'x'.repeat(32) })).statusCode).toBe(404);
  });

  it('a member cannot invite, rename or remove others', async () => {
    expect((await req('POST', `/api/teams/${teamId}/invites`, bruno.token)).statusCode).toBe(403);
    expect((await req('PATCH', `/api/teams/${teamId}`, bruno.token, { name: 'Altro' })).statusCode).toBe(403);
    expect((await req('DELETE', `/api/teams/${teamId}/members/${anna.userId}`, bruno.token)).statusCode).toBe(403);
  });

  it('shares only the card fields with colleagues', async () => {
    // you cannot share somebody else's card
    expect((await req('POST', `/api/teams/${teamId}/contacts`, bruno.token, { contactId: cardId })).statusCode).toBe(404);
    const share = await req('POST', `/api/teams/${teamId}/contacts`, anna.token, { contactId: cardId });
    expect(share.statusCode).toBe(201);
    const list = await req('GET', `/api/teams/${teamId}/contacts`, bruno.token);
    const page = list.json() as { items: Array<Record<string, unknown>>; total: number };
    expect(page.total).toBe(1);
    const card = page.items[0]!;
    expect(card).toMatchObject({ firstName: 'Marta', company: 'Cosedil S.p.A.', mine: false, hasFront: true });
    expect((card.sharedBy as { id: string }).id).toBe(anna.userId);
    for (const k of ['notes', 'tags', 'metAt', 'ocrText', 'followUpOn', 'favorite']) expect(card).not.toHaveProperty(k);
    expect(JSON.stringify(card)).not.toContain('segreto');
    expect((await req('GET', `/api/contacts/${cardId}/teams`, anna.token)).json()).toEqual([teamId]);
  });

  it('search on shared cards never matches the owner notes', async () => {
    const hit = (await req('GET', `/api/teams/${teamId}/contacts?q=colombo`, bruno.token)).json();
    expect(hit.total).toBe(1);
    const leak = (await req('GET', `/api/teams/${teamId}/contacts?q=segreto`, bruno.token)).json();
    expect(leak.total).toBe(0);
  });

  it('members see the photo, outsiders do not', async () => {
    const ok = await req('GET', `/api/teams/${teamId}/contacts/${cardId}/images/front`, bruno.token);
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['content-type']).toBe('image/jpeg');
    expect((await req('GET', `/api/teams/${teamId}/contacts/${cardId}/images/front`, carla.token)).statusCode).toBe(404);
    expect((await req('GET', `/api/teams/${teamId}/contacts`, carla.token)).statusCode).toBe(404);
    // and the owner-only routes stay owner-only
    expect((await req('GET', `/api/contacts/${cardId}`, bruno.token)).statusCode).toBe(404);
  });

  it('copies a colleague card into your own wallet, photos included', async () => {
    const res = await req('POST', `/api/teams/${teamId}/contacts/${cardId}/copy`, bruno.token);
    expect(res.statusCode).toBe(201);
    const { contact: copy } = res.json() as { contact: { id: string; notes: string; tags: string[]; hasFront: boolean; firstName: string } };
    expect(copy).toMatchObject({ firstName: 'Marta', notes: '', tags: [], hasFront: true });
    expect((await req('GET', `/api/contacts/${copy.id}`, bruno.token)).statusCode).toBe(200);
  });

  it('the owner can stop sharing; a member cannot remove someone else card', async () => {
    expect((await req('DELETE', `/api/teams/${teamId}/contacts/${cardId}`, bruno.token)).statusCode).toBe(404);
    expect((await req('DELETE', `/api/teams/${teamId}/contacts/${cardId}`, anna.token)).statusCode).toBe(204);
    expect((await req('GET', `/api/teams/${teamId}/contacts`, bruno.token)).json().total).toBe(0);
  });

  it('removing a member takes their shared cards out of the team', async () => {
    const brunoCard = await contact(bruno.token, { firstName: 'Fabio', lastName: 'Restivo' });
    await req('POST', `/api/teams/${teamId}/contacts`, bruno.token, { contactId: brunoCard });
    expect((await req('GET', `/api/teams/${teamId}/contacts`, anna.token)).json().total).toBe(1);
    expect((await req('DELETE', `/api/teams/${teamId}/members/${bruno.userId}`, anna.token)).statusCode).toBe(204);
    expect((await req('GET', `/api/teams/${teamId}/contacts`, anna.token)).json().total).toBe(0);
    // Bruno keeps his own card
    expect((await req('GET', `/api/contacts/${brunoCard}`, bruno.token)).statusCode).toBe(200);
  });

  it('revoked invites stop working', async () => {
    expect((await req('DELETE', `/api/teams/${teamId}/invites`, anna.token)).statusCode).toBe(204);
    expect((await req('POST', '/api/teams/join', carla.token, { token })).statusCode).toBe(404);
  });

  it('when the last admin leaves, the oldest member takes over; an empty team is deleted', async () => {
    const { url } = (await req('POST', `/api/teams/${teamId}/invites`, anna.token)).json() as { url: string };
    await req('POST', '/api/teams/join', carla.token, { token: url.split('#')[1] });
    expect((await req('DELETE', `/api/teams/${teamId}/members/${anna.userId}`, anna.token)).statusCode).toBe(204);
    expect((await req('GET', `/api/teams/${teamId}`, carla.token)).json()).toMatchObject({ role: 'admin', memberCount: 1 });
    expect((await req('DELETE', `/api/teams/${teamId}/members/${carla.userId}`, carla.token)).statusCode).toBe(204);
    const { rows } = await ctx.db.query('SELECT 1 FROM teams WHERE id = $1', [teamId]);
    expect(rows).toHaveLength(0);
  });
});

describe('follow-ups and push reminders', () => {
  let user: Awaited<ReturnType<typeof registerUser>>;
  let id: string;

  beforeAll(async () => {
    user = await registerUser(ctx.app);
    id = await contact(user.token, { firstName: 'Paolo', lastName: 'De Santis' });
  });

  it('sets a reminder without touching the card edit date', async () => {
    const before = (await req('GET', `/api/contacts/${id}`, user.token)).json();
    const res = await req('PUT', `/api/contacts/${id}/follow-up`, user.token, { on: '2026-01-05', note: 'Preventivo' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ followUpOn: '2026-01-05', followUpNote: 'Preventivo', updatedAt: before.updatedAt });
    const list = (await req('GET', '/api/contacts/follow-ups', user.token)).json() as Array<{ id: string }>;
    expect(list.map((c) => c.id)).toEqual([id]);
    const stats = (await req('GET', '/api/contacts/stats?today=2026-01-05', user.token)).json();
    expect(stats).toMatchObject({ total: 1, followUpsDue: 1, followUpsPlanned: 1 });
    expect((await req('GET', '/api/contacts/stats?today=2026-01-04', user.token)).json().followUpsDue).toBe(0);
  });

  it('only well-known push services can be subscribed (no requests to arbitrary hosts)', async () => {
    for (const endpoint of ['http://fcm.googleapis.com/x', 'https://169.254.169.254/latest', 'https://evil.example/push', 'https://fcm.googleapis.com:8443/x']) {
      const res = await req('POST', '/api/push/subscribe', user.token, { endpoint, keys: { p256dh: 'abc', auth: 'def' } });
      expect(res.statusCode, endpoint).toBe(400);
    }
    const ok = await req('POST', '/api/push/subscribe', user.token, {
      endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
      keys: { p256dh: 'BKey', auth: 'Auth' },
    });
    expect(ok.statusCode).toBe(204);
    expect((await req('GET', '/api/push/key', user.token)).json()).toEqual({ enabled: true, publicKey: 'BTestKey' });
  });

  it('the daily cron needs the secret and sends once per device per day', async () => {
    expect((await ctx.app.inject({ method: 'GET', url: '/api/cron/reminders' })).statusCode).toBe(401);
    expect((await ctx.app.inject({ method: 'GET', url: '/api/cron/reminders', headers: { authorization: 'Bearer wrong' } })).statusCode).toBe(401);
    const cron = () => ctx.app.inject({ method: 'GET', url: '/api/cron/reminders', headers: { authorization: `Bearer ${CRON_SECRET}` } });
    sent.length = 0;
    const first = await cron();
    expect(first.statusCode).toBe(200);
    const mine = sent.filter((s) => s.sub.endpoint === 'https://fcm.googleapis.com/fcm/send/abc');
    expect(mine).toHaveLength(1);
    expect(mine[0]!.msg).toMatchObject({ title: 'Da ricontattare oggi', body: 'Paolo De Santis', url: '/promemoria' });
    sent.length = 0;
    await cron();
    expect(sent.filter((s) => s.sub.endpoint === 'https://fcm.googleapis.com/fcm/send/abc')).toHaveLength(0);
  });

  it('clears the reminder', async () => {
    const res = await req('PUT', `/api/contacts/${id}/follow-up`, user.token, { on: null });
    expect(res.json()).toMatchObject({ followUpOn: null, followUpNote: '' });
    expect((await req('GET', '/api/contacts/follow-ups', user.token)).json()).toEqual([]);
  });
});

describe('card file letters', () => {
  it('orders by surname (else first name, else company) and tells where each letter starts', async () => {
    const u = await registerUser(ctx.app);
    for (const c of [
      { firstName: 'Zeno', lastName: 'Àlberti' },
      { firstName: 'Giulia' }, // no surname: filed under G
      { company: 'Bianchi Impianti' },
      { firstName: 'Carlo', lastName: 'Bruni', favorite: true },
      { company: '3M Italia' },
    ]) await contact(u.token, c);
    const letters = (await req('GET', '/api/contacts/letters', u.token)).json();
    expect(letters).toEqual([
      { letter: '#', offset: 0, count: 1 },
      { letter: 'A', offset: 1, count: 1 },
      { letter: 'B', offset: 2, count: 2 },
      { letter: 'G', offset: 4, count: 1 },
    ]);
    const names = (await req('GET', '/api/contacts?sort=name&dir=asc', u.token)).json().items.map(
      (c: { lastName: string; firstName: string; company: string }) => c.lastName || c.firstName || c.company,
    );
    expect(names).toEqual(['3M Italia', 'Àlberti', 'Bianchi Impianti', 'Bruni', 'Giulia']);
    // same filters as the wallet
    expect((await req('GET', '/api/contacts/letters?favorite=true', u.token)).json()).toEqual([{ letter: 'B', offset: 0, count: 1 }]);
  });
});
