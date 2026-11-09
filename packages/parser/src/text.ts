/** Text helpers shared by the extractors. */

export function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Lower-case, no accents, letters/digits only — for fuzzy comparisons. */
export function squash(s: string): string {
  return stripAccents(s)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

export function letterCount(s: string): number {
  return (s.match(/\p{L}/gu) ?? []).length;
}

export function digitCount(s: string): number {
  return (s.match(/\d/g) ?? []).length;
}

export function words(s: string): string[] {
  return s.split(/\s+/).filter(Boolean);
}

export function isAllCaps(s: string): boolean {
  const letters = s.match(/\p{L}/gu) ?? [];
  return letters.length >= 2 && letters.every((c) => c === c.toUpperCase() && c !== c.toLowerCase());
}

/** "MARIO DE LUCA" → "Mario De Luca", "d'ANGELO" → "D'Angelo". */
export function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/(^|[\s'’-])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase());
}

/**
 * Normalises one OCR line: unifies quotes/dashes, repairs common OCR slips around
 * e-mail and web addresses, collapses whitespace.
 */
export function normalizeLine(raw: string): string {
  let s = raw
    .replace(/[‘’´`]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—−]/g, '-')
    .replace(/[ \t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // e-mail '@' read as ©/®/(at)/[at]
  s = s.replace(/\s?(?:\(at\)|\[at\]|[©®])\s?/gi, '@');
  // spaces around @ and before TLD: "mario . rossi @ acme . it"
  s = s.replace(/(\S)\s*@\s*(\S)/g, '$1@$2');
  s = s.replace(/\b(www)\s*[.,]\s*/gi, '$1.');
  s = s.replace(/([a-z0-9])\s?[.,]\s?(com|it|net|org|eu|info|biz|io)\b/gi, (m, a: string, tld: string, offset: number, all: string) => {
    // only glue when the left side looks like a host (has @ or www. before it on the token)
    const before = all.slice(0, offset + 1);
    const token = before.split(/\s/).pop() ?? '';
    return /@|www\./i.test(token) ? `${a}.${tld}` : m;
  });
  return s;
}

/** Characters that separate independent items on one printed line. */
export const SEGMENT_SPLIT = /\s*[|•·▪●■◆]\s*/;

export function segments(line: string): string[] {
  return line
    .split(SEGMENT_SPLIT)
    .map((s) => s.trim())
    .filter(Boolean);
}
