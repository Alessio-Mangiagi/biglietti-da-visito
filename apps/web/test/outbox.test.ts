import 'fake-indexeddb/auto';
import { ContactInputSchema } from '@cardvault/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../src/lib/api';
import { enqueue, flushOutbox, listOutbox } from '../src/lib/outbox';

const contact = ContactInputSchema.parse({ firstName: 'Offline', lastName: 'Test' });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('outbox', () => {
  beforeEach(() => {
    api.setSession({ accessToken: 't', expiresIn: 900, user: { id: 'u', email: 'a@b.it', displayName: 'A', createdAt: '' } });
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('sends queued contacts with their clientRef, then photos, then forgets them', async () => {
    const calls: Array<[string, RequestInit | undefined]> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: URL | string, init?: RequestInit) => {
      calls.push([String(url), init]);
      if (String(url).endsWith('/api/contacts')) return json({ contact: { id: 'srv-1' }, duplicates: [] }, 201);
      return new Response(null, { status: 204 });
    }));
    await enqueue({ clientRef: 'ref-1', contact, front: new Blob(['x'], { type: 'image/jpeg' }) });
    expect(await flushOutbox()).toBe(1);
    expect(JSON.parse(String(calls[0]![1]!.body)).clientRef).toBe('ref-1');
    expect(calls[1]![0]).toContain('/api/contacts/srv-1/images/front');
    expect(await listOutbox()).toHaveLength(0);
  });

  it('keeps items when the network drops and resumes photo upload without re-creating', async () => {
    let fail = true;
    vi.stubGlobal('fetch', vi.fn(async (url: URL | string) => {
      if (String(url).endsWith('/api/contacts')) return json({ contact: { id: 'srv-2' }, duplicates: [] }, 201);
      if (fail) throw new TypeError('Failed to fetch');
      return new Response(null, { status: 204 });
    }));
    await enqueue({ clientRef: 'ref-2', contact, front: new Blob(['x'], { type: 'image/jpeg' }) });
    expect(await flushOutbox()).toBe(0);
    const [item] = await listOutbox();
    expect(item?.serverId).toBe('srv-2');

    fail = false;
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await flushOutbox()).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1); // only the photo
  });

  it('records server errors and moves on', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ message: 'Email non valida' }, 400)));
    await enqueue({ clientRef: 'ref-3', contact });
    await flushOutbox();
    const [item] = await listOutbox();
    expect(item).toMatchObject({ attempts: 1, lastError: 'Email non valida' });
  });
});
