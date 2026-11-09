import { parseCard } from '../src';
import { fixtures } from './fixtures';
const only = process.argv[2];
let fails = 0;
for (const f of fixtures) {
  if (only && !f.id.startsWith(only)) continue;
  let res;
  try { res = parseCard(f.text); } catch (e) { console.log(f.id, 'THROW', (e as Error).message); fails++; continue; }
  const diffs: string[] = [];
  for (const [k, v] of Object.entries(f.expect)) {
    const got = (res.contact as Record<string, unknown>)[k];
    if (JSON.stringify(got) !== JSON.stringify(v)) diffs.push(`  ${k}: got ${JSON.stringify(got)} want ${JSON.stringify(v)}`);
  }
  if (diffs.length) { fails++; console.log(f.id); console.log(diffs.join('\n')); if (only) console.log(res); }
}
console.log('fails', fails);
