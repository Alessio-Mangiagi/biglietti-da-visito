import { SHEET_KEYS, SHEET_LABELS, type SheetKey } from '@cardvault/shared';
import { writeXlsx } from './xlsx';

const WIDTHS: Partial<Record<SheetKey, number>> = {
  prefix: 9,
  firstName: 16,
  lastName: 18,
  company: 28,
  jobTitle: 22,
  emails: 30,
  website: 24,
  street: 28,
  postalCode: 8,
  province: 10,
  socials: 30,
  tags: 20,
  metAt: 20,
  metOn: 14,
  favorite: 10,
  notes: 40,
};

const HELP: Array<[string, string]> = [
  ['Nome, Cognome, Azienda', 'Almeno uno dei tre per ogni riga.'],
  ['Email', 'Più indirizzi separati da «|» o «;».'],
  ['Cellulare, Telefono ufficio…', 'Scrivili come li leggi, anche con il prefisso: +39 095 712 4483. Più numeri separati da «|».'],
  ['Sito web, Social', 'Indirizzi completi o senza https, ad esempio linkedin.com/in/nome.'],
  ['Tag', 'Separati da virgola: fiera, fornitori.'],
  ['Luogo/evento, Data incontro', 'Dove vi siete conosciuti e quando (GG/MM/AAAA).'],
  ['Preferito', 'Scrivi «sì» per metterlo tra i preferiti.'],
];

/** The import template: one header row in the export's column order, plus a help sheet. */
export function templateXlsx(): Blob {
  return writeXlsx([
    {
      name: 'Biglietti',
      header: true,
      textColumns: true,
      rows: [SHEET_KEYS.map((k) => SHEET_LABELS[k])],
      widths: SHEET_KEYS.map((k) => WIDTHS[k] ?? 16),
    },
    {
      name: 'Istruzioni',
      widths: [32, 90],
      rows: [
        ['CardVault · Importa biglietti da Excel'],
        [],
        ['Una riga per ogni biglietto nel foglio «Biglietti». Le colonne vuote vanno bene, l’ordine delle colonne non conta.'],
        [],
        ...HELP.map(([a, b]) => [a, b]),
        [],
        ['Esempio', 'Ing. | Marta | Colombo | Cosedil S.p.A. | Direttore tecnico | marta.colombo@cosedil.it | +39 333 123 4567'],
        [],
        ['Poi', 'In CardVault apri Impostazioni → Importa da Excel e carica il file: prima di creare i biglietti vedi l’anteprima e puoi correggere le righe.'],
      ],
    },
  ]);
}
