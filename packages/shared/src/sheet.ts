import { ContactInputSchema, type ContactInput, type ContactInputRaw, type PhoneType } from './contact';
import { CSV_HEADERS } from './csv';
import { detectNetwork } from './social';

/**
 * Spreadsheet import ("Importa da Excel"). The template columns are the CSV export
 * columns, so an exported file can be edited and imported back.
 */
export const SHEET_KEYS = [
  'prefix',
  'firstName',
  'lastName',
  'company',
  'jobTitle',
  'emails',
  'mobile',
  'work',
  'home',
  'fax',
  'other',
  'website',
  'street',
  'city',
  'postalCode',
  'province',
  'country',
  'socials',
  'tags',
  'metAt',
  'metOn',
  'favorite',
  'notes',
] as const;
export type SheetKey = (typeof SHEET_KEYS)[number];
export type SheetRecord = Partial<Record<SheetKey, string>>;

/** Column labels in template order, same as the CSV export. */
export const SHEET_LABELS = Object.fromEntries(SHEET_KEYS.map((k, i) => [k, CSV_HEADERS[i]!])) as Record<SheetKey, string>;

export const MAX_SHEET_ROWS = 2000;

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');

/** Header spellings people actually use, Italian and English. */
const ALIASES: Record<SheetKey, string[]> = {
  prefix: ['titolo', 'prefisso', 'title', 'prefix', 'appellativo'],
  firstName: ['nome', 'firstname', 'first', 'givenname', 'name'],
  lastName: ['cognome', 'lastname', 'last', 'surname', 'familyname'],
  company: ['azienda', 'societa', 'ditta', 'impresa', 'ragionesociale', 'company', 'organization', 'organizzazione', 'ente'],
  jobTitle: ['ruolo', 'qualifica', 'posizione', 'carica', 'mansione', 'jobtitle', 'job', 'role', 'position'],
  emails: ['email', 'emails', 'mail', 'posta', 'postaelettronica', 'indirizzoemail', 'pec'],
  mobile: ['cellulare', 'cell', 'mobile', 'cellular', 'telefonocellulare', 'mobilephone'],
  work: ['telefonoufficio', 'telefono', 'tel', 'phone', 'ufficio', 'telefonofisso', 'fisso', 'workphone', 'telephone'],
  home: ['telefonocasa', 'casa', 'homephone'],
  fax: ['fax'],
  other: ['altrotelefono', 'altro', 'otherphone'],
  website: ['sitoweb', 'sito', 'web', 'website', 'url', 'internet'],
  street: ['via', 'indirizzo', 'street', 'address', 'sede'],
  city: ['citta', 'comune', 'localita', 'city', 'town'],
  postalCode: ['cap', 'codicepostale', 'postalcode', 'zip', 'zipcode'],
  province: ['provincia', 'prov', 'pr', 'regione', 'province', 'state'],
  country: ['nazione', 'paese', 'stato', 'country'],
  socials: ['social', 'socials', 'linkedin', 'profilo'],
  tags: ['tag', 'tags', 'etichette', 'categoria', 'categorie', 'gruppo'],
  metAt: ['luogoevento', 'evento', 'luogo', 'event', 'conosciutoa', 'fiera'],
  metOn: ['dataincontro', 'data', 'date', 'conosciutoil', 'quando'],
  favorite: ['preferito', 'preferiti', 'favorite', 'favourite', 'stella'],
  notes: ['note', 'notes', 'appunti', 'commenti', 'commento', 'osservazioni'],
};
const BY_ALIAS = new Map<string, SheetKey>();
for (const k of SHEET_KEYS) for (const a of [norm(SHEET_LABELS[k]), ...ALIASES[k]]) if (!BY_ALIAS.has(a)) BY_ALIAS.set(a, k);

export function headerKey(label: string): SheetKey | null {
  return BY_ALIAS.get(norm(label)) ?? null;
}

/** A row of column names: at least two cells are known headers. */
export function isHeaderRow(cells: string[]): boolean {
  return cells.filter((c) => c.trim() && headerKey(c)).length >= 2;
}

export interface SheetTable {
  records: SheetRecord[];
  /** Columns that were recognised, in file order. */
  columns: SheetKey[];
  /** Header labels that matched nothing (their data is ignored). */
  ignored: string[];
  /** True when the first row was not a header and template order was assumed. */
  assumedOrder: boolean;
  truncated: boolean;
}

/**
 * Turns raw rows (from .xlsx, CSV or a paste) into records. The first row is taken as
 * the header when at least two cells are known column names; otherwise the template
 * order is assumed — handy when pasting cells copied from the filled-in template.
 */
export function rowsToRecords(rows: string[][]): SheetTable {
  const clean = rows.map((r) => r.map((v) => String(v ?? '').trim())).filter((r) => r.some(Boolean));
  if (!clean.length) return { records: [], columns: [], ignored: [], assumedOrder: false, truncated: false };
  const head = clean[0]!.map((h) => (h ? headerKey(h) : null));
  const assumedOrder = !isHeaderRow(clean[0]!);
  let keys: Array<SheetKey | null>;
  const ignored: string[] = [];
  if (assumedOrder) {
    keys = SHEET_KEYS.slice();
  } else {
    const seen = new Set<SheetKey>();
    keys = head.map((k, i) => {
      if (!k) {
        if (clean[0]![i]) ignored.push(clean[0]![i]!);
        return null;
      }
      if (seen.has(k)) return k; // a repeated column (two "Email" columns) is appended to the first
      seen.add(k);
      return k;
    });
  }
  const body = assumedOrder ? clean : clean.slice(1);
  const truncated = body.length > MAX_SHEET_ROWS;
  const records = body.slice(0, MAX_SHEET_ROWS).map((r) => {
    const rec: SheetRecord = {};
    r.forEach((v, i) => {
      const k = keys[i];
      if (!k || !v) return;
      rec[k] = rec[k] ? `${rec[k]} | ${v}` : v;
    });
    return rec;
  });
  const columns = [...new Set(keys.filter((k): k is SheetKey => !!k))];
  return { records: records.filter((r) => Object.keys(r).length), columns, ignored, assumedOrder, truncated };
}

/** Undoes the export's formula guard ("'=…" → "=…" is NOT restored: only "'+39…" style). */
const unguard = (v: string) => (/^'[+-]?[\d\s().+-]+$/.test(v) ? v.slice(1) : v);

const split = (v: string | undefined, re: RegExp) =>
  (v ?? '')
    .split(re)
    .map((s) => unguard(s.trim()))
    .filter(Boolean);

/** Excel day serial (1900 system) → YYYY-MM-DD. */
export function excelSerialToIso(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 2958465) return null;
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  return new Date(ms).toISOString().slice(0, 10);
}

/** "10/11/2026", "10-11-26", "2026-11-10", "10.11.2026" or an Excel serial → YYYY-MM-DD. */
export function parseSheetDate(v: string): string | null {
  const s = v.trim();
  if (!s) return null;
  let y: number, m: number, d: number;
  let r = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T].*)?$/.exec(s);
  if (r) [y, m, d] = [+r[1]!, +r[2]!, +r[3]!];
  else if ((r = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})(?:\s.*)?$/.exec(s))) {
    [d, m, y] = [+r[1]!, +r[2]!, +r[3]!];
    if (y < 100) y += 2000;
  } else if (/^\d{4,6}(\.\d+)?$/.test(s)) return excelSerialToIso(Number(s));
  else return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

const YES = new Set(['si', 'sì', 'yes', 'y', 'x', '1', 'true', 'vero', '*', '★']);
const PHONE_KEYS: PhoneType[] = ['mobile', 'work', 'home', 'fax', 'other'];

export interface SheetRowResult {
  contact: ContactInputRaw;
  /** First problem found, in Italian; null when the row can be imported. */
  error: string | null;
}

/** One spreadsheet row → contact payload, validated with the same schema as the API. */
export function recordToContact(rec: SheetRecord): SheetRowResult {
  const metOnRaw = rec.metOn?.trim() ?? '';
  const metOn = metOnRaw ? parseSheetDate(metOnRaw) : null;
  const contact: ContactInputRaw = {
    prefix: rec.prefix ?? '',
    firstName: rec.firstName ?? '',
    lastName: rec.lastName ?? '',
    company: rec.company ?? '',
    jobTitle: rec.jobTitle ?? '',
    emails: split(rec.emails, /[\s|,;]+/).map((e) => e.replace(/^mailto:/i, '')),
    phones: PHONE_KEYS.flatMap((type) => split(rec[type], /\s*[|;]\s*|\n/).map((value) => ({ type, value }))),
    website: rec.website ?? '',
    address: {
      street: rec.street ?? '',
      city: rec.city ?? '',
      postalCode: rec.postalCode ?? '',
      province: rec.province ?? '',
      country: rec.country ?? '',
    },
    socials: split(rec.socials, /[\s|,;]+/).map((value) => ({ network: detectNetwork(value) ?? 'other', value })),
    tags: [...new Set(split(rec.tags, /\s*[,;|]\s*/))],
    metAt: rec.metAt ?? '',
    metOn,
    favorite: YES.has((rec.favorite ?? '').trim().toLowerCase()),
    notes: rec.notes ?? '',
  };
  if (!contact.firstName && !contact.lastName && !contact.company) return { contact, error: 'Manca nome, cognome o azienda' };
  if (metOnRaw && !metOn) return { contact, error: `Data incontro non valida: «${metOnRaw}» (usa GG/MM/AAAA)` };
  const parsed = ContactInputSchema.safeParse(contact);
  if (!parsed.success) return { contact, error: describeIssue(parsed.error.issues[0]) };
  return { contact, error: null };
}

const FIELD_LABELS: Record<string, string> = {
  emails: 'Email non valida',
  phones: 'Telefono non valido',
  socials: 'Social non valido',
  tags: 'Tag non valido',
};

function describeIssue(issue: { path: PropertyKey[]; message: string } | undefined): string {
  if (!issue) return 'Riga non valida';
  const top = String(issue.path[0] ?? '');
  if (FIELD_LABELS[top]) return FIELD_LABELS[top]!;
  if (top === 'address') {
    const k = String(issue.path[1] ?? '') as SheetKey;
    return `${SHEET_LABELS[k] ?? 'Indirizzo'} troppo lungo`;
  }
  const label = SHEET_LABELS[top as SheetKey];
  return label ? `${label}: troppo lungo` : issue.message;
}

/** Contact → record, for showing a contact in the sheet (template order). */
export function contactToRecord(c: ContactInput): SheetRecord {
  const phonesOf = (t: PhoneType) =>
    c.phones
      .filter((p) => p.type === t)
      .map((p) => p.value)
      .join(' | ');
  return {
    prefix: c.prefix,
    firstName: c.firstName,
    lastName: c.lastName,
    company: c.company,
    jobTitle: c.jobTitle,
    emails: c.emails.join(' | '),
    mobile: phonesOf('mobile'),
    work: phonesOf('work'),
    home: phonesOf('home'),
    fax: phonesOf('fax'),
    other: phonesOf('other'),
    website: c.website,
    street: c.address.street,
    city: c.address.city,
    postalCode: c.address.postalCode,
    province: c.address.province,
    country: c.address.country,
    socials: c.socials.map((s) => s.value).join(' | '),
    tags: c.tags.join(', '),
    metAt: c.metAt,
    metOn: c.metOn ?? '',
    favorite: c.favorite ? 'sì' : '',
    notes: c.notes,
  };
}

/** Delimited text (CSV with ";" or ",", or tab-separated cells pasted from Excel). */
export function parseDelimited(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, '');
  const firstLine = src.slice(0, src.search(/\r?\n|$/));
  const count = (ch: string) => firstLine.split(ch).length - 1;
  const sep = count('\t') ? '\t' : count(';') >= count(',') && count(';') ? ';' : count(',') ? ',' : '\t';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === sep) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
