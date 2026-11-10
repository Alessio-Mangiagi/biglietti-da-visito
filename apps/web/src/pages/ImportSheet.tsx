import {
  MAX_SHEET_ROWS,
  isHeaderRow,
  SHEET_KEYS,
  SHEET_LABELS,
  parseDelimited,
  recordToContact,
  rowsToRecords,
  type ContactInputRaw,
  type SheetKey,
  type SheetRecord,
} from '@cardvault/shared';
import { CheckCircle, ClipboardText, DownloadSimple, FileXls, PencilSimpleLine, Plus, Trash, UploadSimple, WarningCircle } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState, type ClipboardEvent, type DragEvent } from 'react';
import { Link } from 'react-router';
import { useToast } from '../components/Toasts';
import { api, errorMessage, saveBlob } from '../lib/api';

/** Columns editable in the on-screen sheet; the others are kept from the file. */
const GRID: SheetKey[] = ['firstName', 'lastName', 'company', 'jobTitle', 'emails', 'mobile', 'work', 'city'];
const PAGE = 100;
const CHUNK = 100;

interface Row {
  id: number;
  rec: SheetRecord;
  /** Message from the server for a row it refused. */
  serverError?: string;
}

interface ImportResult {
  created: number;
  skipped: number;
  skippedIndexes: number[];
  errors: Array<{ index: number; message: string }>;
}

let nextId = 1;
const newRow = (rec: SheetRecord = {}): Row => ({ id: nextId++, rec });

export function ImportSheetPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [source, setSource] = useState('');
  const [notes, setNotes] = useState<string[]>([]);
  const [shown, setShown] = useState(PAGE);
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [busy, setBusy] = useState<null | 'reading' | { done: number; total: number }>(null);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ created: number; skipped: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [pasted, setPasted] = useState('');

  const checked = useMemo(() => rows.map((r) => ({ row: r, ...recordToContact(r.rec) })), [rows]);
  const ready = checked.filter((c) => !c.error);
  const invalid = checked.length - ready.length;

  function load(raw: string[][], from: string) {
    const t = rowsToRecords(raw);
    if (!t.records.length) {
      setError('Nel file non ci sono righe da importare: la prima riga deve avere i nomi delle colonne (Nome, Cognome, Azienda…).');
      return;
    }
    const n: string[] = [];
    if (t.assumedOrder) n.push('Non ho trovato i nomi delle colonne: ho usato l’ordine del modello (Titolo, Nome, Cognome, Azienda…).');
    if (t.ignored.length) n.push(`Colonne non riconosciute, ignorate: ${t.ignored.join(', ')}.`);
    if (t.truncated) n.push(`Il file ha più di ${MAX_SHEET_ROWS} righe: importo le prime ${MAX_SHEET_ROWS}.`);
    setError('');
    setResult(null);
    setNotes(n);
    setSource(from);
    setShown(PAGE);
    setRows(t.records.map((rec) => newRow(rec)));
  }

  async function readFile(file: File | undefined) {
    if (!file) return;
    setError('');
    setBusy('reading');
    try {
      const { MAX_SHEET_FILE, readXlsx } = await import('../lib/xlsx');
      if (file.size > MAX_SHEET_FILE) throw new Error('Il file è troppo grande (massimo 8 MB).');
      if (/\.xls$/i.test(file.name)) throw new Error('I file .xls del vecchio Excel non sono supportati: in Excel usa «Salva con nome» → Cartella di lavoro Excel (.xlsx).');
      const isText = /\.(csv|tsv|txt)$/i.test(file.name) || file.type.startsWith('text/');
      load(isText ? parseDelimited(await file.text()) : readXlsx(new Uint8Array(await file.arrayBuffer())), file.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : errorMessage(err));
    } finally {
      setBusy(null);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function downloadTemplate() {
    const { templateXlsx } = await import('../lib/sheetTemplate');
    saveBlob(templateXlsx(), 'Modello biglietti CardVault.xlsx');
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    void readFile(e.dataTransfer.files[0]);
  }

  const update = (id: number, key: SheetKey, value: string) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, serverError: undefined, rec: { ...r.rec, [key]: value } } : r)));

  /** Cells copied from Excel pasted into the on-screen sheet fill the rows and columns below/right. */
  function onCellPaste(e: ClipboardEvent<HTMLInputElement>, rowIndex: number, colIndex: number) {
    const text = e.clipboardData.getData('text/plain');
    if (!/[\t\n]/.test(text.trim())) return;
    e.preventDefault();
    const grid = parseDelimited(text.replace(/\r?\n$/, ''));
    // a block copied with its header row: columns are matched by name, rows are appended
    if (isHeaderRow(grid[0] ?? [])) {
      const added = rowsToRecords(grid).records.map((rec) => newRow(rec));
      setRows((rs) => [...rs.filter((r) => Object.values(r.rec).some(Boolean)), ...added].slice(0, MAX_SHEET_ROWS));
      return;
    }
    setRows((rs) => {
      const out = rs.slice();
      grid.forEach((cells, dr) => {
        const at = rowIndex + dr;
        if (at >= MAX_SHEET_ROWS) return;
        const row = out[at] ?? newRow();
        const rec = { ...row.rec };
        cells.forEach((v, dc) => {
          const key = GRID[colIndex + dc];
          if (key) rec[key] = v.trim();
        });
        out[at] = { ...row, rec, serverError: undefined };
      });
      return out;
    });
  }

  async function submit() {
    const todo = ready.map((c) => ({ row: c.row, contact: c.contact }));
    if (!todo.length) return;
    setBusy({ done: 0, total: todo.length });
    setError('');
    const done = new Set<number>();
    const failed = new Map<number, string>();
    let created = 0;
    let skipped = 0;
    try {
      for (let i = 0; i < todo.length; i += CHUNK) {
        const part = todo.slice(i, i + CHUNK);
        const res = await api.post<ImportResult>('/contacts/import/rows', {
          contacts: part.map((p): ContactInputRaw => p.contact),
          skipDuplicates,
        });
        created += res.created;
        skipped += res.skipped;
        const bad = new Map(res.errors.map((e) => [e.index, e.message]));
        part.forEach((p, j) => (bad.has(j) ? failed.set(p.row.id, bad.get(j)!) : done.add(p.row.id)));
        setBusy({ done: Math.min(i + CHUNK, todo.length), total: todo.length });
      }
    } catch (err) {
      setError(`${errorMessage(err)}${created ? ` (${created} biglietti erano già stati creati)` : ''}`);
    } finally {
      setBusy(null);
      void qc.invalidateQueries({ queryKey: ['contacts'] });
      setRows((rs) => rs.filter((r) => !done.has(r.id)).map((r) => (failed.has(r.id) ? { ...r, serverError: failed.get(r.id) } : r)));
      if (created || skipped) {
        setResult({ created, skipped });
        toast(`Creati ${created} biglietti${skipped ? `, ${skipped} già presenti` : ''}`);
      }
    }
  }

  const sending = typeof busy === 'object' && busy !== null;

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">Importa</p>
          <h1>Biglietti da Excel</h1>
        </div>
      </div>

      {result && (
        <div className="alert alert-success import-result" role="status">
          <CheckCircle size={22} weight="fill" aria-hidden="true" />
          <span>
            <strong>
              {result.created === 1 ? 'Creato 1 biglietto' : `Creati ${result.created} biglietti`}
            </strong>
            {result.skipped ? ` · ${result.skipped} già nel wallet, saltati` : ''}
            {rows.length ? ` · ${rows.length} righe da correggere qui sotto` : ''}
          </span>
          <Link to="/" className="btn btn-primary btn-sm">
            Apri il wallet
          </Link>
        </div>
      )}

      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}

      {!rows.length ? (
        <>
          <ol className="steps-cards import-steps">
            <li>
              <span className="step-num" aria-hidden="true">1</span>
              <FileXls size={30} aria-hidden="true" />
              <strong>Scarica il modello</strong>
              <span className="muted small">Un foglio Excel con le colonne già pronte: Nome, Cognome, Azienda, Email, Cellulare…</span>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => void downloadTemplate()}>
                <DownloadSimple size={16} /> Modello Excel
              </button>
            </li>
            <li>
              <span className="step-num" aria-hidden="true">2</span>
              <PencilSimpleLine size={30} aria-hidden="true" />
              <strong>Compilalo</strong>
              <span className="muted small">Una riga per biglietto. Vanno bene anche i tuoi elenchi: riconosco le colonne dal nome.</span>
            </li>
            <li>
              <span className="step-num" aria-hidden="true">3</span>
              <UploadSimple size={30} aria-hidden="true" />
              <strong>Caricalo qui</strong>
              <span className="muted small">Controlli l’anteprima, correggi le righe e crei i biglietti.</span>
            </li>
          </ol>

          <label
            className={`dropzone${dragging ? ' is-over' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            aria-busy={busy === 'reading'}
          >
            <UploadSimple size={32} aria-hidden="true" />
            <strong>{busy === 'reading' ? 'Lettura del file…' : 'Carica il file Excel o CSV'}</strong>
            <span className="muted small">Tocca per sceglierlo, oppure trascinalo qui · .xlsx, .csv</span>
            <input
              ref={fileInput}
              type="file"
              accept=".xlsx,.csv,.tsv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
              className="visually-hidden"
              disabled={!!busy}
              onChange={(e) => void readFile(e.target.files?.[0])}
            />
          </label>

          <div className="import-alt">
            <label className="field">
              <span className="label">
                <ClipboardText size={16} aria-hidden="true" /> Oppure incolla le celle copiate da Excel
              </span>
              <textarea
                className="textarea"
                rows={3}
                placeholder="Seleziona le righe in Excel (con l’intestazione), copia e incolla qui"
                onPaste={(e) => {
                  const text = e.clipboardData.getData('text/plain');
                  if (!text.trim()) return;
                  e.preventDefault();
                  load(parseDelimited(text), 'Incollato da Excel');
                }}
                onChange={(e) => setPasted(e.target.value)}
                value={pasted}
              />
            </label>
            {pasted.trim() && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  load(parseDelimited(pasted), 'Incollato da Excel');
                  setPasted('');
                }}
              >
                Leggi il testo
              </button>
            )}
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setSource('Scritto qui');
                setNotes([]);
                setResult(null);
                setRows([newRow(), newRow(), newRow()]);
              }}
            >
              <PencilSimpleLine size={16} /> Oppure scrivili qui, come in un foglio
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="spread import-summary">
            <span>
              <strong>{source}</strong>
              <span className="muted small">
                {' '}
                · {rows.length} {rows.length === 1 ? 'riga' : 'righe'} · {ready.length} pronte
                {invalid ? (
                  <>
                    {' '}
                    · <span className="text-warning">{invalid} da correggere</span>
                  </>
                ) : null}
              </span>
            </span>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={sending}
              onClick={() => {
                setRows([]);
                setNotes([]);
                setError('');
              }}
            >
              Ricomincia
            </button>
          </div>
          {notes.map((n) => (
            <p key={n} className="alert alert-warning small">
              {n}
            </p>
          ))}

          <div className="sheet-scroll" role="region" aria-label="Anteprima delle righe" tabIndex={0}>
            <table className="sheet">
              <thead>
                <tr>
                  <th scope="col" className="sheet-n">
                    #
                  </th>
                  {GRID.map((k) => (
                    <th key={k} scope="col">
                      {SHEET_LABELS[k]}
                    </th>
                  ))}
                  <th scope="col">Stato</th>
                  <th scope="col">
                    <span className="visually-hidden">Azioni</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {checked.slice(0, shown).map(({ row, error: rowError }, i) => {
                  const problem = row.serverError ?? rowError;
                  const extra = SHEET_KEYS.filter((k) => !GRID.includes(k) && row.rec[k]);
                  return (
                    <tr key={row.id} className={problem ? 'has-error' : undefined}>
                      <th scope="row" className="sheet-n">
                        <span className="sheet-n-inner">
                          {problem ? (
                            <WarningCircle size={16} weight="fill" className="text-warning" aria-label="Da correggere" />
                          ) : (
                            <CheckCircle size={16} weight="fill" className="sheet-ok" aria-label="Pronta" />
                          )}
                          {i + 1}
                        </span>
                      </th>
                      {GRID.map((k, ci) => (
                        <td key={k}>
                          <input
                            className="sheet-input"
                            value={row.rec[k] ?? ''}
                            aria-label={`${SHEET_LABELS[k]}, riga ${i + 1}`}
                            inputMode={k === 'emails' ? 'email' : k === 'mobile' || k === 'work' ? 'tel' : undefined}
                            onChange={(e) => update(row.id, k, e.target.value)}
                            onPaste={(e) => onCellPaste(e, i, ci)}
                            disabled={sending}
                          />
                        </td>
                      ))}
                      <td className="sheet-status">
                        {problem ? (
                          <span className="text-warning inline">
                            <WarningCircle size={16} aria-hidden="true" /> {problem}
                          </span>
                        ) : (
                          <span className="inline sheet-ok">
                            <CheckCircle size={16} aria-hidden="true" /> Pronta
                          </span>
                        )}
                        {extra.length ? (
                          <span className="muted small sheet-extra" title={extra.map((k) => `${SHEET_LABELS[k]}: ${row.rec[k]}`).join('\n')}>
                            + {extra.map((k) => SHEET_LABELS[k]).join(', ')}
                          </span>
                        ) : null}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="icon-btn"
                          aria-label={`Togli la riga ${i + 1}`}
                          disabled={sending}
                          onClick={() => setRows((rs) => rs.filter((r) => r.id !== row.id))}
                        >
                          <Trash size={18} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="inline import-more">
            <button type="button" className="btn btn-ghost btn-sm" disabled={sending || rows.length >= MAX_SHEET_ROWS} onClick={() => setRows((rs) => [...rs, newRow()])}>
              <Plus size={16} /> Aggiungi riga
            </button>
            {rows.length > shown && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShown((s) => s + PAGE)}>
                Mostra altre {Math.min(PAGE, rows.length - shown)} righe
              </button>
            )}
          </div>
          <p className="field-hint">Puoi incollare celle copiate da Excel direttamente nella tabella. Le righe incomplete non vengono create.</p>

          <div className="import-bar">
            <label className="checkbox">
              <input type="checkbox" checked={skipDuplicates} onChange={(e) => setSkipDuplicates(e.target.checked)} disabled={sending} />
              <span>Salta chi è già nel wallet (stessa email o telefono)</span>
            </label>
            <button type="button" className="btn btn-primary" disabled={!ready.length || !!busy} onClick={() => void submit()}>
              {sending
                ? `Creazione… ${busy.done}/${busy.total}`
                : ready.length === 1
                  ? 'Crea 1 biglietto'
                  : `Crea ${ready.length} biglietti`}
            </button>
          </div>
        </>
      )}
    </>
  );
}
