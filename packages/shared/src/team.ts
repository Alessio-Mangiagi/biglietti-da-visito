import { z } from 'zod';
import { IsoDate, type Contact } from './contact';

// ------------------------------------------------------------- follow-ups

export const FollowUpSchema = z.object({
  on: IsoDate.nullable(),
  note: z.string().trim().max(500).optional().default(''),
});
export type FollowUp = z.infer<typeof FollowUpSchema>;

export interface WalletStats {
  total: number;
  thisMonth: number;
  /** Reminders due today or overdue. */
  followUpsDue: number;
  followUpsPlanned: number;
}

// ------------------------------------------------------------------ teams

export const TEAM_ROLES = ['admin', 'member'] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];

export const TeamNameSchema = z.object({ name: z.string().trim().min(2, 'Nome troppo corto').max(80) });

export interface TeamSummary {
  id: string;
  name: string;
  role: TeamRole;
  memberCount: number;
  contactCount: number;
}

export interface TeamMember {
  userId: string;
  displayName: string;
  email: string;
  role: TeamRole;
  joinedAt: string;
}

export interface TeamDetail extends TeamSummary {
  members: TeamMember[];
}

export interface TeamInvite {
  url: string;
  expiresAt: string;
}

export interface InvitePreview {
  teamId: string;
  teamName: string;
  invitedBy: string;
  memberCount: number;
  alreadyMember: boolean;
}

/**
 * What colleagues see of a shared contact: the business card itself. Personal notes,
 * tags, reminders, favourites and the OCR text stay with the owner.
 */
export type SharedContact = Omit<
  Contact,
  'notes' | 'tags' | 'followUpOn' | 'followUpNote' | 'favorite' | 'ocrText' | 'metAt' | 'metOn'
> & {
  teamId: string;
  sharedBy: { id: string; name: string };
  sharedAt: string;
  /** The current user is the one who shared it. */
  mine: boolean;
};

export const SHARED_FIELDS_NOTE =
  'Ai colleghi arrivano solo i dati del biglietto e le foto: note, tag, evento e promemoria restano tuoi.';
