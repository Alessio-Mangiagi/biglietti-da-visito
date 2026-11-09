import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, registerUser, setupApp, type TestCtx } from './helpers';

let ctx: TestCtx;
let token: string;
beforeAll(async () => {
  ctx = await setupApp();
  token = (await registerUser(ctx.app)).token;
});
afterAll(() => ctx.close());

const create = async (payload: Record<string, unknown>, t = token) => {
  const res = await ctx.app.inject({ method: 'POST', url: '/api/contacts', headers: auth(t), payload });
  if (res.statusCode >= 300) throw new Error(res.body);
  return res.json() as { contact: { id: string } & Record<string, unknown>; duplicates: Array<{ id: string; matchedOn: string[] }> };
};
const search = async (qs: string, t = token) => {
  const res = await ctx.app.inject({ method: 'GET', url: `/api/contacts?${qs}`, headers: auth(t) });
  expect(res.statusCode).toBe(200);
  return res.json() as { items: Array<{ id: string; lastName: string; company: string }>; total: number };
};

// 1x1 JPEG
const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
  'base64',
);

describe('contacts', () => {
  let marta: string;
  let fabio: string;

  beforeAll(async () => {
    marta = (
      await create({
        prefix: 'Ing.',
        firstName: 'Marta',
        lastName: 'Colombo',
        company: 'Cosedil S.p.A.',
        jobTitle: 'Direttore Tecnico',
        emails: ['m.colombo@cosedilspa.com'],
        phones: [{ type: 'work', value: '095 712 4483' }],
        address: { city: 'Catania', province: 'CT' },
        tags: ['Cantiere', 'fornitori'],
        metAt: 'SAIE Bologna',
        metOn: '2026-10-15',
      })
    ).contact.id;
    fabio = (
      await create({
        firstName: 'Fabio',
        lastName: 'Nicolò',
        company: 'Edil Restivo S.r.l.',
        jobTitle: 'Geometra',
        address: { city: 'Licata' },
        tags: ['cantiere'],
        metOn: '2026-01-20',
        favorite: true,
      })
    ).contact.id;
    await create({ company: 'Calcestruzzi Etnei SpA', address: { city: 'Catania' } });
  });

  it('creates and reads a contact with defaults', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: `/api/contacts/${marta}`, headers: auth(token) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      firstName: 'Marta',
      address: { city: 'Catania', street: '' },
      hasFront: false,
      favorite: false,
    });
  });

  it('returns 404 for invalid or foreign ids', async () => {
    expect((await ctx.app.inject({ method: 'GET', url: '/api/contacts/not-a-uuid', headers: auth(token) })).statusCode).toBe(400);
    const other = await registerUser(ctx.app);
    expect((await ctx.app.inject({ method: 'GET', url: `/api/contacts/${marta}`, headers: auth(other.token) })).statusCode).toBe(404);
    expect((await ctx.app.inject({ method: 'DELETE', url: `/api/contacts/${marta}`, headers: auth(other.token) })).statusCode).toBe(404);
    expect((await search('q=Colombo', other.token)).total).toBe(0);
  });

  it('searches ignoring accents and case', async () => {
    expect((await search('q=nicolo')).items.map((c) => c.lastName)).toEqual(['Nicolò']);
    expect((await search('q=COSEDIL')).total).toBe(1);
  });

  it('tolerates typos (trigram similarity)', async () => {
    expect((await search('q=Colmbo')).items[0]?.id).toBe(marta);
    expect((await search('q=Calcestruzi')).total).toBe(1);
  });

  it('requires every word of the query', async () => {
    expect((await search('q=marta catania')).total).toBe(1);
    expect((await search('q=marta licata')).total).toBe(0);
  });

  it('filters by single fields', async () => {
    expect((await search('city=catania')).total).toBe(2);
    expect((await search('company=restivo')).items[0]?.id).toBe(fabio);
    expect((await search('jobTitle=direttore')).items[0]?.id).toBe(marta);
    expect((await search('name=fabio')).items[0]?.id).toBe(fabio);
    expect((await search('tag=CANTIERE')).total).toBe(2);
    expect((await search('metAt=saie')).total).toBe(1);
    expect((await search('metFrom=2026-06-01&metTo=2026-12-31')).items.map((c) => c.id)).toEqual([marta]);
    expect((await search('favorite=true')).items.map((c) => c.id)).toEqual([fabio]);
  });

  it('sorts and paginates', async () => {
    const byName = await search('sort=name&dir=asc');
    expect(byName.items.map((c) => c.lastName)).toEqual(['Colombo', 'Nicolò', '']);
    const byCompany = await search('sort=company&dir=desc');
    expect(byCompany.items[0]?.company).toBe('Edil Restivo S.r.l.');
    const p2 = await search('pageSize=2&page=2&sort=name');
    expect(p2.total).toBe(3);
    expect(p2.items).toHaveLength(1);
    expect((await search('pageSize=2&page=9')).total).toBe(3);
  });

  it('lists tags and events', async () => {
    const tags = (await ctx.app.inject({ method: 'GET', url: '/api/contacts/tags', headers: auth(token) })).json();
    expect(tags[0]).toEqual({ tag: expect.stringMatching(/cantiere/i), count: 2 });
    const events = (await ctx.app.inject({ method: 'GET', url: '/api/contacts/events', headers: auth(token) })).json();
    expect(events).toEqual(['SAIE Bologna']);
  });

  it('patches only the fields sent', async () => {
    const res = await ctx.app.inject({ method: 'PATCH', url: `/api/contacts/${marta}`, headers: auth(token), payload: { favorite: true } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ favorite: true, firstName: 'Marta', tags: ['Cantiere', 'fornitori'] });
  });

  it('detects duplicates by e-mail or normalised phone and merges them', async () => {
    const dup = await create({ firstName: 'M.', lastName: 'Colombo', phones: [{ type: 'mobile', value: '+39 095 7124483' }], notes: 'vista in fiera' });
    expect(dup.duplicates).toEqual([expect.objectContaining({ id: marta, matchedOn: ['phone'] })]);

    await ctx.app.inject({ method: 'PUT', url: `/api/contacts/${dup.contact.id}/images/front`, headers: { ...auth(token), 'content-type': 'image/jpeg' }, payload: JPEG });
    const merged = await ctx.app.inject({ method: 'POST', url: `/api/contacts/${marta}/merge`, headers: auth(token), payload: { sourceId: dup.contact.id } });
    expect(merged.statusCode).toBe(200);
    expect(merged.json()).toMatchObject({ firstName: 'Marta', notes: 'vista in fiera', hasFront: true });
    expect(merged.json().phones).toHaveLength(1);
    expect((await ctx.app.inject({ method: 'GET', url: `/api/contacts/${dup.contact.id}`, headers: auth(token) })).statusCode).toBe(404);
    const img = await ctx.app.inject({ method: 'GET', url: `/api/contacts/${marta}/images/front`, headers: auth(token) });
    expect(img.statusCode).toBe(200);
    expect(img.rawPayload.equals(JPEG)).toBe(true);
  });

  it('is idempotent with clientRef (offline queue replays)', async () => {
    const clientRef = crypto.randomUUID();
    const a = await ctx.app.inject({ method: 'POST', url: '/api/contacts', headers: auth(token), payload: { firstName: 'Replay', clientRef } });
    const b = await ctx.app.inject({ method: 'POST', url: '/api/contacts', headers: auth(token), payload: { firstName: 'Replay', clientRef } });
    expect(a.statusCode).toBe(201);
    expect(b.statusCode).toBe(200);
    expect(b.json().contact.id).toBe(a.json().contact.id);
    await ctx.app.inject({ method: 'DELETE', url: `/api/contacts/${a.json().contact.id}`, headers: auth(token) });
  });
});

describe('images', () => {
  it('stores photos encrypted at rest and validates the payload', async () => {
    const { contact } = await create({ firstName: 'Foto' });
    const url = `/api/contacts/${contact.id}/images/back`;
    const bad = await ctx.app.inject({ method: 'PUT', url, headers: { ...auth(token), 'content-type': 'image/png' }, payload: JPEG });
    expect(bad.statusCode).toBe(415);
    const ok = await ctx.app.inject({ method: 'PUT', url, headers: { ...auth(token), 'content-type': 'image/jpeg' }, payload: JPEG });
    expect(ok.statusCode).toBe(204);
    const { rows } = await ctx.db.query('SELECT data FROM contact_images WHERE contact_id = $1', [contact.id]);
    expect(Buffer.compare(rows[0].data, JPEG)).not.toBe(0);
    expect(rows[0].data.includes(JPEG.subarray(0, 8))).toBe(false);
    const get = await ctx.app.inject({ method: 'GET', url, headers: auth(token) });
    expect(get.headers['content-type']).toBe('image/jpeg');
    expect(get.rawPayload.equals(JPEG)).toBe(true);
    expect((await ctx.app.inject({ method: 'DELETE', url, headers: auth(token) })).statusCode).toBe(204);
  });

  it('rejects oversize uploads', async () => {
    const { contact } = await create({ firstName: 'Grande' });
    const big = Buffer.concat([JPEG, Buffer.alloc(3 * 1024 * 1024)]);
    const res = await ctx.app.inject({ method: 'PUT', url: `/api/contacts/${contact.id}/images/front`, headers: { ...auth(token), 'content-type': 'image/jpeg' }, payload: big });
    expect(res.statusCode).toBe(413);
  });
});

describe('transfer', () => {
  it('exports vCard and CSV and re-imports skipping duplicates', async () => {
    const u = await registerUser(ctx.app);
    await create({ firstName: 'Anna', lastName: 'Rossi', emails: ['anna@rossi.it'], tags: ['fiera'] }, u.token);
    const vcf = await ctx.app.inject({ method: 'GET', url: '/api/contacts/export.vcf', headers: auth(u.token) });
    expect(vcf.headers['content-type']).toContain('text/vcard');
    expect(vcf.body).toContain('FN:Anna Rossi');
    const csv = await ctx.app.inject({ method: 'GET', url: '/api/contacts/export.csv?tag=fiera', headers: auth(u.token) });
    expect(csv.body).toContain('Anna;Rossi');

    const extra = 'BEGIN:VCARD\r\nVERSION:3.0\r\nN:Bianchi;Luca\r\nEMAIL:luca@bianchi.it\r\nEND:VCARD\r\n';
    const imp = await ctx.app.inject({ method: 'POST', url: '/api/contacts/import', headers: { ...auth(u.token), 'content-type': 'text/vcard' }, payload: vcf.body + extra });
    expect(imp.json()).toEqual({ created: 1, skipped: 1, errors: [] });
  });

  it('opens a vCard through a short-lived signed link (iPhone)', async () => {
    const { contact } = await create({ firstName: 'Link', lastName: 'Firmato' });
    const link = await ctx.app.inject({ method: 'POST', url: `/api/contacts/${contact.id}/vcard-link`, headers: auth(token) });
    const { url } = link.json();
    const res = await ctx.app.inject({ method: 'GET', url });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/^inline/);
    expect(res.body).toContain('FN:Link Firmato');
    const other = await registerUser(ctx.app);
    const forged = await ctx.app.inject({ method: 'POST', url: `/api/contacts/${contact.id}/vcard-link`, headers: auth(other.token) });
    expect(forged.statusCode).toBe(404);
    expect((await ctx.app.inject({ method: 'GET', url: '/api/public/vcard/abc' })).statusCode).toBe(404);
    // an access token is not accepted as a download token
    expect((await ctx.app.inject({ method: 'GET', url: `/api/public/vcard/${token}` })).statusCode).toBe(404);
  });

  it('serves a single vCard 3.0 for the phone address book', async () => {
    const { contact } = await create({ firstName: 'Nicolò', lastName: 'Bò' });
    const res = await ctx.app.inject({ method: 'GET', url: `/api/contacts/${contact.id}/vcard`, headers: auth(token) });
    expect(res.body).toContain('VERSION:3.0');
    expect(res.headers['content-disposition']).toContain("filename*=UTF-8''Nicol%C3%B2%20B%C3%B2.vcf");
  });
});

describe('account', () => {
  it('saves my card apart from the wallet', async () => {
    const u = await registerUser(ctx.app);
    const put = await ctx.app.inject({ method: 'PUT', url: '/api/me/card', headers: auth(u.token), payload: { firstName: 'Io', company: 'Cosedil' } });
    expect(put.statusCode).toBe(200);
    const again = await ctx.app.inject({ method: 'PUT', url: '/api/me/card', headers: auth(u.token), payload: { firstName: 'Io', jobTitle: 'PM' } });
    expect(again.json().id).toBe(put.json().id);
    expect((await search('', u.token)).total).toBe(0);
    expect((await ctx.app.inject({ method: 'GET', url: '/api/me/card', headers: auth(u.token) })).json().card.jobTitle).toBe('PM');
  });

  it('exports all personal data and deletes the account', async () => {
    const u = await registerUser(ctx.app);
    await create({ firstName: 'Da', lastName: 'Cancellare' }, u.token);
    const exp = await ctx.app.inject({ method: 'GET', url: '/api/me/export', headers: auth(u.token) });
    expect(exp.json()).toMatchObject({ user: { email: u.email }, contacts: [expect.objectContaining({ lastName: 'Cancellare' })] });

    const wrong = await ctx.app.inject({ method: 'DELETE', url: '/api/me', headers: auth(u.token), payload: { password: 'no' } });
    expect(wrong.statusCode).toBe(403);
    const del = await ctx.app.inject({ method: 'DELETE', url: '/api/me', headers: auth(u.token), payload: { password: 'password-sicura-123' } });
    expect(del.statusCode).toBe(204);
    const { rows } = await ctx.db.query('SELECT count(*)::int AS n FROM contacts WHERE user_id = $1', [u.userId]);
    expect(rows[0].n).toBe(0);
    expect((await ctx.app.inject({ method: 'POST', url: '/api/auth/refresh', headers: { cookie: u.cookie } })).statusCode).toBe(401);
  });
});
