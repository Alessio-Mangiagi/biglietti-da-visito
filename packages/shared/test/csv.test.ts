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

import { toHref } from '../src';

describe('toHref', () => {
  it('keeps web, mail and phone links', () => {
    expect(toHref('www.cosedilspa.com')).toBe('https://www.cosedilspa.com');
    expect(toHref('http://example.it/a')).toBe('http://example.it/a');
    expect(toHref('mailto:a@b.it')).toBe('mailto:a@b.it');
    expect(toHref('tel:+39095')).toBe('tel:+39095');
  });

  it('neutralises script and data schemes', () => {
    for (const evil of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' java\tscript:alert(1)', 'data:text/html,<script>', 'vbscript:x']) {
      expect(toHref(evil)).toMatch(/^https:\/\//);
      expect(toHref(evil).toLowerCase()).not.toMatch(/^(javascript|data|vbscript):/);
    }
  });
});
