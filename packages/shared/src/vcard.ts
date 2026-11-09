/**
 * vCard 2.1 / 3.0 / 4.0 (RFC 2426, RFC 6350) reader and 3.0 / 4.0 writer.
 *
 * Written in-house rather than via `vcard4` because imports come mostly from phones that
 * still emit 2.1/3.0 (quoted-printable, bare TYPE params, item groups), which vcard4 rejects.
 */
import type { ContactInput, ContactInputRaw, Phone, PhoneType, Social } from './contact';
import { detectNetwork } from './social';

export type VCardVersion = '3.0' | '4.0';

export interface VCardExtra {
  uid?: string;
  rev?: string;
  /** base64 JPEG embedded as PHOTO (front of the card). */
  photoJpegBase64?: string;
}

// ---------------------------------------------------------------- writing

function escapeText(v: string): string {
  return v
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

const encoder = new TextEncoder();

/** Folds a content line at 75 octets without splitting UTF-8 sequences. */
export function foldLine(line: string): string {
  if (encoder.encode(line).length <= 75) return line;
  const out: string[] = [];
  let current = '';
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const len = encoder.encode(ch).length;
    if (bytes + len > limit) {
      out.push(current);
      current = '';
      bytes = 0;
      limit = 74; // continuation lines start with a space
    }
    current += ch;
    bytes += len;
  }
  out.push(current);
  return out.join('\r\n ');
}

const PHONE_TYPE_V3: Record<PhoneType, string> = {
  mobile: 'CELL,VOICE',
  work: 'WORK,VOICE',
  home: 'HOME,VOICE',
  fax: 'FAX',
  other: 'VOICE',
};
const PHONE_TYPE_V4: Record<PhoneType, string> = {
  mobile: 'cell,voice',
  work: 'work,voice',
  home: 'home,voice',
  fax: 'fax',
  other: 'voice',
};

export function toVCard(c: ContactInput, version: VCardVersion = '4.0', extra: VCardExtra = {}): string {
  const v4 = version === '4.0';
  const lines: string[] = ['BEGIN:VCARD', `VERSION:${version}`];
  const push = (l: string) => lines.push(foldLine(l));

  const fn =
    [c.prefix, c.firstName, c.lastName].filter(Boolean).join(' ').trim() || c.company || 'Senza nome';
  push(`FN:${escapeText(fn)}`);
  push(`N:${[c.lastName, c.firstName, '', c.prefix, ''].map(escapeText).join(';')}`);
  if (c.company) push(`ORG:${escapeText(c.company)}`);
  if (c.jobTitle) push(`TITLE:${escapeText(c.jobTitle)}`);
  for (const e of c.emails) push(`EMAIL;TYPE=${v4 ? 'work' : 'INTERNET,WORK'}:${escapeText(e)}`);
  for (const p of c.phones)
    push(`TEL;TYPE=${(v4 ? PHONE_TYPE_V4 : PHONE_TYPE_V3)[p.type]}:${escapeText(p.value)}`);
  const a = c.address;
  if (a && (a.street || a.city || a.postalCode || a.province || a.country)) {
    const parts = ['', '', a.street, a.city, a.province, a.postalCode, a.country].map(escapeText);
    push(`ADR;TYPE=${v4 ? 'work' : 'WORK'}:${parts.join(';')}`);
  }
  if (c.website) push(`URL:${c.website}`);
  for (const s of c.socials) {
    if (s.network === 'other') push(`URL:${s.value}`);
    else push(`X-SOCIALPROFILE;TYPE=${s.network}:${s.value}`);
  }
  if (c.tags.length) push(`CATEGORIES:${c.tags.map(escapeText).join(',')}`);
  const note = c.notes;
  if (note) push(`NOTE:${escapeText(note)}`);
  if (c.metAt) push(`X-CARDVAULT-MET-AT:${escapeText(c.metAt)}`);
  if (c.metOn) push(`X-CARDVAULT-MET-ON:${c.metOn}`);
  if (extra.photoJpegBase64) {
    push(
      v4
        ? `PHOTO:data:image/jpeg;base64,${extra.photoJpegBase64}`
        : `PHOTO;ENCODING=b;TYPE=JPEG:${extra.photoJpegBase64}`,
    );
  }
  if (extra.uid) push(`UID:${v4 ? `urn:uuid:${extra.uid}` : extra.uid}`);
  if (extra.rev) push(`REV:${extra.rev}`);
  lines.push('END:VCARD');
  return lines.join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------- reading

interface Property {
  name: string;
  params: Record<string, string[]>;
  value: string;
}

function decodeQuotedPrintable(input: string, charset = 'utf-8'): string {
  const bytes: number[] = [];
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (ch === '=' && /^[0-9A-Fa-f]{2}$/.test(input.slice(i + 1, i + 3))) {
      bytes.push(parseInt(input.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      for (const b of encoder.encode(ch)) bytes.push(b);
    }
  }
  try {
    return new TextDecoder(charset).decode(new Uint8Array(bytes));
  } catch {
    return new TextDecoder('utf-8').decode(new Uint8Array(bytes));
  }
}

/** Splits on `sep` unless the separator is backslash-escaped. */
function splitEscaped(value: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]!;
    if (ch === '\\' && i + 1 < value.length) {
      cur += ch + value[i + 1];
      i++;
    } else if (ch === sep) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function unescapeText(v: string): string {
  return v.replace(/\\([\\,;nN])/g, (_, c: string) => (c === 'n' || c === 'N' ? '\n' : c));
}

function parseLine(line: string): Property | null {
  // find the first ':' outside double quotes
  let inQuotes = false;
  let idx = -1;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === ':' && !inQuotes) {
      idx = i;
      break;
    }
  }
  if (idx < 0) return null;
  const head = line.slice(0, idx);
  const value = line.slice(idx + 1);
  const [rawName = '', ...rawParams] = head.split(';');
  const name = rawName.replace(/^[^.]*\./, '').toUpperCase(); // strip "item1." groups
  const params: Record<string, string[]> = {};
  for (const p of rawParams) {
    const eq = p.indexOf('=');
    const key = (eq < 0 ? 'TYPE' : p.slice(0, eq)).toUpperCase();
    const vals = (eq < 0 ? p : p.slice(eq + 1))
      .split(',')
      .map((s) => s.replace(/^"|"$/g, '').trim())
      .filter(Boolean);
    (params[key] ??= []).push(...vals);
  }
  return { name, params, value };
}

function phoneType(types: string[]): PhoneType {
  const t = types.map((x) => x.toLowerCase());
  if (t.includes('fax')) return 'fax';
  if (t.includes('cell') || t.includes('mobile') || t.includes('iphone')) return 'mobile';
  if (t.includes('home')) return 'home';
  if (t.includes('work')) return 'work';
  return 'other';
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cardToContact(props: Property[]): ContactInputRaw {
  const c: ContactInputRaw = {
    emails: [],
    phones: [],
    socials: [],
    tags: [],
  };
  const phones: Phone[] = [];
  const socials: Social[] = [];
  const emails: string[] = [];
  const tags: string[] = [];
  const notes: string[] = [];
  let fn = '';

  for (const p of props) {
    let value = p.value;
    const enc = p.params.ENCODING?.[0]?.toUpperCase();
    if (enc === 'QUOTED-PRINTABLE') value = decodeQuotedPrintable(value, p.params.CHARSET?.[0]);
    const types = p.params.TYPE ?? [];

    switch (p.name) {
      case 'N': {
        const [last = '', first = '', additional = '', prefix = ''] = splitEscaped(value, ';').map(
          unescapeText,
        );
        c.lastName = last.trim();
        c.firstName = [first, additional].filter(Boolean).join(' ').trim();
        c.prefix = prefix.trim();
        break;
      }
      case 'FN':
        fn = unescapeText(value).trim();
        break;
      case 'ORG':
        c.company = splitEscaped(value, ';').map(unescapeText).filter(Boolean).join(' - ').trim();
        break;
      case 'TITLE':
        c.jobTitle = unescapeText(value).trim();
        break;
      case 'ROLE':
        if (!c.jobTitle) c.jobTitle = unescapeText(value).trim();
        break;
      case 'EMAIL': {
        const e = unescapeText(value).replace(/^mailto:/i, '').trim().toLowerCase();
        if (EMAIL_RE.test(e) && !emails.includes(e)) emails.push(e);
        break;
      }
      case 'TEL': {
        const v = unescapeText(value).replace(/^tel:/i, '').trim();
        if (v.replace(/\D/g, '').length >= 3) phones.push({ type: phoneType(types), value: v });
        break;
      }
      case 'ADR': {
        if (c.address) break;
        const [, , street = '', city = '', province = '', postalCode = '', country = ''] =
          splitEscaped(value, ';').map((s) => unescapeText(s).replace(/\n/g, ', ').trim());
        c.address = { street, city, province, postalCode, country };
        break;
      }
      case 'URL': {
        const url = unescapeText(value).trim();
        const net = detectNetwork(url);
        if (net) socials.push({ network: net, value: url });
        else if (!c.website) c.website = url;
        else socials.push({ network: 'other', value: url });
        break;
      }
      case 'X-SOCIALPROFILE': {
        const url = unescapeText(value).trim();
        const declared = types[0]?.toLowerCase();
        const net =
          detectNetwork(url) ??
          (declared === 'twitter' ? 'x' : (declared as Social['network'] | undefined));
        const allowed = ['linkedin', 'instagram', 'facebook', 'x', 'youtube', 'github', 'tiktok'];
        socials.push({ network: net && allowed.includes(net) ? net : 'other', value: url });
        break;
      }
      case 'CATEGORIES':
        for (const t of splitEscaped(value, ',').map(unescapeText)) {
          const tag = t.trim();
          if (tag && !tags.includes(tag)) tags.push(tag);
        }
        break;
      case 'NOTE':
        notes.push(unescapeText(value).trim());
        break;
      case 'X-CARDVAULT-MET-AT':
        c.metAt = unescapeText(value).trim();
        break;
      case 'X-CARDVAULT-MET-ON':
        if (/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) c.metOn = value.trim();
        break;
    }
  }

  if (!c.firstName && !c.lastName && fn) {
    const words = fn.split(/\s+/);
    c.lastName = words.length > 1 ? words.pop() : '';
    c.firstName = words.join(' ');
  }
  c.emails = emails;
  c.phones = phones;
  c.socials = socials;
  c.tags = tags;
  if (notes.length) c.notes = notes.join('\n\n');
  return c;
}

/** Parses one or more vCards. Unknown properties are ignored. */
export function parseVCards(text: string): ContactInputRaw[] {
  const normalized = text.replace(/\r\n?/g, '\n');
  // quoted-printable soft breaks ("=" at end of line) and RFC folding (leading space/tab)
  const rawLines = normalized.split('\n');
  const lines: string[] = [];
  for (const raw of rawLines) {
    const prev = lines.length - 1;
    if (/^[ \t]/.test(raw) && prev >= 0) {
      lines[prev] += raw.slice(1);
    } else if (prev >= 0 && /ENCODING=QUOTED-PRINTABLE/i.test(lines[prev]!) && lines[prev]!.endsWith('=')) {
      lines[prev] = lines[prev]!.slice(0, -1) + raw;
    } else {
      lines.push(raw);
    }
  }

  const cards: ContactInputRaw[] = [];
  let current: Property[] | null = null;
  for (const line of lines) {
    if (!line.trim()) continue;
    const upper = line.trim().toUpperCase();
    if (upper === 'BEGIN:VCARD') current = [];
    else if (upper === 'END:VCARD') {
      if (current) cards.push(cardToContact(current));
      current = null;
    } else if (current) {
      const prop = parseLine(line);
      if (prop) current.push(prop);
    }
  }
  return cards;
}

/** Cheap check used by the QR scanner before handing text to `parseVCards`. */
export function looksLikeVCard(text: string): boolean {
  return /BEGIN:VCARD/i.test(text) && /END:VCARD/i.test(text);
}

/** MECARD:N:Rossi,Mario;TEL:...;EMAIL:...;; — common in Japanese/Android QR generators. */
export function parseMeCard(text: string): ContactInputRaw | null {
  if (!/^MECARD:/i.test(text)) return null;
  const body = text.replace(/^MECARD:/i, '');
  const c: ContactInputRaw = { emails: [], phones: [], socials: [] };
  const phones: Phone[] = [];
  const emails: string[] = [];
  for (const field of splitEscaped(body, ';')) {
    const i = field.indexOf(':');
    if (i < 0) continue;
    const key = field.slice(0, i).toUpperCase();
    const val = unescapeText(field.slice(i + 1)).trim();
    if (!val) continue;
    if (key === 'N') {
      const [last = '', first = ''] = val.split(',');
      c.lastName = last.trim();
      c.firstName = first.trim();
    } else if (key === 'TEL') phones.push({ type: 'work', value: val });
    else if (key === 'EMAIL' && EMAIL_RE.test(val)) emails.push(val.toLowerCase());
    else if (key === 'URL') c.website = val;
    else if (key === 'ORG') c.company = val;
    else if (key === 'NOTE') c.notes = val;
    else if (key === 'ADR') c.address = { street: val, city: '', postalCode: '', province: '', country: '' };
  }
  c.phones = phones;
  c.emails = emails;
  return c;
}
