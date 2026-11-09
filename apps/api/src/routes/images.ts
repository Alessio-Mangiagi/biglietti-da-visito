import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { IMAGE_TYPES, parse } from '../app';
import { HttpError, notFound } from '../lib/errors';
import { getContact } from '../repo/contacts';
import { deleteImage, getImage, putImage } from '../repo/images';

const Params = z.object({ id: z.uuid({ error: 'Contatto non trovato' }), side: z.enum(['front', 'back']) });

/** Magic bytes: the declared content type must match the payload. */
function sniff(buf: Buffer): (typeof IMAGE_TYPES)[number] | null {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

export async function imageRoutes(app: FastifyInstance) {
  const { db, config } = app.deps;

  app.put('/contacts/:id/images/:side', async (req, reply) => {
    const { id, side } = parse(Params, req.params);
    const body = req.body;
    if (!Buffer.isBuffer(body) || !body.length) throw new HttpError(415, 'Invia un’immagine JPEG, PNG o WebP', 'BAD_IMAGE');
    const mime = sniff(body);
    if (!mime || mime !== req.headers['content-type']?.split(';')[0]) throw new HttpError(415, 'Formato immagine non valido', 'BAD_IMAGE');
    if (!(await getContact(db, req.userId, id))) throw notFound('Contatto');
    await putImage(db, config.imageKey, id, side, mime, body);
    return reply.status(204).send();
  });

  app.get('/contacts/:id/images/:side', async (req, reply) => {
    const { id, side } = parse(Params, req.params);
    if (!(await getContact(db, req.userId, id))) throw notFound('Contatto');
    const img = await getImage(db, config.imageKey, id, side);
    if (!img) throw notFound('Immagine');
    return reply
      .header('content-type', img.mime)
      .header('cache-control', 'private, max-age=86400')
      .header('x-content-type-options', 'nosniff')
      .send(img.data);
  });

  app.delete('/contacts/:id/images/:side', async (req, reply) => {
    const { id, side } = parse(Params, req.params);
    if (!(await getContact(db, req.userId, id))) throw notFound('Contatto');
    if (!(await deleteImage(db, id, side))) throw notFound('Immagine');
    return reply.status(204).send();
  });
}
