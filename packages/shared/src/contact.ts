import { z } from 'zod';

export const PHONE_TYPES = ['mobile', 'work', 'home', 'fax', 'other'] as const;
export type PhoneType = (typeof PHONE_TYPES)[number];

export const SOCIAL_NETWORKS = [
  'linkedin',
  'instagram',
  'facebook',
  'x',
  'youtube',
  'github',
  'tiktok',
  'other',
] as const;
export type SocialNetwork = (typeof SOCIAL_NETWORKS)[number];

const trimmed = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) => trimmed(max).optional().default('');

export const PhoneSchema = z.object({
  type: z.enum(PHONE_TYPES).default('work'),
  value: trimmed(40).min(3),
});
export type Phone = z.infer<typeof PhoneSchema>;

export const SocialSchema = z.object({
  network: z.enum(SOCIAL_NETWORKS).default('other'),
  value: trimmed(300).min(1),
});
export type Social = z.infer<typeof SocialSchema>;

export const AddressSchema = z.object({
  street: optionalText(200),
  city: optionalText(120),
  postalCode: optionalText(20),
  province: optionalText(60),
  country: optionalText(80),
});
export type Address = z.infer<typeof AddressSchema>;

export const emptyAddress = (): Address => ({
  street: '',
  city: '',
  postalCode: '',
  province: '',
  country: '',
});

/** Date only, `YYYY-MM-DD`. */
export const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data non valida (AAAA-MM-GG)');

/** Fields the user can edit. Shared by create/update payloads, the review form and vCard/CSV. */
export const ContactInputSchema = z.object({
  prefix: optionalText(40),
  firstName: optionalText(120),
  lastName: optionalText(120),
  company: optionalText(200),
  jobTitle: optionalText(200),
  emails: z.array(z.email().trim().toLowerCase().max(254)).max(10).default([]),
  phones: z.array(PhoneSchema).max(10).default([]),
  website: optionalText(300),
  address: AddressSchema.default(emptyAddress),
  socials: z.array(SocialSchema).max(10).default([]),
  notes: optionalText(5000),
  tags: z.array(trimmed(40).min(1)).max(30).default([]),
  metAt: optionalText(200),
  metOn: IsoDate.nullable().optional().default(null),
  favorite: z.boolean().default(false),
  ocrText: optionalText(10000),
});
export type ContactInput = z.infer<typeof ContactInputSchema>;
/** Shape before defaults are applied (what clients may send). */
export type ContactInputRaw = z.input<typeof ContactInputSchema>;

export const ContactPatchSchema = ContactInputSchema.partial();
export type ContactPatch = z.infer<typeof ContactPatchSchema>;

export interface Contact extends ContactInput {
  id: string;
  hasFront: boolean;
  hasBack: boolean;
  createdAt: string;
  updatedAt: string;
}

export const emptyContact = (): ContactInput => ContactInputSchema.parse({});

export function displayName(c: Pick<ContactInput, 'firstName' | 'lastName' | 'company'>): string {
  const name = [c.firstName, c.lastName].filter(Boolean).join(' ').trim();
  return name || c.company || 'Senza nome';
}

export function initials(c: Pick<ContactInput, 'firstName' | 'lastName' | 'company'>): string {
  const parts = [c.firstName, c.lastName].filter(Boolean);
  const src = parts.length ? parts : (c.company || '?').split(/\s+/);
  return src
    .slice(0, 2)
    .map((p) => p.charAt(0).toUpperCase())
    .join('');
}

export const SORT_FIELDS = ['name', 'company', 'createdAt', 'metOn'] as const;
export type SortField = (typeof SORT_FIELDS)[number];

export const SearchQuerySchema = z.object({
  q: trimmed(200).optional(),
  name: trimmed(120).optional(),
  company: trimmed(200).optional(),
  jobTitle: trimmed(200).optional(),
  city: trimmed(120).optional(),
  tag: trimmed(40).optional(),
  metAt: trimmed(200).optional(),
  metFrom: IsoDate.optional(),
  metTo: IsoDate.optional(),
  favorite: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((v) => v === true || v === 'true')
    .optional(),
  sort: z.enum(SORT_FIELDS).default('name'),
  dir: z.enum(['asc', 'desc']).default('asc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
});
export type SearchQuery = z.infer<typeof SearchQuerySchema>;

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
