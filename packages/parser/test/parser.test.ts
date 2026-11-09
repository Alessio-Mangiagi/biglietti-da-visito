import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LOW_CONFIDENCE, mergeParsed, parseCard, parseQrPayload, splitName } from '../src';
import { fixtures, type Fixture } from './fixtures';

/** Real cards: test/real/<id>.txt + <id>.json (expected fields). Not committed if private. */
function realFixtures(): Fixture[] {
  const dir = join(import.meta.dirname, 'real');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.txt'))
    .map((f) => {
      const id = f.replace(/\.txt$/, '');
      return {
        id: `real/${id}`,
        text: readFileSync(join(dir, f), 'utf8'),
        expect: JSON.parse(readFileSync(join(dir, `${id}.json`), 'utf8')),
      };
    });
}

describe('parseCard fixtures', () => {
  const all = [...fixtures, ...realFixtures()];
  it('has at least 30 cards', () => expect(all.length).toBeGreaterThanOrEqual(30));

  for (const f of all) {
    it(f.id, () => {
      const { contact } = parseCard(f.text);
      for (const [key, value] of Object.entries(f.expect)) {
        expect(contact[key as keyof typeof contact], `${f.id} → ${key}`).toEqual(value);
      }
    });
  }
});

describe('splitName', () => {
  it.each([
    ['Mario Rossi', { prefix: '', firstName: 'Mario', lastName: 'Rossi' }],
    ['Ing. Marco DE LUCA', { prefix: 'Ing.', firstName: 'Marco', lastName: 'De Luca' }],
    ['ROSSI Mario', { prefix: '', firstName: 'Mario', lastName: 'Rossi' }],
    ['Maria Della Valle', { prefix: '', firstName: 'Maria', lastName: 'Della Valle' }],
    ["GIOVANNI D'ANGELO", { prefix: '', firstName: 'Giovanni', lastName: "D'Angelo" }],
    ['Rossi Mario', { prefix: '', firstName: 'Mario', lastName: 'Rossi' }],
  ])('%s', (input, out) => expect(splitName(input)).toEqual(out));
});

describe('confidence', () => {
  it('uses OCR line confidence and flags weak fields', () => {
    const res = parseCard([
      { text: 'Mario Rossi', confidence: 95, height: 40 },
      { text: 'Rossi Impianti S.r.l.', confidence: 40, height: 28 },
      { text: 'mario@rossiimpianti.it', confidence: 92, height: 18 },
    ]);
    expect(res.contact.firstName).toBe('Mario');
    expect(res.confidence.name).toBeGreaterThan(LOW_CONFIDENCE);
    expect(res.confidence.company).toBeLessThan(LOW_CONFIDENCE);
  });

  it('keeps the raw OCR text', () => {
    expect(parseCard('Mario Rossi\nCEO').contact.ocrText).toBe('Mario Rossi\nCEO');
  });
});

describe('QR and merge', () => {
  it('reads a vCard QR with full confidence', () => {
    const res = parseQrPayload('BEGIN:VCARD\nVERSION:3.0\nN:Rossi;Mario\nTEL;TYPE=CELL:+393331234567\nEND:VCARD');
    expect(res?.contact).toMatchObject({ firstName: 'Mario', lastName: 'Rossi' });
    expect(res?.confidence.name).toBe(1);
  });

  it('returns null for non-contact QR', () => expect(parseQrPayload('https://example.com')).toBeNull());

  it('fills gaps from the back side', () => {
    const front = parseCard('Mario Rossi\nDirettore Vendite');
    const back = parseCard('ACME S.p.A.\nVia Roma 1, 95100 Catania\ninfo@acme.it');
    const merged = mergeParsed(front, back);
    expect(merged.contact).toMatchObject({ firstName: 'Mario', company: 'ACME S.p.A.', emails: ['info@acme.it'] });
    expect(merged.contact.address.city).toBe('Catania');
  });
});
