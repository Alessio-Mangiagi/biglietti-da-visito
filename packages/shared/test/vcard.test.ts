import { describe, expect, it } from 'vitest';
import { ContactInputSchema, foldLine, parseMeCard, parseVCards, toVCard } from '../src';

const sample = ContactInputSchema.parse({
  prefix: 'Ing.',
  firstName: 'Marta',
  lastName: 'Colombo',
  company: 'Cosedil S.p.A.',
  jobTitle: 'Direttore tecnico; area Sud',
  emails: ['m.colombo@cosedilspa.com'],
  phones: [
    { type: 'mobile', value: '+39 333 123 4567' },
    { type: 'work', value: '+39 095 712 4483' },
  ],
  website: 'https://www.cosedilspa.com',
  address: { street: 'Via Vincenzo Giuffrida, 37', city: 'Catania', postalCode: '95128', province: 'CT', country: 'Italia' },
  socials: [{ network: 'linkedin', value: 'https://linkedin.com/in/martacolombo' }],
  notes: 'Conosciuta al SAEIE.\nRichiamare per commessa Palermo',
  tags: ['cantiere', 'fornitori, edilizia'],
  metAt: 'SAIE Bologna',
  metOn: '2026-10-15',
});

describe('vCard', () => {
  for (const version of ['3.0', '4.0'] as const) {
    it(`round-trips v${version}`, () => {
      const text = toVCard(sample, version, { uid: 'abc' });
      expect(text).toContain(`VERSION:${version}`);
      const [parsed] = parseVCards(text);
      const back = ContactInputSchema.parse(parsed);
      expect(back).toEqual({ ...sample, favorite: false, ocrText: '' });
    });
  }

  it('folds long lines at 75 octets keeping UTF-8 intact', () => {
    const line = 'NOTE:' + 'àèìòù'.repeat(40);
    const folded = foldLine(line);
    for (const l of folded.split('\r\n')) expect(new TextEncoder().encode(l).length).toBeLessThanOrEqual(75);
    expect(folded.replace(/\r\n /g, '')).toBe(line);
  });

  it('reads vCard 2.1 with quoted-printable and bare types', () => {
    const text = [
      'BEGIN:VCARD',
      'VERSION:2.1',
      'N;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:Nicol=C3=B2;Fabio;;Geom.;',
      'FN:Geom. Fabio Nicolò',
      'TEL;CELL:3331234567',
      'TEL;WORK;FAX:095 123456',
      'item1.EMAIL;INTERNET:Fabio.Nicolo@Example.it',
      'ADR;WORK;ENCODING=QUOTED-PRINTABLE:;;Via Etnea 10;Catania;CT;95100;Ital=',
      'ia',
      'END:VCARD',
    ].join('\r\n');
    const [c] = parseVCards(text);
    expect(c).toMatchObject({
      lastName: 'Nicolò',
      firstName: 'Fabio',
      prefix: 'Geom.',
      emails: ['fabio.nicolo@example.it'],
      phones: [
        { type: 'mobile', value: '3331234567' },
        { type: 'fax', value: '095 123456' },
      ],
      address: { street: 'Via Etnea 10', city: 'Catania', province: 'CT', postalCode: '95100', country: 'Italia' },
    });
  });

  it('reads several cards and falls back to FN', () => {
    const text = 'BEGIN:VCARD\nVERSION:3.0\nFN:Luca Bianchi\nEND:VCARD\nBEGIN:VCARD\nVERSION:3.0\nFN:Anna\nORG:ACME;Vendite\nEND:VCARD\n';
    const cards = parseVCards(text);
    expect(cards).toHaveLength(2);
    expect(cards[0]).toMatchObject({ firstName: 'Luca', lastName: 'Bianchi' });
    expect(cards[1]).toMatchObject({ firstName: 'Anna', company: 'ACME - Vendite' });
  });

  it('reads MECARD', () => {
    expect(parseMeCard('MECARD:N:Rossi,Mario;TEL:+390951234567;EMAIL:mario@rossi.it;;')).toMatchObject({
      firstName: 'Mario',
      lastName: 'Rossi',
      emails: ['mario@rossi.it'],
    });
  });
});
