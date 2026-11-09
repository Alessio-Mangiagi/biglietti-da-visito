import { ContactInputSchema, type Contact } from '@cardvault/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse } from '../app';
import { HttpError, notFound } from '../lib/errors';
import { verifyPassword } from '../lib/password';
import { getSelfCard, insertContact, searchContacts, updateContact } from '../repo/contacts';
import { getImage } from '../repo/images';
import { REFRESH_COOKIE, toUser } from './auth';
import { attachment } from './transfer';

const ProfileBody = z.object({ displayName: z.string().trim().min(1).max(120) });
const DeleteBody = z.object({ password: z.string().min(1).max(256) });

export async function accountRoutes(app: FastifyInstance) {
  const { db, config } = app.deps;

  const loadUser = async (id: string) => {
    const { rows } = await db.query('SELECT id, email, display_name, created_at FROM users WHERE id = $1', [id]);
    if (!rows[0]) throw notFound('Utente');
    return toUser(rows[0]);
  };

  app.get('/me', async (req) => loadUser(req.userId));

  app.patch('/me', async (req) => {
    const { displayName } = parse(ProfileBody, req.body);
    await db.query('UPDATE users SET display_name = $2, updated_at = now() WHERE id = $1', [req.userId, displayName]);
    return loadUser(req.userId);
  });

  // ---- "Il mio biglietto": a contact row flagged is_self, never listed with the others
  app.get('/me/card', async (req) => ({ card: await getSelfCard(db, req.userId) }));

  app.put('/me/card', async (req) => {
    const input = parse(ContactInputSchema, req.body);
    const existing = await getSelfCard(db, req.userId);
    if (existing) return updateContact(db, req.userId, existing.id, input);
    return (await insertContact(db, req.userId, input, { isSelf: true })).contact;
  });

  // ---- GDPR: data portability (art. 20) and erasure (art. 17)
  app.get('/me/export', { config: { rateLimit: { max: 3, timeWindow: '1 minute' } } }, async (req, reply) => {
    const user = await loadUser(req.userId);
    const { items } = await searchContacts(db, req.userId, {
      sort: 'createdAt',
      dir: 'asc',
      page: 1,
      pageSize: 100_000,
    });
    const self = await getSelfCard(db, req.userId);
    const withImages = async (c: Contact) => {
      const images: Record<string, { mime: string; base64: string }> = {};
      for (const side of ['front', 'back'] as const) {
        const present = side === 'front' ? c.hasFront : c.hasBack;
        const img = present ? await getImage(db, config.imageKey, c.id, side) : null;
        if (img) images[side] = { mime: img.mime, base64: img.data.toString('base64') };
      }
      return { ...c, images };
    };
    const data = {
      exportedAt: new Date().toISOString(),
      format: 'cardvault-export/1',
      user,
      myCard: self ? await withImages(self) : null,
      contacts: await Promise.all(items.map(withImages)),
    };
    return reply
      .header('content-type', 'application/json; charset=utf-8')
      .header('content-disposition', attachment(`cardvault-dati-${new Date().toISOString().slice(0, 10)}.json`))
      .send(JSON.stringify(data, null, 2));
  });

  app.delete('/me', { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } }, async (req, reply) => {
    const { password } = parse(DeleteBody, req.body);
    const { rows } = await db.query<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [req.userId]);
    if (!rows[0]) throw notFound('Utente');
    if (!(await verifyPassword(rows[0].password_hash, password))) {
      throw new HttpError(403, 'Password non corretta', 'BAD_PASSWORD');
    }
    // contacts, images, sessions and reset tokens go with ON DELETE CASCADE
    await db.query('DELETE FROM users WHERE id = $1', [req.userId]);
    reply.clearCookie(REFRESH_COOKIE, { path: '/api/auth', domain: config.COOKIE_DOMAIN });
    return reply.status(204).send();
  });
}
