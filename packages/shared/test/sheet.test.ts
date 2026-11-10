import { describe, expect, it } from 'vitest';
import {
  CSV_HEADERS,
  ContactInputSchema,
  contactToRecord,
  headerKey,
  parseDelimited,
  parseSheetDate,
  recordToContact,
  rowsToRecords,
  toCsv,
} from '../src';

describe('sheet import', () => {
  it('recognises Italian and English headers', () => {
    expect(headerKey('Cognome')).toBe('lastName');
    expect(headerKey('E-mail')).toBe('emails');
    expect(headerKey('Ragione sociale')).toBe('company');
    expect(headerKey('Città')).toBe('city');
    expect(headerKey('Telefono')).toBe('work');
    expect(headerKey('Cell.')).toBe('mobile');
    expect(headerKey('Luogo/evento')).toBe('metAt');
    expect(headerKey('Codice fiscale')).toBeNull();
  });

  it('maps columns by header, in any order, and reports unknown ones', () => {
    const t = rowsToRecords([
      ['Azienda', 'Nome', 'Codice fiscale', 'Email', 'Email'],
      ['Cosedil', 'Marta', 'XXX', 'marta@cosedil.it', 'm.colombo@cosedil.it'],
      ['', '', '', '', ''],
      ['Tecnostrade', 'Orazio', '', '', ''],
    ]);
    expect(t.assumedOrder).toBe(false);
    expect(t.ignored).toEqual(['Codice fiscale']);
    expect(t.records).toEqual([
      { company: 'Cosedil', firstName: 'Marta', emails: 'marta@cosedil.it | m.colombo@cosedil.it' },
      { company: 'Tecnostrade', firstName: 'Orazio' },
    ]);
  });

  it('assumes the template order when there is no header row', () => {
    const t = rowsToRecords([['Ing.', 'Fabio', 'Restivo', 'Edil Restivo']]);
    expect(t.assumedOrder).toBe(true);
    expect(t.records[0]).toEqual({ prefix: 'Ing.', firstName: 'Fabio', lastName: 'Restivo', company: 'Edil Restivo' });
  });

  it('builds a valid contact from a row', () => {
    const { contact, error } = recordToContact({
      firstName: 'Marta',
      lastName: 'Colombo',
      emails: 'marta@cosedil.it; m.colombo@cosedil.it',
      mobile: "'+39 333 123 4567",
      work: '095 712 4483 | 095 712 4484',
      socials: 'linkedin.com/in/martacolombo',
      tags: 'fiera, edilizia, fiera',
      metOn: '10/11/2026',
      favorite: 'Sì',
      city: 'Catania',
    });
    expect(error).toBeNull();
    const c = ContactInputSchema.parse(contact);
    expect(c.emails).toEqual(['marta@cosedil.it', 'm.colombo@cosedil.it']);
    expect(c.phones).toEqual([
      { type: 'mobile', value: '+39 333 123 4567' },
      { type: 'work', value: '095 712 4483' },
      { type: 'work', value: '095 712 4484' },
    ]);
    expect(c.socials).toEqual([{ network: 'linkedin', value: 'linkedin.com/in/martacolombo' }]);
    expect(c.tags).toEqual(['fiera', 'edilizia']);
    expect(c.metOn).toBe('2026-11-10');
    expect(c.favorite).toBe(true);
    expect(c.address.city).toBe('Catania');
  });

  it('explains what is wrong with a row', () => {
    expect(recordToContact({ jobTitle: 'Geometra' }).error).toBe('Manca nome, cognome o azienda');
    expect(recordToContact({ firstName: 'A', emails: 'non-una-mail' }).error).toBe('Email non valida');
    expect(recordToContact({ firstName: 'A', metOn: '31/02/2026' }).error).toMatch(/Data incontro non valida/);
    expect(recordToContact({ firstName: 'A', city: 'x'.repeat(200) }).error).toBe('Città troppo lungo');
  });

  it('reads dates in the usual formats', () => {
    expect(parseSheetDate('2026-11-10')).toBe('2026-11-10');
    expect(parseSheetDate('1/2/26')).toBe('2026-02-01');
    expect(parseSheetDate('10.11.2026')).toBe('2026-11-10');
    expect(parseSheetDate('46336')).toBe('2026-11-10'); // Excel serial
    expect(parseSheetDate('domani')).toBeNull();
  });

  it('parses CSV (";" or ",") and cells pasted from Excel', () => {
    expect(parseDelimited('Nome;Note\r\nAnna;"riga 1\nriga ""2"""\r\n')).toEqual([
      ['Nome', 'Note'],
      ['Anna', 'riga 1\nriga "2"'],
    ]);
    expect(parseDelimited('Nome,Cognome\nAnna,Rossi')).toEqual([
      ['Nome', 'Cognome'],
      ['Anna', 'Rossi'],
    ]);
    expect(parseDelimited('Nome\tAzienda\nAnna\tAcme, S.r.l.\n')).toEqual([
      ['Nome', 'Azienda'],
      ['Anna', 'Acme, S.r.l.'],
    ]);
  });

  it('round-trips the CSV export', () => {
    const original = ContactInputSchema.parse({
      prefix: 'Ing.',
      firstName: 'Marta',
      lastName: 'Colombo',
      company: 'Cosedil S.p.A.',
      emails: ['marta@cosedil.it'],
      phones: [
        { type: 'mobile', value: '+39 333 123 4567' },
        { type: 'fax', value: '095 712 4400' },
      ],
      address: { street: 'Via Etnea 1', city: 'Catania', postalCode: '95100', province: 'CT', country: 'Italia' },
      tags: ['fiera'],
      metAt: 'SAIE Bari',
      metOn: '2026-10-08',
      favorite: true,
      notes: 'Interessata alla commessa; richiamare',
    });
    const t = rowsToRecords(parseDelimited(toCsv([original])));
    expect(t.columns).toHaveLength(CSV_HEADERS.length);
    expect(t.records[0]).toEqual(Object.fromEntries(Object.entries(contactToRecord(original)).filter(([, v]) => v)));
    expect(ContactInputSchema.parse(recordToContact(t.records[0]!).contact)).toEqual(original);
  });
});
