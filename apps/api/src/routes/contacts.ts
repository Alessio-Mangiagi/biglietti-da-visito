import { ContactInputSchema, ContactPatchSchema, SearchQuerySchema } from '@cardvault/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse } from '../app';
import { withTransaction } from '../db/pool';
import { badRequest, notFound } from '../lib/errors';
import { adoptImages } from '../repo/images';
import {
  deleteContact,
  findDuplicates,
  getContact,
  insertContact,
  listEvents,
  listTags,
  mergeContacts,
  searchContacts,
  updateContact,
} from '../repo/contacts';

export const IdParams = z.object({ id: z.uuid({ error: 'Contatto non trovato' }) });

const CreateBody = ContactInputSchema.extend({ clientRef: z.uuid().optional() });
const MergeBody = z.object({ sourceId: z.uuid() });

export async function contactRoutes(app: FastifyInstance) {
  const { db } = app.deps;

  app.get('/contacts', async (req) => searchContacts(db, req.userId, parse(SearchQuerySchema, req.query)));

  app.get('/contacts/tags', async (req) => listTags(db, req.userId));
  app.get('/contacts/events', async (req) => listEvents(db, req.userId));

  app.post('/contacts', async (req, reply) => {
    const { clientRef, ...input } = parse(CreateBody, req.body);
    const { contact, created } = await insertContact(db, req.userId, input, { clientRef });
    const duplicates = await findDuplicates(db, req.userId, contact, contact.id);
    reply.status(created ? 201 : 200);
    return { contact, duplicates };
  });

  app.get('/contacts/:id', async (req) => {
    const { id } = parse(IdParams, req.params);
    const c = await getContact(db, req.userId, id);
    if (!c) throw notFound('Contatto');
    return c;
  });

  app.put('/contacts/:id', async (req) => {
    const { id } = parse(IdParams, req.params);
    const c = await updateContact(db, req.userId, id, parse(ContactInputSchema, req.body));
    if (!c) throw notFound('Contatto');
    return c;
  });

  app.patch('/contacts/:id', async (req) => {
    const { id } = parse(IdParams, req.params);
    const patch = parse(ContactPatchSchema, req.body);
    // only keys actually sent are applied (zod defaults would otherwise blank other fields)
    const sent = Object.keys((req.body as object) ?? {});
    const current = await getContact(db, req.userId, id);
    if (!current) throw notFound('Contatto');
    const next = { ...current } as Record<string, unknown>;
    for (const k of sent) if (k in patch) next[k] = (patch as Record<string, unknown>)[k];
    const c = await updateContact(db, req.userId, id, ContactInputSchema.parse(next));
    if (!c) throw notFound('Contatto');
    return c;
  });

  app.delete('/contacts/:id', async (req, reply) => {
    const { id } = parse(IdParams, req.params);
    if (!(await deleteContact(db, req.userId, id))) throw notFound('Contatto');
    return reply.status(204).send();
  });

  app.get('/contacts/:id/duplicates', async (req) => {
    const { id } = parse(IdParams, req.params);
    const c = await getContact(db, req.userId, id);
    if (!c) throw notFound('Contatto');
    return findDuplicates(db, req.userId, c, id);
  });

  /** Merge `sourceId` into `:id`; the source is deleted, its photos fill missing sides. */
  app.post('/contacts/:id/merge', async (req) => {
    const { id } = parse(IdParams, req.params);
    const { sourceId } = parse(MergeBody, req.body);
    if (id === sourceId) throw badRequest('Non puoi unire un contatto con se stesso');
    return withTransaction(db, async (tx) => {
      const [target, source] = await Promise.all([getContact(tx, req.userId, id), getContact(tx, req.userId, sourceId)]);
      if (!target || !source) throw notFound('Contatto');
      const merged = mergeContacts(ContactInputSchema.parse(target), ContactInputSchema.parse(source));
      await adoptImages(tx, app.deps.config.imageKey, sourceId, id);
      await tx.query('DELETE FROM contacts WHERE id = $1 AND user_id = $2', [sourceId, req.userId]);
      return updateContact(tx, req.userId, id, merged);
    });
  });
}
