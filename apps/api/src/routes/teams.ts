import { createHash, randomBytes } from 'node:crypto';
import { TeamNameSchema, type InvitePreview, type TeamInvite } from '@cardvault/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { parse } from '../app';
import { withTransaction } from '../db/pool';
import { badRequest, HttpError, notFound } from '../lib/errors';
import { findDuplicates, getContact, insertContact } from '../repo/contacts';
import { adoptImages, getImage } from '../repo/images';
import {
  createTeam,
  getSharedContact,
  getTeam,
  listSharedContacts,
  listTeams,
  memberRole,
  removeMember,
  teamsOfContact,
} from '../repo/teams';

const TeamParams = z.object({ teamId: z.uuid({ error: 'Team non trovato' }) });
const MemberParams = TeamParams.extend({ userId: z.uuid({ error: 'Membro non trovato' }) });
const ContactParams = TeamParams.extend({ id: z.uuid({ error: 'Contatto non trovato' }) });
const ImageParams = ContactParams.extend({ side: z.enum(['front', 'back']) });
const ShareBody = z.object({ contactId: z.uuid({ error: 'Contatto non trovato' }) });
const RoleBody = z.object({ role: z.enum(['admin', 'member']) });
const TokenBody = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{32,64}$/, 'Invito non valido') });
const ListQuery = z.object({
  q: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

const INVITE_DAYS = 7;
const MAX_TEAMS_CREATED = 10;
const MAX_MEMBERS = 500;

const hashToken = (t: string) => createHash('sha256').update(t).digest();

export async function teamRoutes(app: FastifyInstance) {
  const { db, config } = app.deps;

  /** Not a member → 404, so team ids cannot be probed. */
  async function requireRole(req: FastifyRequest, teamId: string, need: 'member' | 'admin' = 'member') {
    const role = await memberRole(db, teamId, req.userId);
    if (!role) throw notFound('Team');
    if (need === 'admin' && role !== 'admin') throw new HttpError(403, 'Solo un amministratore del team può farlo', 'NOT_ADMIN');
    return role;
  }

  app.get('/teams', async (req) => listTeams(db, req.userId));

  app.post('/teams', async (req, reply) => {
    const { name } = parse(TeamNameSchema, req.body);
    const { rows } = await db.query<{ n: string }>('SELECT count(*) AS n FROM teams WHERE created_by = $1', [req.userId]);
    if (Number(rows[0]!.n) >= MAX_TEAMS_CREATED) throw badRequest('Hai già creato il numero massimo di team', 'TOO_MANY_TEAMS');
    const id = await createTeam(db, req.userId, name);
    reply.status(201);
    return getTeam(db, id, req.userId);
  });

  app.get('/teams/:teamId', async (req) => {
    const { teamId } = parse(TeamParams, req.params);
    const team = await getTeam(db, teamId, req.userId);
    if (!team) throw notFound('Team');
    return team;
  });

  app.patch('/teams/:teamId', async (req) => {
    const { teamId } = parse(TeamParams, req.params);
    await requireRole(req, teamId, 'admin');
    const { name } = parse(TeamNameSchema, req.body);
    await db.query('UPDATE teams SET name = $2 WHERE id = $1', [teamId, name]);
    return getTeam(db, teamId, req.userId);
  });

  app.delete('/teams/:teamId', async (req, reply) => {
    const { teamId } = parse(TeamParams, req.params);
    await requireRole(req, teamId, 'admin');
    // members' own contacts are untouched: only the sharing goes
    await db.query('DELETE FROM teams WHERE id = $1', [teamId]);
    return reply.status(204).send();
  });

  // ------------------------------------------------------------- members

  /** An admin removes someone, or anyone leaves. */
  app.delete('/teams/:teamId/members/:userId', async (req, reply) => {
    const { teamId, userId } = parse(MemberParams, req.params);
    await requireRole(req, teamId, userId === req.userId ? 'member' : 'admin');
    if (!(await memberRole(db, teamId, userId))) throw notFound('Membro');
    await withTransaction(db, (tx) => removeMember(tx, teamId, userId));
    return reply.status(204).send();
  });

  app.patch('/teams/:teamId/members/:userId', async (req) => {
    const { teamId, userId } = parse(MemberParams, req.params);
    await requireRole(req, teamId, 'admin');
    const { role } = parse(RoleBody, req.body);
    return withTransaction(db, async (tx) => {
      const res = await tx.query('UPDATE team_members SET role = $3 WHERE team_id = $1 AND user_id = $2', [teamId, userId, role]);
      if (!res.rowCount) throw notFound('Membro');
      const admins = await tx.query("SELECT 1 FROM team_members WHERE team_id = $1 AND role = 'admin'", [teamId]);
      if (!admins.rowCount) throw badRequest('Il team deve avere almeno un amministratore', 'LAST_ADMIN');
      return getTeam(tx, teamId, req.userId);
    });
  });

  // ------------------------------------------------------------- invites

  app.post('/teams/:teamId/invites', { config: { rateLimit: { max: 20, timeWindow: '1 hour' } } }, async (req, reply) => {
    const { teamId } = parse(TeamParams, req.params);
    await requireRole(req, teamId, 'admin');
    const token = randomBytes(24).toString('base64url');
    const expires = new Date(Date.now() + INVITE_DAYS * 86_400_000);
    await db.query('INSERT INTO team_invites (token_hash, team_id, created_by, expires_at) VALUES ($1, $2, $3, $4)', [
      hashToken(token),
      teamId,
      req.userId,
      expires,
    ]);
    reply.status(201);
    // the token travels in the fragment: never sent to a server, never in logs or Referer
    return { url: `${config.APP_URL}/team/invito#${token}`, expiresAt: expires.toISOString() } satisfies TeamInvite;
  });

  /** Every link handed out so far stops working. */
  app.delete('/teams/:teamId/invites', async (req, reply) => {
    const { teamId } = parse(TeamParams, req.params);
    await requireRole(req, teamId, 'admin');
    await db.query('UPDATE team_invites SET revoked_at = now() WHERE team_id = $1 AND revoked_at IS NULL', [teamId]);
    return reply.status(204).send();
  });

  const findInvite = async (token: string) => {
    const { rows } = await db.query<{ team_id: string; team_name: string; invited_by: string; member_count: string }>(
      `SELECT i.team_id, t.name AS team_name, u.display_name AS invited_by,
              (SELECT count(*) FROM team_members m WHERE m.team_id = i.team_id) AS member_count
       FROM team_invites i JOIN teams t ON t.id = i.team_id JOIN users u ON u.id = i.created_by
       WHERE i.token_hash = $1 AND i.revoked_at IS NULL AND i.expires_at > now()`,
      [hashToken(token)],
    );
    if (!rows[0]) throw new HttpError(404, 'Invito scaduto o non valido: chiedine uno nuovo', 'INVITE_INVALID');
    return rows[0];
  };

  const joinLimit = { config: { rateLimit: { max: 20, timeWindow: '15 minutes' } } };

  app.post('/teams/join/preview', joinLimit, async (req) => {
    const { token } = parse(TokenBody, req.body);
    const inv = await findInvite(token);
    return {
      teamId: inv.team_id,
      teamName: inv.team_name,
      invitedBy: inv.invited_by,
      memberCount: Number(inv.member_count),
      alreadyMember: !!(await memberRole(db, inv.team_id, req.userId)),
    } satisfies InvitePreview;
  });

  app.post('/teams/join', joinLimit, async (req) => {
    const { token } = parse(TokenBody, req.body);
    const inv = await findInvite(token);
    if (Number(inv.member_count) >= MAX_MEMBERS) throw badRequest('Il team è al completo', 'TEAM_FULL');
    const res = await db.query(
      `INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, 'member') ON CONFLICT DO NOTHING`,
      [inv.team_id, req.userId],
    );
    if (res.rowCount) await db.query('UPDATE team_invites SET uses = uses + 1 WHERE token_hash = $1', [hashToken(token)]);
    return getTeam(db, inv.team_id, req.userId);
  });

  // ------------------------------------------------------------- contacts

  app.get('/teams/:teamId/contacts', async (req) => {
    const { teamId } = parse(TeamParams, req.params);
    await requireRole(req, teamId);
    return listSharedContacts(db, teamId, req.userId, parse(ListQuery, req.query));
  });

  app.post('/teams/:teamId/contacts', async (req, reply) => {
    const { teamId } = parse(TeamParams, req.params);
    await requireRole(req, teamId);
    const { contactId } = parse(ShareBody, req.body);
    // only your own cards (and never "my card", which has its own QR sharing)
    const own = await db.query('SELECT 1 FROM contacts WHERE id = $1 AND user_id = $2 AND NOT is_self', [contactId, req.userId]);
    if (!own.rowCount) throw notFound('Contatto');
    await db.query(
      'INSERT INTO team_contacts (team_id, contact_id, shared_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      [teamId, contactId, req.userId],
    );
    reply.status(201);
    return getSharedContact(db, teamId, contactId, req.userId);
  });

  /** The owner stops sharing; an admin can also take a card out of the team. */
  app.delete('/teams/:teamId/contacts/:id', async (req, reply) => {
    const { teamId, id } = parse(ContactParams, req.params);
    const role = await requireRole(req, teamId);
    const res = await db.query(
      `DELETE FROM team_contacts WHERE team_id = $1 AND contact_id = $2 AND (shared_by = $3 OR $4)`,
      [teamId, id, req.userId, role === 'admin'],
    );
    if (!res.rowCount) throw notFound('Contatto');
    return reply.status(204).send();
  });

  app.get('/teams/:teamId/contacts/:id', async (req) => {
    const { teamId, id } = parse(ContactParams, req.params);
    await requireRole(req, teamId);
    const c = await getSharedContact(db, teamId, id, req.userId);
    if (!c) throw notFound('Contatto');
    return c;
  });

  app.get('/teams/:teamId/contacts/:id/images/:side', async (req, reply) => {
    const { teamId, id, side } = parse(ImageParams, req.params);
    await requireRole(req, teamId);
    if (!(await getSharedContact(db, teamId, id, req.userId))) throw notFound('Contatto');
    const img = await getImage(db, config.imageKey, id, side);
    if (!img) throw notFound('Immagine');
    return reply
      .header('content-type', img.mime)
      .header('cache-control', 'private, no-store')
      .header('x-content-type-options', 'nosniff')
      .send(img.data);
  });

  /** Copies a colleague's card (fields + photos) into your own wallet. */
  app.post('/teams/:teamId/contacts/:id/copy', async (req, reply) => {
    const { teamId, id } = parse(ContactParams, req.params);
    await requireRole(req, teamId);
    const shared = await getSharedContact(db, teamId, id, req.userId);
    if (!shared) throw notFound('Contatto');
    const { contact } = await withTransaction(db, async (tx) => {
      const out = await insertContact(tx, req.userId, {
        prefix: shared.prefix,
        firstName: shared.firstName,
        lastName: shared.lastName,
        company: shared.company,
        jobTitle: shared.jobTitle,
        emails: shared.emails,
        phones: shared.phones,
        website: shared.website,
        address: shared.address,
        socials: shared.socials,
        notes: '',
        tags: [],
        metAt: '',
        metOn: null,
        favorite: false,
        ocrText: '',
      });
      await adoptImages(tx, config.imageKey, id, out.contact.id);
      return out;
    });
    const fresh = (await getContact(db, req.userId, contact.id))!;
    reply.status(201);
    return { contact: fresh, duplicates: await findDuplicates(db, req.userId, fresh, fresh.id) };
  });

  /** For the contact page: which of my teams already have this card. */
  app.get('/contacts/:id/teams', async (req) => {
    const { id } = parse(z.object({ id: z.uuid({ error: 'Contatto non trovato' }) }), req.params);
    if (!(await getContact(db, req.userId, id))) throw notFound('Contatto');
    return teamsOfContact(db, id, req.userId);
  });
}
