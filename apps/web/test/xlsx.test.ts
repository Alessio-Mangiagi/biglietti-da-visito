// @vitest-environment jsdom
import { SHEET_KEYS, SHEET_LABELS, recordToContact, rowsToRecords } from '@cardvault/shared';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { templateXlsx } from '../src/lib/sheetTemplate';
import { SheetFileError, columnIndex, columnName, readXlsx, writeXlsx } from '../src/lib/xlsx';

const bytes = async (b: Blob) => new Uint8Array(await b.arrayBuffer());

describe('xlsx', () => {
  it('converts column letters', () => {
    expect(columnIndex('A1')).toBe(0);
    expect(columnIndex('Z9')).toBe(25);
    expect(columnIndex('AA10')).toBe(26);
    expect(columnName(0)).toBe('A');
    expect(columnName(26)).toBe('AA');
    expect(columnName(701)).toBe('ZZ');
  });

  it('writes the template and reads it back', async () => {
    const rows = readXlsx(await bytes(templateXlsx()));
    expect(rows).toEqual([SHEET_KEYS.map((k) => SHEET_LABELS[k])]);
  });

  it('keeps text, accents, markup and empty cells', async () => {
    const blob = writeXlsx([{ name: 'Biglietti', header: true, textColumns: true, rows: [['Nome', '', 'Note'], ['Nicolò', '', 'a < b & "c"'], ['', 'x']] }]);
    expect(readXlsx(await bytes(blob))).toEqual([
      ['Nome', '', 'Note'],
      ['Nicolò', '', 'a < b & "c"'],
      ['', 'x'],
    ]);
  });

  it('reads a workbook saved by another program (shared strings, numbers, dates, booleans)', () => {
    const rows = readXlsx(new Uint8Array(readFileSync(resolve(__dirname, 'fixtures/openpyxl.xlsx'))));
    const t = rowsToRecords(rows);
    expect(t.ignored).toEqual(['Codice fiscale']);
    expect(t.records).toHaveLength(3);
    const first = recordToContact(t.records[0]!);
    expect(first.error).toBeNull();
    expect(first.contact).toMatchObject({
      company: 'Cosedil S.p.A.',
      firstName: 'Marta',
      emails: ['marta@cosedil.it'],
      phones: [{ type: 'mobile', value: '+39 333 123 4567' }],
      metOn: '2026-11-10',
      favorite: true,
    });
    expect(recordToContact(t.records[1]!).contact).toMatchObject({ phones: [{ type: 'mobile', value: '3331234567' }], favorite: false });
    expect(t.records[2]).toEqual({ firstName: 'Riga dopo un buco' });
  });

  it('reads the template after it was filled in and saved by Microsoft Excel', () => {
    const t = rowsToRecords(readXlsx(new Uint8Array(readFileSync(resolve(__dirname, 'fixtures/excel.xlsx')))));
    expect(t.assumedOrder).toBe(false);
    expect(t.ignored).toEqual([]);
    expect(t.records.map((r) => recordToContact(r))).toEqual([
      expect.objectContaining({
        error: null,
        contact: expect.objectContaining({
          prefix: 'Ing.',
          firstName: 'Marta',
          lastName: 'Colombo',
          company: 'Cosedil S.p.A.',
          emails: ['marta@cosedil.it'],
          phones: [
            { type: 'mobile', value: '+39 333 123 4567' },
            { type: 'work', value: '0957124483' }, // text column: the leading 0 survives
          ],
          metOn: '2026-11-10',
          favorite: true,
        }),
      }),
      expect.objectContaining({ error: null, contact: expect.objectContaining({ firstName: 'Nicolò', company: 'Tecnostrade S.r.l.', notes: 'Riga 1 & <nota>' }) }),
    ]);
  });

  it('refuses files that are not xlsx', () => {
    expect(() => readXlsx(new TextEncoder().encode('Nome;Cognome'))).toThrow(SheetFileError);
    expect(() => readXlsx(new Uint8Array([0x50, 0x4b, 3, 4, 0, 0]))).toThrow(/danneggiato/);
  });
});
