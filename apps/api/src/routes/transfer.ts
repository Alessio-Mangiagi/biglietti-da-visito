import {
  ContactInputSchema,
  SearchQuerySchema,
  displayName,
  parseVCards,
  toCsv,
  toVCard,
  type Contact,
} from '@cardvault/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { parse } from '../app';
import { badRequest, notFound } from '../lib/errors';
import { findDuplicates, getContact, insertContact, searchContacts } from '../repo/contacts';
import { getImage } from '../repo/images';
import { IdParams } from './contacts';

const MAX_EXPORT = 5000;
const MAX_IMPORT = 2000;

const ExportQuery = SearchQuerySchema.extend({
  ids: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',').filter(Boolean) : undefined))
    .pipe(z.array(z.uuid()).max(MAX_EXPORT).optional()),
  version: z.enum(['3.0', '4.0']).default('4.0'),
});

const VCardQuery = z.object({
  version: z.enum(['3.0', '4.0']).default('3.0'),
  photo: z.enum(['0', '1']).default('0'),
});

const ImportQuery = z.object({ skipDuplicates: z.enum(['true', 'false']).default('true') });

/** RFC 6266 filename with an ASCII fallback. */
export function attachment(name: string): string {
  const ascii =
    name
      .normalize('NFD')
      .replace(/[^\x20-\x7e]/g, '')
      .replace(/["\\]/g, '') || 'contatto';
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

const today = () => new Date().toISOString().slice(0, 10);

export async function transferRoutes(app: FastifyInstance) {
  const { db, config } = app.deps;

  async function selection(req: FastifyRequest): Promise<{ contacts: Contact[]; version: '3.0' | '4.0' }> {
    const q = parse(ExportQuery, req.query);
    if (q.ids?.length) {
      const all = await Promise.all(q.ids.map((id) => getContact(db, req.userId, id)));
      return { contacts: all.filter((c): c is Contact => !!c), version: q.version };
    }
    const page = await searchContacts(db, req.userId, { ...q, page: 1, pageSize: MAX_EXPORT });
    return { contacts: page.items, version: q.version };
  }

  app.get('/contacts/export.vcf', async (req, reply) => {
    const { contacts, version } = await selection(req);
    const body = contacts.map((c) => toVCard(c, version, { uid: c.id, rev: c.updatedAt })).join('');
    return reply
      .header('content-type', 'text/vcard; charset=utf-8')
      .header('content-disposition', attachment(`cardvault-${today()}.vcf`))
      .send(body);
  });

  app.get('/contacts/export.csv', async (req, reply) => {
    const { contacts } = await selection(req);
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', attachment(`cardvault-${today()}.csv`))
      .send(toCsv(contacts));
  });

  /** Single card for "Aggiungi ai contatti del telefono" — v3.0 by default for iOS/Android. */
  app.get('/contacts/:id/vcard', async (req, reply) => {
    const { id } = parse(IdParams, req.params);
    const { version, photo } = parse(VCardQuery, req.query);
    const c = await getContact(db, req.userId, id);
    if (!c) throw notFound('Contatto');
    let photoJpegBase64: string | undefined;
    if (photo === '1' && c.hasFront) {
      const img = await getImage(db, config.imageKey, id, 'front');
      if (img?.mime === 'image/jpeg') photoJpegBase64 = img.data.toString('base64');
    }
    return reply
      .header('content-type', 'text/vcard; charset=utf-8')
      .header('content-disposition', attachment(`${displayName(c)}.vcf`))
      .send(toVCard(c, version, { uid: c.id, rev: c.updatedAt, photoJpegBase64 }));
  });

  app.post('/contacts/import', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    if (typeof req.body !== 'string') throw badRequest('Invia un file .vcf (Content-Type: text/vcard)');
    const { skipDuplicates } = parse(ImportQuery, req.query);
    const raw = parseVCards(req.body);
    if (!raw.length) throw badRequest('Nessun contatto trovato nel file');
    if (raw.length > MAX_IMPORT) throw badRequest(`Massimo ${MAX_IMPORT} contatti per importazione`);
    let created = 0;
    let skipped = 0;
    const errors: Array<{ index: number; message: string }> = [];
    for (const [index, r] of raw.entries()) {
      const parsed = ContactInputSchema.safeParse(r);
      if (!parsed.success) {
        errors.push({ index, message: parsed.error.issues[0]?.message ?? 'Contatto non valido' });
        continue;
      }
      if (skipDuplicates === 'true' && (await findDuplicates(db, req.userId, parsed.data)).length) {
        skipped++;
        continue;
      }
      await insertContact(db, req.userId, parsed.data);
      created++;
    }
    return { created, skipped, errors };
  });
}
