import {
  ContactInputSchema,
  displayName,
  toE164,
  type Contact,
  type ContactInput,
  type Page,
  type SearchQuery,
} from '@cardvault/shared';
import type pg from 'pg';

type Queryable = Pick<pg.Pool | pg.PoolClient, 'query'>;

export interface ContactRow {
  id: string;
  user_id: string;
  is_self: boolean;
  prefix: string;
  first_name: string;
  last_name: string;
  company: string;
  job_title: string;
  emails: string[];
  phones: Contact['phones'];
  website: string;
  street: string;
  city: string;
  postal_code: string;
  province: string;
  country: string;
  socials: Contact['socials'];
  notes: string;
  tags: string[];
  met_at: string;
  met_on: string | null;
  favorite: boolean;
  ocr_text: string;
  created_at: Date;
  updated_at: Date;
  has_front: boolean;
  has_back: boolean;
}

const SELECT = `
  c.*,
  EXISTS (SELECT 1 FROM contact_images i WHERE i.contact_id = c.id AND i.side = 'front') AS has_front,
  EXISTS (SELECT 1 FROM contact_images i WHERE i.contact_id = c.id AND i.side = 'back') AS has_back`;

export function toContact(r: ContactRow): Contact {
  return {
    id: r.id,
    prefix: r.prefix,
    firstName: r.first_name,
    lastName: r.last_name,
    company: r.company,
    jobTitle: r.job_title,
    emails: r.emails,
    phones: r.phones,
    website: r.website,
    address: {
      street: r.street,
      city: r.city,
      postalCode: r.postal_code,
      province: r.province,
      country: r.country,
    },
    socials: r.socials,
    notes: r.notes,
    tags: r.tags,
    metAt: r.met_at,
    metOn: r.met_on,
    favorite: r.favorite,
    ocrText: r.ocr_text,
    hasFront: r.has_front,
    hasBack: r.has_back,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

const phoneKeys = (c: Pick<ContactInput, 'phones'>) =>
  [...new Set(c.phones.map((p) => toE164(p.value)).filter((x): x is string => !!x))];

const dedupeTags = (tags: string[]) => {
  const seen = new Set<string>();
  return tags.filter((t) => {
    const k = t.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

/** Column → value pairs for INSERT/UPDATE. */
function columns(c: ContactInput): Record<string, unknown> {
  return {
    prefix: c.prefix,
    first_name: c.firstName,
    last_name: c.lastName,
    company: c.company,
    job_title: c.jobTitle,
    emails: [...new Set(c.emails)],
    phones: JSON.stringify(c.phones),
    phone_keys: phoneKeys(c),
    website: c.website,
    street: c.address.street,
    city: c.address.city,
    postal_code: c.address.postalCode,
    province: c.address.province,
    country: c.address.country,
    socials: JSON.stringify(c.socials),
    notes: c.notes,
    tags: dedupeTags(c.tags),
    met_at: c.metAt,
    met_on: c.metOn,
    favorite: c.favorite,
    ocr_text: c.ocrText,
  };
}

export async function insertContact(
  db: Queryable,
  userId: string,
  c: ContactInput,
  opts: { isSelf?: boolean; clientRef?: string } = {},
): Promise<{ contact: Contact; created: boolean }> {
  if (opts.clientRef) {
    // replay from the offline queue: return the row created by the first attempt
    const { rows } = await db.query<ContactRow>(`SELECT ${SELECT} FROM contacts c WHERE c.user_id = $1 AND c.client_ref = $2`, [
      userId,
      opts.clientRef,
    ]);
    if (rows[0]) return { contact: toContact(rows[0]), created: false };
  }
  const cols = { ...columns(c), user_id: userId, is_self: opts.isSelf ?? false, client_ref: opts.clientRef ?? null };
  const keys = Object.keys(cols);
  const { rows } = await db.query<ContactRow>(
    `WITH c AS (INSERT INTO contacts (${keys.join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *)
     SELECT c.*, false AS has_front, false AS has_back FROM c`,
    Object.values(cols),
  );
  return { contact: toContact(rows[0]!), created: true };
}

export async function updateContact(db: Queryable, userId: string, id: string, c: ContactInput): Promise<Contact | null> {
  const cols = columns(c);
  const keys = Object.keys(cols);
  const { rows } = await db.query<ContactRow>(
    `WITH c AS (UPDATE contacts SET ${keys.map((k, i) => `${k} = $${i + 3}`).join(', ')}
       WHERE id = $1 AND user_id = $2 RETURNING *)
     SELECT ${SELECT} FROM c`,
    [id, userId, ...Object.values(cols)],
  );
  return rows[0] ? toContact(rows[0]) : null;
}

export async function getContact(db: Queryable, userId: string, id: string): Promise<Contact | null> {
  const { rows } = await db.query<ContactRow>(`SELECT ${SELECT} FROM contacts c WHERE c.id = $1 AND c.user_id = $2`, [
    id,
    userId,
  ]);
  return rows[0] ? toContact(rows[0]) : null;
}

export async function getSelfCard(db: Queryable, userId: string): Promise<Contact | null> {
  const { rows } = await db.query<ContactRow>(
    `SELECT ${SELECT} FROM contacts c WHERE c.user_id = $1 AND c.is_self`,
    [userId],
  );
  return rows[0] ? toContact(rows[0]) : null;
}

export async function deleteContact(db: Queryable, userId: string, id: string): Promise<boolean> {
  const res = await db.query('DELETE FROM contacts WHERE id = $1 AND user_id = $2 AND NOT is_self', [id, userId]);
  return (res.rowCount ?? 0) > 0;
}

// ------------------------------------------------------------------ search

/** Below this trigram word-similarity a term is not considered a (typo) match. */
export const FUZZY_THRESHOLD = 0.45;

export function buildSearch(userId: string, q: SearchQuery) {
  const params: unknown[] = [userId];
  const p = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };
  const where: string[] = ['c.user_id = $1', 'NOT c.is_self'];
  const rank: string[] = [];

  /** Substring or typo-tolerant match; % and _ typed by the user are literal, not wildcards. */
  const match = (expr: string, value: string) => {
    const raw = p(value);
    const like = p(value.replace(/[\\%_]/g, (ch) => `\\${ch}`));
    where.push(`(${expr} LIKE '%' || f_norm(${like}) || '%' OR word_similarity(f_norm(${raw}), ${expr}) >= ${FUZZY_THRESHOLD})`);
    rank.push(`word_similarity(f_norm(${raw}), ${expr})`);
  };

  // free text: every word must match somewhere
  const terms = (q.q ?? '').split(/\s+/).filter(Boolean).slice(0, 8);
  for (const t of terms) match('c.search_text', t);

  const fieldFilter = (expr: string, value: string | undefined) => {
    if (value) match(expr, value);
  };
  fieldFilter(`f_norm(c.first_name || ' ' || c.last_name)`, q.name);
  fieldFilter('f_norm(c.company)', q.company);
  fieldFilter('f_norm(c.job_title)', q.jobTitle);
  fieldFilter('f_norm(c.city)', q.city);
  fieldFilter('f_norm(c.met_at)', q.metAt);

  if (q.tag) where.push(`EXISTS (SELECT 1 FROM unnest(c.tags) t WHERE lower(t) = lower(${p(q.tag)}))`);
  if (q.metFrom) where.push(`c.met_on >= ${p(q.metFrom)}`);
  if (q.metTo) where.push(`c.met_on <= ${p(q.metTo)}`);
  if (q.favorite !== undefined) where.push(`c.favorite = ${p(q.favorite)}`);

  const dir = q.dir === 'desc' ? 'DESC' : 'ASC';
  const order: Record<SearchQuery['sort'], string> = {
    name: `(c.first_name = '' AND c.last_name = ''), f_norm(c.last_name) ${dir}, f_norm(c.first_name) ${dir}, f_norm(c.company) ${dir}`,
    company: `(c.company = ''), f_norm(c.company) ${dir}, f_norm(c.last_name) ${dir}`,
    createdAt: `c.created_at ${dir}`,
    metOn: `c.met_on ${dir} NULLS LAST, c.created_at DESC`,
  };
  // with a text query the best matches come first, then the chosen order
  const orderBy = [rank.length ? `(${rank.join(' + ')}) DESC` : null, order[q.sort], 'c.id'].filter(Boolean).join(', ');
  const limit = p(q.pageSize);
  const offset = p((q.page - 1) * q.pageSize);

  return {
    sql: `SELECT ${SELECT}, count(*) OVER () AS total_count
          FROM contacts c WHERE ${where.join(' AND ')}
          ORDER BY ${orderBy} LIMIT ${limit} OFFSET ${offset}`,
    params,
  };
}

export async function searchContacts(db: Queryable, userId: string, q: SearchQuery): Promise<Page<Contact>> {
  const { sql, params } = buildSearch(userId, q);
  const { rows } = await db.query<ContactRow & { total_count: string }>(sql, params);
  let total = rows[0] ? Number(rows[0].total_count) : 0;
  if (!rows.length && q.page > 1) {
    // past the last page: still report the real total
    const { sql: s2, params: p2 } = buildSearch(userId, { ...q, page: 1, pageSize: 1 });
    const r2 = await db.query<{ total_count: string }>(s2, p2);
    total = r2.rows[0] ? Number(r2.rows[0].total_count) : 0;
  }
  return { items: rows.map(toContact), total, page: q.page, pageSize: q.pageSize };
}

export async function listTags(db: Queryable, userId: string): Promise<Array<{ tag: string; count: number }>> {
  const { rows } = await db.query<{ tag: string; count: string }>(
    `SELECT min(t) AS tag, count(*) AS count FROM contacts c, unnest(c.tags) t
     WHERE c.user_id = $1 AND NOT c.is_self GROUP BY lower(t) ORDER BY count(*) DESC, min(t) LIMIT 200`,
    [userId],
  );
  return rows.map((r) => ({ tag: r.tag, count: Number(r.count) }));
}

export async function listEvents(db: Queryable, userId: string): Promise<string[]> {
  const { rows } = await db.query<{ met_at: string }>(
    `SELECT met_at FROM contacts WHERE user_id = $1 AND met_at <> '' AND NOT is_self
     GROUP BY met_at ORDER BY max(coalesce(met_on, created_at::date)) DESC LIMIT 50`,
    [userId],
  );
  return rows.map((r) => r.met_at);
}

// -------------------------------------------------------------- duplicates

export interface DuplicateMatch {
  id: string;
  name: string;
  company: string;
  matchedOn: Array<'email' | 'phone'>;
}

export async function findDuplicates(
  db: Queryable,
  userId: string,
  c: Pick<ContactInput, 'emails' | 'phones'>,
  excludeId?: string,
): Promise<DuplicateMatch[]> {
  const emails = c.emails.map((e) => e.toLowerCase());
  const phones = phoneKeys(c);
  if (!emails.length && !phones.length) return [];
  const { rows } = await db.query<{ id: string; first_name: string; last_name: string; company: string; by_email: boolean; by_phone: boolean }>(
    `SELECT id, first_name, last_name, company,
            emails && $2::text[] AS by_email, phone_keys && $3::text[] AS by_phone
     FROM contacts
     WHERE user_id = $1 AND NOT is_self AND ($4::uuid IS NULL OR id <> $4)
       AND (emails && $2::text[] OR phone_keys && $3::text[])
     ORDER BY updated_at DESC LIMIT 10`,
    [userId, emails, phones, excludeId ?? null],
  );
  return rows.map((r) => ({
    id: r.id,
    name: displayName({ firstName: r.first_name, lastName: r.last_name, company: r.company }),
    company: r.company,
    matchedOn: [...(r.by_email ? (['email'] as const) : []), ...(r.by_phone ? (['phone'] as const) : [])],
  }));
}

/** Merge `source` into `target`: empty fields are filled, lists are unioned, notes appended. */
export function mergeContacts(target: ContactInput, source: ContactInput): ContactInput {
  const pick = (a: string, b: string) => (a.trim() ? a : b);
  const unionBy = <T>(a: T[], b: T[], key: (x: T) => string) => {
    const seen = new Set(a.map(key));
    return [...a, ...b.filter((x) => !seen.has(key(x)))];
  };
  const addrEmpty = !Object.values(target.address).some((v) => v.trim());
  return ContactInputSchema.parse({
    prefix: pick(target.prefix, source.prefix),
    firstName: pick(target.firstName, source.firstName),
    lastName: pick(target.lastName, source.lastName),
    company: pick(target.company, source.company),
    jobTitle: pick(target.jobTitle, source.jobTitle),
    emails: unionBy(target.emails, source.emails, (e) => e.toLowerCase()),
    phones: unionBy(target.phones, source.phones, (p) => toE164(p.value) ?? p.value.replace(/\D/g, '')),
    website: pick(target.website, source.website),
    address: addrEmpty ? source.address : target.address,
    socials: unionBy(target.socials, source.socials, (s) => s.value.toLowerCase()),
    notes: [target.notes, source.notes].filter((n) => n.trim()).join('\n\n'),
    tags: unionBy(target.tags, source.tags, (t) => t.toLowerCase()),
    metAt: pick(target.metAt, source.metAt),
    metOn: target.metOn ?? source.metOn,
    favorite: target.favorite || source.favorite,
    ocrText: [target.ocrText, source.ocrText].filter(Boolean).join('\n---\n'),
  });
}
