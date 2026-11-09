import type { ContactInput, PhoneType } from './contact';

const PHONE_COLUMNS: Array<[PhoneType, string]> = [
  ['mobile', 'Cellulare'],
  ['work', 'Telefono ufficio'],
  ['home', 'Telefono casa'],
  ['fax', 'Fax'],
  ['other', 'Altro telefono'],
];

export const CSV_HEADERS = [
  'Titolo',
  'Nome',
  'Cognome',
  'Azienda',
  'Ruolo',
  'Email',
  ...PHONE_COLUMNS.map(([, label]) => label),
  'Sito web',
  'Via',
  'Città',
  'CAP',
  'Provincia',
  'Nazione',
  'Social',
  'Tag',
  'Luogo/evento',
  'Data incontro',
  'Preferito',
  'Note',
] as const;

/**
 * Neutralises spreadsheet formula injection (OWASP). Plain phone numbers such as
 * "+39 095 712 4483" are left untouched because they cannot carry a formula.
 */
export function sanitizeCell(value: string): string {
  if (/^[=@\t\r]/.test(value)) return `'${value}`;
  if (/^[+-]/.test(value) && /[^\d\s().+-]/.test(value)) return `'${value}`;
  return value;
}

function quote(value: string, sep: string): string {
  const v = sanitizeCell(value);
  return new RegExp(`["\r\n${sep}]`).test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function toCsvRow(c: ContactInput): string[] {
  const phonesOf = (t: PhoneType) =>
    c.phones
      .filter((p) => p.type === t)
      .map((p) => p.value)
      .join(' | ');
  return [
    c.prefix,
    c.firstName,
    c.lastName,
    c.company,
    c.jobTitle,
    c.emails.join(' | '),
    ...PHONE_COLUMNS.map(([t]) => phonesOf(t)),
    c.website,
    c.address.street,
    c.address.city,
    c.address.postalCode,
    c.address.province,
    c.address.country,
    c.socials.map((s) => s.value).join(' | '),
    c.tags.join(', '),
    c.metAt,
    c.metOn ?? '',
    c.favorite ? 'sì' : '',
    c.notes,
  ];
}

/** UTF-8 BOM + ";" separator: opens correctly in Excel with Italian locale. */
export function toCsv(contacts: ContactInput[], sep = ';'): string {
  const rows = [CSV_HEADERS as readonly string[], ...contacts.map(toCsvRow)];
  return '﻿' + rows.map((r) => r.map((v) => quote(v ?? '', sep)).join(sep)).join('\r\n') + '\r\n';
}
