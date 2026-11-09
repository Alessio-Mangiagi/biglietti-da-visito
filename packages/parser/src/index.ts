/**
 * Deterministic business-card parser: turns OCR lines into contact fields.
 * No network, no ML beyond the OCR engine itself — regexes, dictionaries and layout cues.
 */
import type { CountryCode } from 'libphonenumber-js';
import {
  ContactInputSchema,
  looksLikeVCard,
  parseMeCard,
  parseVCards,
  type ContactInput,
} from '@cardvault/shared';
import { extractAddress, extractEmails, extractPhones, extractWeb, type WorkLine } from './extractors';
import { pickEntities, type Candidate } from './entities';
import { letterCount, normalizeLine } from './text';

export { splitName } from './entities';
export { normalizeLine } from './text';

export interface OcrLine {
  text: string;
  /** Tesseract confidence 0..100. */
  confidence?: number;
  /** Bounding-box height in px; larger text hints at name/company. */
  height?: number;
}

export type ParsedField =
  | 'name'
  | 'company'
  | 'jobTitle'
  | 'emails'
  | 'phones'
  | 'website'
  | 'address'
  | 'socials';

export interface ParseResult {
  contact: ContactInput;
  /** 0..1 per detected field; the UI highlights fields under `LOW_CONFIDENCE`. */
  confidence: Partial<Record<ParsedField, number>>;
  /** Lines nobody claimed (slogans, services…), useful as notes. */
  leftovers: string[];
  source: 'ocr' | 'qr';
}

export const LOW_CONFIDENCE = 0.6;

export interface ParseOptions {
  defaultCountry?: CountryCode;
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function toLines(input: string | OcrLine[]): OcrLine[] {
  if (typeof input === 'string') return input.split(/\r?\n/).map((text) => ({ text }));
  return input.flatMap((l) => l.text.split(/\r?\n/).map((text) => ({ ...l, text })));
}

/** Drops OCR garbage such as "| ~ —" or isolated symbols from logos. */
function isNoise(text: string): boolean {
  const letters = letterCount(text);
  const meaningful = (text.match(/[\p{L}\d@]/gu) ?? []).length;
  const digits = (text.match(/\d/g) ?? []).length;
  return meaningful < 2 || meaningful / text.replace(/\s/g, '').length < 0.5 || (letters <= 1 && digits < 5);
}

export function parseCard(input: string | OcrLine[], opts: ParseOptions = {}): ParseResult {
  const country = opts.defaultCountry ?? 'IT';
  const raw = toLines(input);
  const normalized = raw
    .map((l) => ({ ...l, text: normalizeLine(l.text) }))
    .filter((l) => l.text && !isNoise(l.text));
  const medH = median(normalized.map((l) => l.height ?? 0).filter((h) => h > 0));

  const lines: WorkLine[] = normalized.map((l, index) => ({
    index,
    text: l.text,
    rest: l.text,
    confidence: l.confidence != null ? Math.max(0, Math.min(1, l.confidence / 100)) : 0.9,
    height: medH && l.height ? l.height / medH : 1,
    used: new Set(),
  }));

  const emails = extractEmails(lines);
  const { website, socials } = extractWeb(lines);
  const phones = extractPhones(lines, country);
  const address = extractAddress(lines);

  // what is left: candidates for name / company / title. " - " or "," split "Mario Rossi - CEO".
  const candidates: Candidate[] = [];
  for (const line of lines) {
    if (line.used.has('fiscal')) continue;
    const text = line.rest.replace(/^[\s,;:.-]+|[\s,;:-]+$/g, '').trim();
    if (letterCount(text) < 2) continue;
    const parts = text.split(/\s+[-–]\s+|\s*[|•·▪●■◆]\s*|,\s+(?=\p{Lu})/u).filter((p) => letterCount(p) >= 2);
    for (const p of parts.length ? parts : [text])
      candidates.push({ text: p.trim(), line: line.index, confidence: line.confidence, height: line.height });
  }

  const entities = pickEntities(candidates, {
    emails: emails.map((e) => e.value),
    website: website?.value ?? '',
  });

  const contact = ContactInputSchema.parse({
    prefix: entities.name?.prefix ?? '',
    firstName: entities.name?.firstName ?? '',
    lastName: entities.name?.lastName ?? '',
    company: entities.company?.value ?? '',
    jobTitle: entities.jobTitle?.value ?? '',
    emails: emails.map((e) => e.value).filter((e) => /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(e)),
    phones: phones.map((p) => p.value),
    website: website?.value ?? '',
    address: address?.value,
    socials: socials.map((s) => s.value),
    ocrText: raw.map((l) => l.text).join('\n').trim(),
  });

  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined);
  const confidence: ParseResult['confidence'] = {};
  const set = (k: ParsedField, v: number | undefined) => {
    if (v != null) confidence[k] = Math.round(v * 100) / 100;
  };
  set('name', entities.name?.confidence);
  set('company', entities.company?.confidence);
  set('jobTitle', entities.jobTitle?.confidence);
  set('emails', avg(emails.map((e) => e.confidence)));
  set('phones', avg(phones.map((p) => p.confidence)));
  set('website', website?.confidence);
  set('address', address?.confidence);
  set('socials', avg(socials.map((s) => s.confidence)));

  return { contact, confidence, leftovers: entities.leftovers, source: 'ocr' };
}

/** QR payloads (vCard / MECARD) are exact: confidence 1 for every field present. */
export function parseQrPayload(payload: string): ParseResult | null {
  const raw = looksLikeVCard(payload) ? parseVCards(payload)[0] : parseMeCard(payload);
  if (!raw) return null;
  const parsed = ContactInputSchema.safeParse(raw);
  if (!parsed.success) return null;
  const c = parsed.data;
  const confidence: ParseResult['confidence'] = {};
  if (c.firstName || c.lastName) confidence.name = 1;
  if (c.company) confidence.company = 1;
  if (c.jobTitle) confidence.jobTitle = 1;
  if (c.emails.length) confidence.emails = 1;
  if (c.phones.length) confidence.phones = 1;
  if (c.website) confidence.website = 1;
  if (c.address.street || c.address.city) confidence.address = 1;
  return { contact: c, confidence, leftovers: [], source: 'qr' };
}

/** Fills empty fields of `base` with values from `extra` (e.g. back side of the card). */
export function mergeParsed(base: ParseResult, extra: ParseResult): ParseResult {
  const a = base.contact;
  const b = extra.contact;
  const uniq = <T>(xs: T[], key: (x: T) => string) => xs.filter((x, i) => xs.findIndex((y) => key(y) === key(x)) === i);
  const contact: ContactInput = {
    ...a,
    prefix: a.prefix || b.prefix,
    firstName: a.firstName || b.firstName,
    lastName: a.lastName || b.lastName,
    company: a.company || b.company,
    jobTitle: a.jobTitle || b.jobTitle,
    emails: uniq([...a.emails, ...b.emails], (x) => x),
    phones: uniq([...a.phones, ...b.phones], (p) => p.value.replace(/\D/g, '')),
    website: a.website || b.website,
    address: a.address.street || a.address.city ? a.address : b.address,
    socials: uniq([...a.socials, ...b.socials], (s) => s.value),
    ocrText: [a.ocrText, b.ocrText].filter(Boolean).join('\n---\n'),
  };
  const confidence = { ...extra.confidence, ...base.confidence };
  if (!(a.firstName || a.lastName) && extra.confidence.name != null) confidence.name = extra.confidence.name;
  if (!a.company && extra.confidence.company != null) confidence.company = extra.confidence.company;
  if (!a.jobTitle && extra.confidence.jobTitle != null) confidence.jobTitle = extra.confidence.jobTitle;
  return { contact, confidence, leftovers: [...base.leftovers, ...extra.leftovers], source: base.source };
}
