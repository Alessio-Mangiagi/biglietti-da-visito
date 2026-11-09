import { describe, expect, it } from 'vitest';
import { ContactInputSchema, sanitizeCell, toCsv } from '../src';

describe('csv', () => {
  it('neutralises formulas but keeps phone numbers', () => {
    expect(sanitizeCell('=HYPERLINK("x")')).toBe(`'=HYPERLINK("x")`);
    expect(sanitizeCell('@SUM(A1)')).toBe(`'@SUM(A1)`);
    expect(sanitizeCell('+cmd|calc')).toBe(`'+cmd|calc`);
    expect(sanitizeCell('+39 095 712 4483')).toBe('+39 095 712 4483');
    expect(sanitizeCell('Mario')).toBe('Mario');
  });

  it('quotes separators and starts with BOM', () => {
    const c = ContactInputSchema.parse({ firstName: 'Anna; Maria', notes: 'riga1\nriga2' });
    const csv = toCsv([c]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('"Anna; Maria"');
    expect(csv).toContain('"riga1\nriga2"');
  });
});
