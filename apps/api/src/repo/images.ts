import type pg from 'pg';
import { decrypt, encrypt } from '../lib/crypto';

type Queryable = Pick<pg.Pool | pg.PoolClient, 'query'>;
export type Side = 'front' | 'back';

const KEY_VERSION = 1;
const aad = (contactId: string, side: Side) => `${contactId}:${side}`;

export async function putImage(db: Queryable, key: Buffer, contactId: string, side: Side, mime: string, data: Buffer) {
  const blob = encrypt(key, data, aad(contactId, side));
  await db.query(
    `INSERT INTO contact_images (contact_id, side, mime, key_version, iv, auth_tag, data, byte_size)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (contact_id, side) DO UPDATE SET mime = EXCLUDED.mime, key_version = EXCLUDED.key_version,
       iv = EXCLUDED.iv, auth_tag = EXCLUDED.auth_tag, data = EXCLUDED.data, byte_size = EXCLUDED.byte_size, created_at = now()`,
    [contactId, side, mime, KEY_VERSION, blob.iv, blob.authTag, blob.data, data.length],
  );
}

export async function getImage(db: Queryable, key: Buffer, contactId: string, side: Side): Promise<{ mime: string; data: Buffer } | null> {
  const { rows } = await db.query<{ mime: string; iv: Buffer; auth_tag: Buffer; data: Buffer }>(
    'SELECT mime, iv, auth_tag, data FROM contact_images WHERE contact_id = $1 AND side = $2',
    [contactId, side],
  );
  const r = rows[0];
  if (!r) return null;
  return { mime: r.mime, data: decrypt(key, { iv: r.iv, authTag: r.auth_tag, data: r.data }, aad(contactId, side)) };
}

export async function deleteImage(db: Queryable, contactId: string, side: Side): Promise<boolean> {
  const res = await db.query('DELETE FROM contact_images WHERE contact_id = $1 AND side = $2', [contactId, side]);
  return (res.rowCount ?? 0) > 0;
}

/** Copies photos the target lacks; ciphertext is bound to its contact, so it is re-encrypted. */
export async function adoptImages(db: Queryable, key: Buffer, fromId: string, toId: string) {
  for (const side of ['front', 'back'] as const) {
    const exists = await db.query('SELECT 1 FROM contact_images WHERE contact_id = $1 AND side = $2', [toId, side]);
    if (exists.rowCount) continue;
    const img = await getImage(db, key, fromId, side);
    if (img) await putImage(db, key, toId, side, img.mime, img.data);
  }
}
