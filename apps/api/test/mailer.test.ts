import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMailer } from '../src/lib/mailer';

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never;
const base = { MAIL_FROM: 'x', AGENTMAIL_USERNAME: 'cardvault-notifiche' };

describe('AgentMail mailer', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('creates its inbox once (idempotent client_id) and sends through it', async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      expect((init.headers as Record<string, string>).authorization).toBe('Bearer k');
      if (url.endsWith('/inboxes')) return Response.json({ inbox_id: 'inb_1', email: 'cardvault-notifiche@agentmail.to' });
      return Response.json({ message_id: 'm', thread_id: 't' });
    }));
    const m = createMailer({ ...base, AGENTMAIL_API_KEY: 'k' }, log);
    await m.send({ to: 'a@b.it', subject: 'S', text: 'T' });
    await m.send({ to: 'c@d.it', subject: 'S2', text: 'T2' });
    expect(calls.map((c) => c.url)).toEqual([
      'https://api.agentmail.to/v0/inboxes',
      'https://api.agentmail.to/v0/inboxes/inb_1/messages/send',
      'https://api.agentmail.to/v0/inboxes/inb_1/messages/send',
    ]);
    expect(calls[0]!.body).toMatchObject({ username: 'cardvault-notifiche', client_id: 'cardvault-notifiche' });
    expect(calls[1]!.body).toEqual({ to: 'a@b.it', subject: 'S', text: 'T' });
  });

  it('falls back to a random address when the name is taken', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      bodies.push(body);
      if (url.endsWith('/inboxes') && body.username) return new Response('taken', { status: 409 });
      if (url.endsWith('/inboxes')) return Response.json({ inbox_id: 'inb_2', email: 'xyz@agentmail.to' });
      return Response.json({});
    }));
    await createMailer({ ...base, AGENTMAIL_API_KEY: 'k' }, log).send({ to: 'a@b.it', subject: 'S', text: 'T' });
    expect(bodies[1]).not.toHaveProperty('username');
  });

  it('surfaces send failures', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('no', { status: 500 })));
    await expect(createMailer({ ...base, AGENTMAIL_API_KEY: 'k', AGENTMAIL_INBOX_ID: 'inb' }, log).send({ to: 'a@b.it', subject: 'S', text: 'T' })).rejects.toThrow(/500/);
  });
});
