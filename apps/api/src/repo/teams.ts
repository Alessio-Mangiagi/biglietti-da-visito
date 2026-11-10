import type { Page, SharedContact, TeamDetail, TeamMember, TeamRole, TeamSummary } from '@cardvault/shared';
import type pg from 'pg';
import { toContact, type ContactRow } from './contacts';

type Queryable = Pick<pg.Pool | pg.PoolClient, 'query'>;

const SUMMARY = `
  t.id, t.name, m.role,
  (SELECT count(*) FROM team_members x WHERE x.team_id = t.id) AS member_count,
  (SELECT count(*) FROM team_contacts x WHERE x.team_id = t.id) AS contact_count`;

interface SummaryRow {
  id: string;
  name: string;
  role: TeamRole;
  member_count: string;
  contact_count: string;
}

const toSummary = (r: SummaryRow): TeamSummary => ({
  id: r.id,
  name: r.name,
  role: r.role,
  memberCount: Number(r.member_count),
  contactCount: Number(r.contact_count),
});

export async function listTeams(db: Queryable, userId: string): Promise<TeamSummary[]> {
  const { rows } = await db.query<SummaryRow>(
    `SELECT ${SUMMARY} FROM teams t JOIN team_members m ON m.team_id = t.id AND m.user_id = $1 ORDER BY t.name, t.id`,
    [userId],
  );
  return rows.map(toSummary);
}

/** The caller's role in the team, or null when not a member (callers answer 404, not 403). */
export async function memberRole(db: Queryable, teamId: string, userId: string): Promise<TeamRole | null> {
  const { rows } = await db.query<{ role: TeamRole }>('SELECT role FROM team_members WHERE team_id = $1 AND user_id = $2', [teamId, userId]);
  return rows[0]?.role ?? null;
}

export async function getTeam(db: Queryable, teamId: string, userId: string): Promise<TeamDetail | null> {
  const { rows } = await db.query<SummaryRow>(
    `SELECT ${SUMMARY} FROM teams t JOIN team_members m ON m.team_id = t.id AND m.user_id = $2 WHERE t.id = $1`,
    [teamId, userId],
  );
  if (!rows[0]) return null;
  const members = await db.query<{ user_id: string; display_name: string; email: string; role: TeamRole; joined_at: Date }>(
    `SELECT m.user_id, u.display_name, u.email, m.role, m.joined_at
     FROM team_members m JOIN users u ON u.id = m.user_id
     WHERE m.team_id = $1 ORDER BY m.role, lower(u.display_name), m.user_id`,
    [teamId],
  );
  return {
    ...toSummary(rows[0]),
    members: members.rows.map(
      (m): TeamMember => ({ userId: m.user_id, displayName: m.display_name, email: m.email, role: m.role, joinedAt: m.joined_at.toISOString() }),
    ),
  };
}

export async function createTeam(db: Queryable, userId: string, name: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `WITH t AS (INSERT INTO teams (name, created_by) VALUES ($1, $2) RETURNING id)
     INSERT INTO team_members (team_id, user_id, role) SELECT id, $2, 'admin' FROM t RETURNING team_id AS id`,
    [name, userId],
  );
  return rows[0]!.id;
}

/**
 * Removes a member. Their shared contacts leave the team with them; the oldest remaining
 * member is promoted when the last admin goes, and an empty team is deleted.
 */
export async function removeMember(db: Queryable, teamId: string, userId: string): Promise<void> {
  await db.query(
    `DELETE FROM team_contacts tc USING contacts c
     WHERE tc.team_id = $1 AND tc.contact_id = c.id AND c.user_id = $2`,
    [teamId, userId],
  );
  await db.query('DELETE FROM team_members WHERE team_id = $1 AND user_id = $2', [teamId, userId]);
  await db.query(
    `UPDATE team_members SET role = 'admin'
     WHERE team_id = $1 AND user_id = (SELECT user_id FROM team_members WHERE team_id = $1 ORDER BY joined_at, user_id LIMIT 1)
       AND NOT EXISTS (SELECT 1 FROM team_members WHERE team_id = $1 AND role = 'admin')`,
    [teamId],
  );
  await db.query('DELETE FROM teams t WHERE t.id = $1 AND NOT EXISTS (SELECT 1 FROM team_members m WHERE m.team_id = t.id)', [teamId]);
}

// ---------------------------------------------------------------- contacts

const SHARED_SELECT = `
  c.*,
  EXISTS (SELECT 1 FROM contact_images i WHERE i.contact_id = c.id AND i.side = 'front') AS has_front,
  EXISTS (SELECT 1 FROM contact_images i WHERE i.contact_id = c.id AND i.side = 'back') AS has_back,
  tc.team_id, tc.shared_at, tc.shared_by, u.display_name AS shared_by_name`;

type SharedRow = ContactRow & { team_id: string; shared_at: Date; shared_by: string; shared_by_name: string };

function toShared(r: SharedRow, viewer: string): SharedContact {
  // drop everything that is not on the card itself (see SharedContact)
  const { notes: _n, tags: _t, followUpOn: _f, followUpNote: _fn, favorite: _fav, ocrText: _o, metAt: _ma, metOn: _mo, ...card } =
    toContact(r);
  return {
    ...card,
    teamId: r.team_id,
    sharedBy: { id: r.shared_by, name: r.shared_by_name },
    sharedAt: r.shared_at.toISOString(),
    mine: r.shared_by === viewer,
  };
}

/** Card fields only: a search must not reveal what is written in the owner's notes or tags. */
const CARD_TEXT = `f_norm(concat_ws(' ', c.prefix, c.first_name, c.last_name, c.company, c.job_title,
  array_to_string(c.emails, ' '), c.website, c.city, c.province))`;

export async function listSharedContacts(
  db: Queryable,
  teamId: string,
  viewer: string,
  q: { q?: string; page: number; pageSize: number },
): Promise<Page<SharedContact>> {
  const params: unknown[] = [teamId];
  const where = ['tc.team_id = $1'];
  for (const term of (q.q ?? '').split(/\s+/).filter(Boolean).slice(0, 8)) {
    params.push(term.replace(/[\\%_]/g, (ch) => `\\${ch}`));
    where.push(`${CARD_TEXT} LIKE '%' || f_norm($${params.length}) || '%'`);
  }
  params.push(q.pageSize, (q.page - 1) * q.pageSize);
  const { rows } = await db.query<SharedRow & { total_count: string }>(
    `SELECT ${SHARED_SELECT}, count(*) OVER () AS total_count
     FROM team_contacts tc JOIN contacts c ON c.id = tc.contact_id JOIN users u ON u.id = tc.shared_by
     WHERE ${where.join(' AND ')}
     ORDER BY (c.first_name = '' AND c.last_name = ''), f_norm(c.last_name), f_norm(c.first_name), f_norm(c.company), c.id
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return {
    items: rows.map((r) => toShared(r, viewer)),
    total: rows[0] ? Number(rows[0].total_count) : 0,
    page: q.page,
    pageSize: q.pageSize,
  };
}

export async function getSharedContact(db: Queryable, teamId: string, contactId: string, viewer: string): Promise<SharedContact | null> {
  const { rows } = await db.query<SharedRow>(
    `SELECT ${SHARED_SELECT}
     FROM team_contacts tc JOIN contacts c ON c.id = tc.contact_id JOIN users u ON u.id = tc.shared_by
     WHERE tc.team_id = $1 AND tc.contact_id = $2`,
    [teamId, contactId],
  );
  return rows[0] ? toShared(rows[0], viewer) : null;
}

/** Teams (of the caller) a contact of theirs is shared with. */
export async function teamsOfContact(db: Queryable, contactId: string, userId: string): Promise<string[]> {
  const { rows } = await db.query<{ team_id: string }>(
    `SELECT tc.team_id FROM team_contacts tc JOIN team_members m ON m.team_id = tc.team_id AND m.user_id = $2
     WHERE tc.contact_id = $1`,
    [contactId, userId],
  );
  return rows.map((r) => r.team_id);
}
