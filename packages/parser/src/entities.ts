import {
  COMPANY_SUFFIXES,
  COMPANY_WORDS,
  FIRST_NAMES,
  GENERIC_MAIL_DOMAINS,
  HONORIFICS,
  JOB_WORDS,
  SURNAME_PARTICLES,
} from './dictionaries';
import { digitCount, isAllCaps, letterCount, squash, stripAccents, titleCase, words } from './text';

export interface Candidate {
  text: string;
  line: number;
  confidence: number;
  height: number;
}

export interface Hints {
  emails: string[];
  website: string;
}

const lowerWords = (s: string) =>
  stripAccents(s.toLowerCase())
    .split(/[\s,/()]+/)
    .filter(Boolean);

const JOB_SET = new Set(JOB_WORDS.filter((w) => !w.includes(' ')).map((w) => stripAccents(w)));
const JOB_PHRASES = JOB_WORDS.filter((w) => w.includes(' ')).map((w) => stripAccents(w));
const COMPANY_WORD_SET = new Set(COMPANY_WORDS.filter((w) => !w.includes(' ')).map((w) => stripAccents(w)));
const COMPANY_PHRASES = COMPANY_WORDS.filter((w) => w.includes(' ')).map((w) => stripAccents(w));
const HONORIFIC_SET = new Set(HONORIFICS);

/** Words that alone identify an organisation. */
const STRONG_COMPANY_WORDS = new Set([
  'universita', 'university', 'politecnico', 'comune', 'regione', 'ministero', 'ospedale',
  'consorzio', 'cooperativa', 'fondazione', 'gruppo', 'group', 'associati', 'societa', 'azienda',
  'pasticceria', 'farmacia', 'ristorante', 'hotel', 'banca', 'agenzia', 'termoidraulica',
]);

function hasLegalSuffix(text: string): boolean {
  const t = ` ${text.toLowerCase().replace(/\s+/g, ' ')} `;
  return COMPANY_SUFFIXES.some((suf) => {
    const re = new RegExp(`[\\s,]${suf.replace(/[.*+?^${}()|[\]\\&]/g, '\\$&')}(?=[\\s,.]|$)`, 'i');
    return re.test(t);
  });
}

/** Words that hint at a role only together with others ("Area Tecnica", "Senior"). */
const WEAK_JOB_WORDS = new Set([
  'area', 'tecnica', 'tecnico', 'ufficio', 'senior', 'junior', 'lead', 'regional', 'country', 'business',
  'development', 'key', 'customer', 'service', 'support', 'product', 'member', 'membro', 'board', 'cantiere',
  'vice', 'export', 'import', 'gestione', 'controllo', 'project', 'operations', 'risorse', 'quadro',
]);

function jobScore(text: string): number {
  const lw = lowerWords(text);
  const flat = stripAccents(text.toLowerCase());
  const matched = lw.filter((w) => JOB_SET.has(w.replace(/\.$/, '')) || JOB_SET.has(w));
  const strong = matched.filter((w) => !WEAK_JOB_WORDS.has(w)).length + JOB_PHRASES.filter((p) => flat.includes(p)).length;
  const weak = matched.length - matched.filter((w) => !WEAK_JOB_WORDS.has(w)).length;
  if (!strong && !weak) return 0;
  return Math.min(1, 0.55 + 0.2 * strong + 0.1 * weak);
}

function companyScore(text: string, hints: Hints): number {
  let s = 0;
  if (hasLegalSuffix(text)) s += 0.9;
  const lw = lowerWords(text);
  const flat = stripAccents(text.toLowerCase());
  if (lw.some((w) => STRONG_COMPANY_WORDS.has(w))) s += 0.6;
  else if (lw.some((w) => COMPANY_WORD_SET.has(w)) || COMPANY_PHRASES.some((p) => flat.includes(p))) s += 0.35;
  // the company name usually echoes the web/e-mail domain
  const domains = [hints.website, ...hints.emails.map((e) => e.split('@')[1] ?? '')]
    .map((d) => d.replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[/.]/)[0] ?? '')
    .filter((d) => d.length >= 3 && !GENERIC_MAIL_DOMAINS.has(`${d}.com`) && !GENERIC_MAIL_DOMAINS.has(`${d}.it`));
  const sq = squash(text);
  for (const d of domains) {
    const dq = squash(d);
    const firstWord = squash(words(text)[0] ?? '');
    if (sq && (dq.includes(sq) || sq.includes(dq) || (firstWord.length >= 4 && dq.startsWith(firstWord)))) {
      s += 0.6;
      break;
    }
  }
  if (isAllCaps(text) && words(text).length <= 5) s += 0.1;
  if (words(text).length > 8) s -= 0.4;
  return s;
}

function emailNameTokens(emails: string[]): string[] {
  return emails
    .filter((e) => !/^(info|sales|vendite|amministrazione|admin|office|segreteria|contatti|contact|hello|ciao|commerciale|ufficio|direzione|pec|support|marketing|acquisti|tecnico|hr|jobs|careers)\b/.test(e))
    .flatMap((e) => (e.split('@')[0] ?? '').split(/[._-]+/))
    .map((t) => t.replace(/\d+/g, ''))
    .filter((t) => t.length >= 3);
}

function stripHonorific(text: string): { prefix: string; rest: string } {
  const ws = words(text);
  const prefix: string[] = [];
  while (ws.length > 1) {
    const w = ws[0]!.toLowerCase();
    if (HONORIFIC_SET.has(w) || HONORIFIC_SET.has(w.replace(/\.$/, '')) || /^(dott|ing|arch|geom|avv|prof|dr)\.?(ssa)?\.?$/.test(w)) {
      prefix.push(ws.shift()!);
    } else break;
  }
  return { prefix: prefix.join(' '), rest: ws.join(' ') };
}

function nameScore(text: string, hints: Hints, emailTokens: string[]): number {
  if (digitCount(text) > 0 || /[@/\\:;]/.test(text)) return 0;
  const { prefix, rest } = stripHonorific(text);
  const ws = words(rest);
  if (ws.length < 2 || ws.length > 4) return prefix && ws.length === 1 ? 0.2 : 0;
  if (!ws.every((w) => /^[\p{L}][\p{L}'.-]*$/u.test(w))) return 0;
  let s = 0.25;
  if (prefix) s += 0.45;
  const capitalised = ws.every((w) => /^\p{Lu}/u.test(w) || SURNAME_PARTICLES.has(w.toLowerCase()));
  if (capitalised) s += 0.15;
  const lw = ws.map((w) => stripAccents(w.toLowerCase()));
  if (lw.some((w) => FIRST_NAMES.has(w))) s += 0.35;
  const sq = lw.map(squash);
  if (emailTokens.some((t) => sq.some((w) => w.length >= 3 && (w === t || (t.length >= 4 && w.startsWith(t)) || (w.length >= 4 && t.startsWith(w)))))) s += 0.45;
  if (jobScore(rest) > 0) s -= 0.6;
  if (hasLegalSuffix(text) || lw.some((w) => COMPANY_WORD_SET.has(w))) s -= 0.6;
  return s;
}

/** "Ing. Marco DE LUCA" → { prefix: "Ing.", firstName: "Marco", lastName: "De Luca" } */
export function splitName(text: string): { prefix: string; firstName: string; lastName: string } {
  const { prefix, rest } = stripHonorific(text.trim());
  let ws = words(rest);
  const allCaps = isAllCaps(rest);
  if (allCaps) ws = ws.map(titleCase);
  else {
    // "ROSSI Mario" / "Mario ROSSI": the upper-case block is the surname
    const capsIdx = ws.map((w, i) => (isAllCaps(w) && w.length > 1 ? i : -1)).filter((i) => i >= 0);
    if (capsIdx.length && capsIdx.length < ws.length) {
      const last = capsIdx.map((i) => titleCase(ws[i]!)).join(' ');
      const first = ws.filter((_, i) => !capsIdx.includes(i)).join(' ');
      return { prefix, firstName: first, lastName: last };
    }
  }
  if (ws.length === 1) return { prefix, firstName: ws[0]!, lastName: '' };
  let split = ws.length - 1;
  while (split > 1 && SURNAME_PARTICLES.has(ws[split - 1]!.toLowerCase())) split--;
  // known first name in second position ("Rossi Mario")
  if (ws.length === 2) {
    const [a, b] = ws.map((w) => stripAccents(w!.toLowerCase()));
    if (!FIRST_NAMES.has(a!) && FIRST_NAMES.has(b!)) return { prefix, firstName: ws[1]!, lastName: ws[0]! };
  }
  return { prefix, firstName: ws.slice(0, split).join(' '), lastName: ws.slice(split).join(' ') };
}

export interface Entities {
  name: { prefix: string; firstName: string; lastName: string; confidence: number } | null;
  company: { value: string; confidence: number } | null;
  jobTitle: { value: string; confidence: number } | null;
  leftovers: string[];
}

function sizeBonus(height: number): number {
  return Math.max(-0.15, Math.min(0.3, (height - 1) * 0.5));
}

export function pickEntities(candidates: Candidate[], hints: Hints): Entities {
  const emailTokens = emailNameTokens(hints.emails);
  const scored = candidates.map((c) => ({
    ...c,
    name: nameScore(c.text, hints, emailTokens) + (nameScore(c.text, hints, emailTokens) > 0 ? sizeBonus(c.height) : 0),
    company: companyScore(c.text, hints) + sizeBonus(c.height) * 0.5,
    job: jobScore(c.text),
  }));

  const taken = new Set<number>();
  type Scored = (typeof scored)[number];
  const best = (key: 'name' | 'company' | 'job', min: number, bonus: (c: Scored) => number = () => 0) => {
    let pick: Scored | null = null;
    let pickScore = -Infinity;
    scored.forEach((c, i) => {
      const s = c[key] + bonus(c);
      if (taken.has(i) || c[key] <= 0 || s < min) return;
      if (s > pickScore) {
        pick = c;
        pickScore = s;
      }
    });
    if (pick) taken.add(scored.indexOf(pick));
    return pick as Scored | null;
  };

  // A candidate goes to the role with the clearest signal: a person's name that echoes
  // the domain (tommaso@ricci.dev) must not become the company.
  const company = best('company', 0.55, (c) => (c.name > c.company ? -1 : 0));
  const name = best('name', 0.45);
  // the title usually sits right below (or above) the name
  let job = best('job', 0.5, (c) => (name ? (c.line === name.line + 1 ? 0.3 : c.line === name.line ? 0.2 : c.line === name.line - 1 ? 0.1 : 0) : 0));
  if (job) {
    const j = job;
    // "Geometra - Capo Cantiere": other title parts on the same line
    const same = scored.filter((c, i) => !taken.has(i) && c.line === j.line && c.job >= 0.5);
    for (const c of same) taken.add(scored.indexOf(c));
    let text = [j, ...same].sort((a, b) => scored.indexOf(a) - scored.indexOf(b)).map((c) => c.text).join(' - ');
    // titles often wrap on two lines: merge an adjacent title-looking line
    const next = scored.find((c, i) => !taken.has(i) && c.job >= 0.5 && Math.abs(c.line - j.line) === 1 && c.line !== name?.line);
    if (next) {
      taken.add(scored.indexOf(next));
      text = next.line > j.line ? `${text} ${next.text}` : `${next.text} ${text}`;
    }
    job = { ...j, text };
  }

  let nameOut: Entities['name'] = null;
  if (name) {
    nameOut = { ...splitName(name.text), confidence: Math.min(1, name.name) * name.confidence };
  } else {
    // fallback: derive "Mario Rossi" from mario.rossi@…
    const local = hints.emails.map((e) => e.split('@')[0] ?? '').find((l) => /^[a-z]{3,}[._][a-z]{3,}$/.test(l));
    if (local) {
      const [f = '', l = ''] = local.split(/[._]/);
      nameOut = { prefix: '', firstName: titleCase(f), lastName: titleCase(l), confidence: 0.3 };
    }
  }

  let companyOut: Entities['company'] = company
    ? { value: company.text, confidence: Math.min(1, company.company) * company.confidence }
    : null;
  if (!companyOut) {
    const domain = (hints.website.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0] ||
      hints.emails.map((e) => e.split('@')[1] ?? '').find((d) => !GENERIC_MAIL_DOMAINS.has(d))) ?? '';
    const label = domain.split('.')[0];
    if (label && label.length >= 3) companyOut = { value: titleCase(label), confidence: 0.25 };
  }

  // last resort for the title: a short, non-name line right below the name
  if (!job && name) {
    const below = scored.find(
      (c, i) => !taken.has(i) && c.line === name.line + 1 && words(c.text).length <= 6 && letterCount(c.text) >= 3 && c.company < 0.55,
    );
    if (below) {
      taken.add(scored.indexOf(below));
      job = { ...below, job: 0.35 };
    }
  }

  return {
    name: nameOut,
    company: companyOut,
    jobTitle: job ? { value: job.text, confidence: Math.min(1, job.job) * job.confidence } : null,
    leftovers: scored.filter((_, i) => !taken.has(i)).map((c) => c.text),
  };
}
