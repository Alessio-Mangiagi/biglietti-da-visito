import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/max';
import { detectNetwork, type Phone, type PhoneType, type Social, type Address } from '@cardvault/shared';
import { COUNTRIES, PROVINCES, STREET_WORDS } from './dictionaries';
import { letterCount, segments, titleCase } from './text';

/** A line under analysis. Extractors cut what they recognise out of `rest`. */
export interface WorkLine {
  index: number;
  text: string;
  rest: string;
  confidence: number; // 0..1
  height: number; // relative to the median line height (1 = median)
  used: Set<'email' | 'web' | 'social' | 'phone' | 'address' | 'fiscal'>;
}

export interface Found<T> {
  value: T;
  line: number;
  confidence: number;
}

function cut(line: WorkLine, fragment: string) {
  line.rest = line.rest.replace(fragment, ' ').replace(/\s+/g, ' ').trim();
}

// ------------------------------------------------------------------ e-mail

const EMAIL_RE = /[a-z0-9][a-z0-9._%+-]*@[a-z0-9-]+(?:[.,][a-z0-9-]+)*[.,][a-z]{2,}/gi;

export function extractEmails(lines: WorkLine[]): Found<string>[] {
  const out: Found<string>[] = [];
  for (const line of lines) {
    for (const m of line.rest.match(EMAIL_RE) ?? []) {
      const [local = '', domain = ''] = m.split('@');
      const email = `${local}@${domain.replace(/,/g, '.')}`.toLowerCase().replace(/\.+$/, '');
      if (!out.some((f) => f.value === email)) out.push({ value: email, line: line.index, confidence: line.confidence });
      cut(line, m);
      line.used.add('email');
    }
  }
  return out;
}

// ------------------------------------------------------------- web/social

const TLDS =
  'it|com|net|org|eu|info|biz|io|co|de|fr|es|ch|uk|us|app|dev|studio|design|cloud|online|shop|store|tech|global|group|me|tv|at|be|nl|pt|gr|mt|sm|edu|gov|ai';
const WEB_RE = new RegExp(
  `(?:https?:\\/\\/)?(?:www\\.)?[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\\.[a-z0-9-]+)*\\.(?:${TLDS})\\b(?:\\/[^\\s,;]*)?`,
  'gi',
);

export function extractWeb(lines: WorkLine[]): { website: Found<string> | null; socials: Found<Social>[] } {
  let website: Found<string> | null = null;
  const socials: Found<Social>[] = [];
  for (const line of lines) {
    for (const m of line.rest.match(WEB_RE) ?? []) {
      // skip abbreviations such as "S.p.A." / "v.le" that happen to end like a TLD
      if (!/\.[a-z]{2,}/i.test(m) || /^[a-z]\.[a-z]{2}$/i.test(m)) continue;
      const url = m.replace(/[.)]+$/, '');
      const network = detectNetwork(url);
      if (network) {
        socials.push({ value: { network, value: url }, line: line.index, confidence: line.confidence });
        line.used.add('social');
      } else if (!website) {
        website = { value: url, line: line.index, confidence: line.confidence };
        line.used.add('web');
      } else {
        socials.push({ value: { network: 'other', value: url }, line: line.index, confidence: line.confidence * 0.8 });
        line.used.add('web');
      }
      cut(line, m);
    }
  }
  return { website, socials };
}

// ------------------------------------------------------------------ phones

const FISCAL_RE =
  /\b(p\.?\s?iva|partita\s+iva|c\.?\s?f\.?|cod(?:ice)?\.?\s?fisc(?:ale)?|vat(?:\s?(?:no|n)\.?)?|r\.?e\.?a\.?|iban|cap(?:itale)?\.?\s?soc(?:iale)?\.?|reg(?:istro)?\.?\s?imp(?:rese)?\.?|c\.c\.i\.a\.a\.?|n\.\s?iscr)\b/i;
const FISCAL_VALUE_RE = new RegExp(
  `${FISCAL_RE.source}[\\s.:nN°]*(?:IT\\s?)?(?:€\\s?)?[A-Z0-9][A-Z0-9.,\\s/-]{4,}`,
  'gi',
);

const PHONE_CANDIDATE_RE = /(?:\+|00)?\(?\d[\d\s()./-]{4,}\d/g;
const LABELS: Array<[RegExp, PhoneType]> = [
  [/\b(fax|f)\.?\s*:?\s*$/i, 'fax'],
  [/\b(cell(?:ulare)?|cel|mob(?:ile)?|m|gsm|whatsapp|wa)\.?\s*:?\s*$/i, 'mobile'],
  [/\b(casa|home|ab(?:it)?\.?|h)\.?\s*:?\s*$/i, 'home'],
  [/\b(tel(?:efono)?|t|ph(?:one)?|uff(?:icio)?|office|o|centralino|direct|diretto|dir)\.?\s*:?\s*$/i, 'work'],
];
const LABEL_WORDS_RE =
  /\b(tel(?:efono)?|t|ph(?:one)?|fax|f|cell(?:ulare)?|cel|mob(?:ile)?|m|gsm|whatsapp|uff(?:icio)?|office|centralino|direct|diretto|e-?mail|mail|e|pec|web|w|sito|internet|int)\b\.?\s*:?/gi;

/** OCR often reads 0 as O and 1 as l/I inside digit runs. */
function fixDigits(s: string): string {
  return s
    .replace(/(?<=^|[\s:(+])[Oo](?=\d{2})/g, '0')
    .replace(/(?<=\d[\s.\-/]?)[Oo](?=[\s.\-/]?\d)/g, '0')
    .replace(/(?<=\d[\s.\-/]?)[lI|](?=[\s.\-/]?\d)/g, '1');
}

export function extractPhones(lines: WorkLine[], country: CountryCode): Found<Phone>[] {
  const out: Found<Phone>[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    // fiscal identifiers first, so they are never read as phones
    for (const m of line.rest.match(FISCAL_VALUE_RE) ?? []) {
      cut(line, m);
      line.used.add('fiscal');
    }
    if (FISCAL_RE.test(line.rest) && letterCount(line.rest) < 30) line.used.add('fiscal');

    for (const seg of segments(fixDigits(line.rest))) {
      for (const match of seg.matchAll(PHONE_CANDIDATE_RE)) {
        const raw = match[0].trim();
        const digits = raw.replace(/\D/g, '');
        if (digits.length < 6 || digits.length > 15) continue;
        const before = seg.slice(Math.max(0, (match.index ?? 0) - 16), match.index);
        if (FISCAL_RE.test(before)) continue;
        const parsed = parsePhoneNumberFromString(raw.replace(/^00/, '+'), country);
        if (!parsed || !parsed.isPossible()) continue;
        const label = LABELS.find(([re]) => re.test(before))?.[1];
        const intl = /^(\+|00)/.test(raw);
        if (!parsed.isValid() && !label && !intl) continue;
        if (seen.has(parsed.number)) continue;
        seen.add(parsed.number);
        const type: PhoneType = label ?? (parsed.getType() === 'MOBILE' ? 'mobile' : 'work');
        out.push({
          value: { type, value: parsed.formatInternational() },
          line: line.index,
          confidence: line.confidence * (parsed.isValid() ? 1 : 0.6),
        });
        line.rest = fixDigits(line.rest);
        cut(line, raw);
        line.used.add('phone');
      }
    }
  }
  for (const line of lines) {
    if (line.used.size) line.rest = line.rest.replace(LABEL_WORDS_RE, ' ').replace(/\s+/g, ' ').trim();
  }
  return out;
}

// ----------------------------------------------------------------- address

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const STREET_RE = new RegExp(
  `(?:^|[\\s:,-])(${STREET_WORDS.map(escapeRe).join('|')})(?=[\\s.,:]|$)`,
  'i',
);
/** German/Austrian/Swiss compounds: "Hauptstraße 14", "Bahnhofplatz 3". */
const COMPOUND_STREET_RE = /\p{L}+(?:straße|strasse|str\.|weg|platz|gasse|allee|ring)\s+\d/iu;
const isStreet = (s: string) => STREET_RE.test(` ${s}`) || COMPOUND_STREET_RE.test(s);

const CAP_RE =
  /\b(?:I-|IT-)?(\d{5})\s*[-,]?\s+((?:[\p{Lu}][\p{L}'.-]*|d'|di|del|della|sul|sull'|in|al)(?:\s+(?:[\p{Lu}][\p{L}'.-]*|d'|di|del|della|sul|sull'|in|al|sotto)){0,4})(?:\s*[-,]?\s*\(?\s*([A-Z]{2})\s*\)?(?![\p{L}]))?/u;
const COUNTRY_RE = new RegExp(`\\b(${Object.keys(COUNTRIES).map(escapeRe).join('|')})\\b\\.?`, 'i');
const ADDRESS_LABEL_RE = /^(sede(?:\s+(?:legale|operativa|amministrativa))?|uffici|office|address|indirizzo|hq)\s*:?\s*/i;

function cleanPart(s: string): string {
  return s
    .replace(ADDRESS_LABEL_RE, '')
    .replace(/^[\s,;:-]+|[\s,;:-]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractAddress(lines: WorkLine[]): Found<Address> | null {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const m = CAP_RE.exec(line.rest);
    if (!m) continue;
    const [whole, cap = '', cityRaw = '', provRaw] = m;
    let city = cityRaw.trim();
    let province = provRaw && PROVINCES.has(provRaw) ? provRaw : '';
    // "95128 CATANIA CT" — province glued as last word of the city
    const tail = city.split(/\s+/).pop() ?? '';
    if (!province && PROVINCES.has(tail) && city.includes(' ')) {
      province = tail;
      city = city.slice(0, -tail.length).trim();
    }
    const countryMatch = COUNTRY_RE.exec(city);
    city = city.replace(COUNTRY_RE, '').trim();
    if (letterCount(city) < 2) continue;
    if (city === city.toUpperCase()) city = titleCase(city);

    const before = cleanPart(line.rest.slice(0, m.index));
    const after = line.rest.slice(m.index + whole.length);
    let country = COUNTRIES[(countryMatch?.[1] ?? COUNTRY_RE.exec(after)?.[1] ?? '').toLowerCase()] ?? '';
    // country alone on the following line ("Germany")
    const next = lines[i + 1];
    if (!country && next) {
      const only = /^\s*([\p{L} ]+?)\.?\s*$/u.exec(next.rest)?.[1]?.toLowerCase();
      if (only && COUNTRIES[only]) {
        country = COUNTRIES[only]!;
        next.rest = '';
        next.used.add('address');
      }
    }

    let street = before;
    let confidence = line.confidence * 0.9;
    if (!street || !(isStreet(street) || /\d/.test(street))) {
      // street usually sits on the previous line
      const prev = lines[i - 1];
      if (prev && isStreet(prev.rest) && !prev.used.has('phone') && !prev.used.has('email')) {
        street = cleanPart(prev.rest);
        prev.rest = '';
        prev.used.add('address');
      } else if (street && letterCount(street) > 0 && !isStreet(street)) {
        confidence *= 0.6;
      }
    }
    line.rest = cleanPart(after.replace(COUNTRY_RE, ''));
    line.used.add('address');
    return {
      value: {
        street,
        city,
        postalCode: cap,
        province,
        country: country || (province ? 'Italia' : ''),
      },
      line: line.index,
      confidence,
    };
  }

  // no postal code: accept a line that clearly starts with a street word
  for (const line of lines) {
    if (line.used.size || !STREET_RE.test(` ${line.rest}`) || !/\d/.test(line.rest)) continue;
    const parts = line.rest.split(/\s*[,-]\s*/);
    const street = cleanPart(parts[0] ?? '');
    if (!street) continue;
    const countryMatch = COUNTRY_RE.exec(line.rest);
    const city = cleanPart(parts.slice(1).join(' ').replace(COUNTRY_RE, ''));
    line.rest = '';
    line.used.add('address');
    return {
      value: {
        street,
        city: letterCount(city) >= 2 ? city : '',
        postalCode: '',
        province: '',
        country: countryMatch ? (COUNTRIES[countryMatch[1]!.toLowerCase()] ?? '') : '',
      },
      line: line.index,
      confidence: line.confidence * 0.6,
    };
  }
  return null;
}
