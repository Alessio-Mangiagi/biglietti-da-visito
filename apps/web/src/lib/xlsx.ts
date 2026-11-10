import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';

/**
 * Minimal .xlsx reader/writer: enough for the import template and for reading back the
 * first sheet of a workbook saved by Excel, LibreOffice, Numbers or Google Sheets.
 */

const MAX_UNZIPPED = 40 * 1024 * 1024; // guards against zip bombs
export const MAX_SHEET_FILE = 8 * 1024 * 1024;

export class SheetFileError extends Error {}

const xml = (text: string) => new DOMParser().parseFromString(text, 'application/xml');
const all = (node: Document | Element, tag: string) => Array.from(node.getElementsByTagNameNS('*', tag));

/** "BC12" → 54 (0-based column index). */
export function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/i.exec(ref)?.[0].toUpperCase() ?? '';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function columnName(index: number): string {
  let s = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** Text of a shared/inline string, skipping phonetic runs. */
const stringText = (si: Element) =>
  all(si, 't')
    .filter((t) => t.parentElement?.localName !== 'rPh')
    .map((t) => t.textContent ?? '')
    .join('');

/** Rows of the first worksheet, every cell as text. */
export function readXlsx(data: Uint8Array): string[][] {
  if (data[0] !== 0x50 || data[1] !== 0x4b) {
    throw new SheetFileError('Il file non è un .xlsx: in Excel usa «Salva con nome» → Cartella di lavoro Excel (.xlsx) oppure CSV.');
  }
  let total = 0;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(data, {
      filter: (f) => {
        if (!/^(xl\/workbook\.xml|xl\/_rels\/workbook\.xml\.rels|xl\/sharedStrings\.xml|xl\/worksheets\/[^/]+\.xml)$/i.test(f.name)) return false;
        total += f.originalSize;
        if (total > MAX_UNZIPPED) throw new SheetFileError('Il foglio è troppo grande.');
        return true;
      },
    });
  } catch (err) {
    if (err instanceof SheetFileError) throw err;
    throw new SheetFileError('Il file è danneggiato o non è un foglio Excel.');
  }
  const text = (name: string) => {
    const key = Object.keys(files).find((k) => k.toLowerCase() === name.toLowerCase());
    return key ? strFromU8(files[key]!) : null;
  };

  // the first sheet in tab order, found through the workbook relationships
  let sheetPath = 'xl/worksheets/sheet1.xml';
  const wb = text('xl/workbook.xml');
  const rels = text('xl/_rels/workbook.xml.rels');
  if (wb && rels) {
    const first = all(xml(wb), 'sheet')[0];
    const rid = first?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') ?? first?.getAttribute('r:id');
    const target = all(xml(rels), 'Relationship')
      .find((r) => r.getAttribute('Id') === rid)
      ?.getAttribute('Target');
    if (target) sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
  }
  const sheet = text(sheetPath);
  if (!sheet) throw new SheetFileError('Nel file non c’è nessun foglio da leggere.');

  const sst = text('xl/sharedStrings.xml');
  const shared = sst ? all(xml(sst), 'si').map(stringText) : [];

  const rows: string[][] = [];
  for (const row of all(xml(sheet), 'row')) {
    const r = Number(row.getAttribute('r')) - 1;
    const index = Number.isInteger(r) && r >= 0 ? r : rows.length;
    if (index > 100_000) break;
    const cells: string[] = [];
    let next = 0;
    for (const c of all(row, 'c')) {
      const ref = c.getAttribute('r');
      const col = ref ? columnIndex(ref) : next;
      next = col + 1;
      if (col > 200) continue;
      const type = c.getAttribute('t');
      const v = all(c, 'v')[0]?.textContent ?? '';
      let value: string;
      if (type === 's') value = shared[Number(v)] ?? '';
      else if (type === 'inlineStr') value = all(c, 'is')[0] ? stringText(all(c, 'is')[0]!) : '';
      else if (type === 'b') value = v === '1' ? 'sì' : '';
      else if (type === 'e') value = '';
      else value = v;
      cells[col] = value;
    }
    rows[index] = Array.from(cells, (v) => v ?? '');
  }
  return Array.from(rows, (r) => r ?? []);
}

// ------------------------------------------------------------------ writer

const esc = (s: string) =>
  s
    // eslint-disable-next-line no-control-regex -- control characters are invalid in XML
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export interface SheetSpec {
  name: string;
  rows: string[][];
  /** Column widths in characters. */
  widths?: number[];
  /** First row styled as a header and frozen. */
  header?: boolean;
  /** Every column formatted as text, so phone numbers keep their leading 0 and "+". */
  textColumns?: boolean;
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="3"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="13"/><color rgb="FF0C4577"/><name val="Calibri"/><family val="2"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0C4577"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="49" fontId="1" fillId="2" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

/** Style ids in STYLES. */
const S = { text: 1, header: 2, title: 3, wrap: 4 } as const;

function sheetXml(spec: SheetSpec): string {
  const ncols = Math.max(spec.widths?.length ?? 0, ...spec.rows.map((r) => r.length), 1);
  const cols = Array.from({ length: ncols }, (_, i) => {
    const w = spec.widths?.[i] ?? 16;
    const style = spec.textColumns ? ` style="${S.text}"` : '';
    return `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"${style}/>`;
  }).join('');
  const rows = spec.rows
    .map((r, ri) => {
      const style = spec.header && ri === 0 ? S.header : spec.textColumns ? S.text : !spec.header && ri === 0 ? S.title : S.wrap;
      const cells = r
        .map((v, ci) => (v ? `<c r="${columnName(ci)}${ri + 1}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>` : ''))
        .join('');
      return `<row r="${ri + 1}">${cells}</row>`;
    })
    .join('');
  const pane = spec.header ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetViews><sheetView workbookViewId="0"${spec.header ? '' : ' showGridLines="0"'}>${pane}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols>${cols}</cols><sheetData>${rows}</sheetData></worksheet>`;
}

/** Copied into this realm's Uint8Array: fflate tells files from folders with instanceof. */
const u8 = (s: string) => Uint8Array.from(strToU8(s));

export function writeXlsx(sheets: SheetSpec[]): Blob {
  const files: Zippable = {
    '[Content_Types].xml': u8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets
      .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
      .join('')}</Types>`),
    '_rels/.rels': u8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    'xl/workbook.xml': u8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${sheets
      .map((s, i) => `<sheet name="${esc(s.name.slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
      .join('')}</sheets></workbook>`),
    'xl/_rels/workbook.xml.rels': u8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
      .map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
      .join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    'xl/styles.xml': u8(STYLES),
  };
  sheets.forEach((s, i) => (files[`xl/worksheets/sheet${i + 1}.xml`] = u8(sheetXml(s))));
  return new Blob([zipSync(files, { level: 6 }) as Uint8Array<ArrayBuffer>], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
