import { LOW_CONFIDENCE, type ParsedField } from '@cardvault/parser';
import { displayName, type ContactInput } from '@cardvault/shared';
import { CaretDown, CaretUp, CheckCircle, Trash, WarningCircle } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { errorMessage } from '../lib/api';
import { applyEvent, type EventMode } from '../lib/event';
import { createContact, today } from '../lib/save';
import { useSession } from '../lib/session';
import { toJpeg } from '../scan/image';
import { readCard } from '../scan/read';
import { ContactForm } from './ContactForm';
import { useToast } from './Toasts';

export interface Shot {
  id: string;
  canvas: HTMLCanvasElement;
}

interface Item extends Shot {
  preview?: string;
  status: 'waiting' | 'reading' | 'ready' | 'saved' | 'error';
  form?: ContactInput;
  uncertain: Set<ParsedField>;
  error?: string;
}

const blankForm = (): ContactInput => ({
  prefix: '',
  firstName: '',
  lastName: '',
  company: '',
  jobTitle: '',
  emails: [],
  phones: [],
  website: '',
  address: { street: '', city: '', postalCode: '', province: '', country: '' },
  socials: [],
  notes: '',
  tags: [],
  metAt: '',
  metOn: today(),
  favorite: false,
  ocrText: '',
});

/**
 * Batch scan, second half: reads every shot on the device one after the other, then
 * lists them for a quick check. Each can be opened and corrected; "Salva tutti" saves
 * them (or queues them when offline).
 */
export function BatchReview({ shots, event, onRemove, onMore }: { shots: Shot[]; event: EventMode | null; onRemove: (id: string) => void; onMore: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const { status } = useSession();
  const [items, setItems] = useState<Item[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const started = useRef(new Set<string>());

  // keep the list in step with the shots (new ones appended, removed ones dropped)
  useEffect(() => {
    setItems((prev) => {
      const byId = new Map(prev.map((i) => [i.id, i]));
      return shots.map((s) => byId.get(s.id) ?? { ...s, status: 'waiting', uncertain: new Set() });
    });
  }, [shots]);

  // thumbnails (each made once: the effect re-runs on every item change)
  const thumbs = useRef(new Set<string>());
  useEffect(() => {
    for (const it of items) {
      if (it.preview || thumbs.current.has(it.id)) continue;
      thumbs.current.add(it.id);
      void toJpeg(it.canvas, 0.6).then((b) => {
        const url = URL.createObjectURL(b);
        urls.current.push(url);
        setItems((list) => list.map((x) => (x.id === it.id && !x.preview ? { ...x, preview: url } : x)));
      });
    }
  }, [items]);
  const urls = useRef<string[]>([]);
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);

  // OCR, one card at a time (one Tesseract worker)
  const running = useRef(false);
  useEffect(() => {
    if (running.current) return;
    const next = items.find((i) => i.status === 'waiting' && !started.current.has(i.id));
    if (!next) return;
    running.current = true;
    started.current.add(next.id);
    setItems((list) => list.map((x) => (x.id === next.id ? { ...x, status: 'reading' } : x)));
    void (async () => {
      try {
        const res = await readCard(next.canvas);
        const uncertain = new Set<ParsedField>();
        if (res.source !== 'qr') for (const [k, v] of Object.entries(res.confidence)) if (v < LOW_CONFIDENCE) uncertain.add(k as ParsedField);
        const form = applyEvent({ ...res.contact, metOn: res.contact.metOn ?? today() }, event);
        setItems((list) => list.map((x) => (x.id === next.id ? { ...x, status: 'ready', form, uncertain } : x)));
      } catch (err) {
        setItems((list) =>
          list.map((x) => (x.id === next.id ? { ...x, status: 'ready', form: applyEvent(blankForm(), event), uncertain: new Set(), error: `Lettura non riuscita: ${(err as Error).message}` } : x)),
        );
      } finally {
        running.current = false;
        setItems((list) => [...list]); // wake the effect for the next card
      }
    })();
  }, [items, event]);

  const ready = items.filter((i) => i.status === 'ready');
  const reading = items.filter((i) => i.status === 'waiting' || i.status === 'reading').length;
  const empty = (f?: ContactInput) => !f || !(f.firstName || f.lastName || f.company || f.emails.length || f.phones.length);

  async function saveAll() {
    setSaving(true);
    let saved = 0;
    let queued = 0;
    let dupes = 0;
    let failed = 0;
    for (const it of items) {
      if (it.status !== 'ready' || empty(it.form)) continue;
      try {
        const out = await createContact(it.form!, { front: await toJpeg(it.canvas) }, status === 'offline');
        if (out.kind === 'queued') queued++;
        else {
          saved++;
          if (out.duplicates.length) dupes++;
        }
        setItems((list) => list.map((x) => (x.id === it.id ? { ...x, status: 'saved' } : x)));
      } catch (err) {
        failed++;
        setItems((list) => list.map((x) => (x.id === it.id ? { ...x, error: errorMessage(err) } : x)));
      }
    }
    await qc.invalidateQueries({ queryKey: ['contacts'] });
    setSaving(false);
    const parts = [saved && `${saved} salvati`, queued && `${queued} in attesa di rete`, dupes && `${dupes} con un possibile duplicato da verificare`].filter(Boolean);
    if (parts.length) toast(parts.join(', '), dupes ? 'info' : 'success');
    // all done: back to the wallet; otherwise stay on the cards that failed
    if (saved + queued > 0 && !failed) navigate('/', { replace: true });
  }

  const update = (id: string, form: ContactInput) => setItems((list) => list.map((x) => (x.id === id ? { ...x, form } : x)));

  return (
    <div className="stack">
      <div className="spread">
        <h2>
          {items.length} {items.length === 1 ? 'biglietto' : 'biglietti'}
        </h2>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onMore} disabled={saving}>
          Scatta altri
        </button>
      </div>
      {reading > 0 && (
        <div aria-live="polite" className="stack-sm">
          <p className="muted small" style={{ margin: 0 }}>
            Lettura sul dispositivo: {items.length - reading} di {items.length}…
          </p>
          <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={items.length} aria-valuenow={items.length - reading}>
            <span style={{ width: `${Math.round(((items.length - reading) / Math.max(1, items.length)) * 100)}%` }} />
          </div>
        </div>
      )}
      {event && <p className="muted small" style={{ margin: 0 }}>Evento: {event.name} — aggiunto a tutti.</p>}

      <ul className="batch-list">
        {items.map((it, n) => {
          const f = it.form;
          const isOpen = open === it.id;
          return (
            <li key={it.id} className={`batch-item${it.status === 'saved' ? ' is-saved' : ''}`}>
              <div className="batch-row">
                <span className="batch-thumb">{it.preview ? <img src={it.preview} alt="" /> : null}</span>
                <span className="batch-text">
                  {it.status === 'waiting' || it.status === 'reading' ? (
                    <span className="muted">{it.status === 'reading' ? 'Lettura…' : 'In coda'}</span>
                  ) : (
                    <>
                      <strong>{f && !empty(f) ? displayName(f) : `Biglietto ${n + 1}: nessun dato letto`}</strong>
                      <span className="muted small">{[f?.jobTitle, f?.company].filter(Boolean).join(' · ') || f?.emails[0] || ''}</span>
                    </>
                  )}
                  {it.uncertain.size > 0 && it.status === 'ready' && (
                    <span className="small text-warning">
                      <WarningCircle size={14} aria-hidden="true" /> {it.uncertain.size} {it.uncertain.size === 1 ? 'campo incerto' : 'campi incerti'}
                    </span>
                  )}
                  {it.error && <span className="field-error">{it.error}</span>}
                </span>
                {it.status === 'saved' ? (
                  <CheckCircle size={24} weight="fill" className="text-success" aria-label="Salvato" />
                ) : (
                  <span className="inline">
                    {it.status === 'ready' && (
                      <button
                        type="button"
                        className="icon-btn"
                        aria-expanded={isOpen}
                        aria-label={`${isOpen ? 'Chiudi' : 'Controlla'} biglietto ${n + 1}`}
                        onClick={() => setOpen(isOpen ? null : it.id)}
                      >
                        {isOpen ? <CaretUp size={20} /> : <CaretDown size={20} />}
                      </button>
                    )}
                    <button type="button" className="icon-btn" aria-label={`Scarta biglietto ${n + 1}`} disabled={saving} onClick={() => onRemove(it.id)}>
                      <Trash size={20} />
                    </button>
                  </span>
                )}
              </div>
              {isOpen && f && it.status === 'ready' && (
                <div className="batch-form">
                  {it.preview && <img className="photo" src={it.preview} alt={`Biglietto ${n + 1}`} />}
                  <ContactForm value={f} onChange={(v) => update(it.id, v)} uncertain={it.uncertain} />
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <div className="form-actions no-nav">
        <span className="muted small">{ready.filter((i) => !empty(i.form)).length} pronti</span>
        <button type="button" className="btn btn-primary" disabled={saving || reading > 0 || !ready.some((i) => !empty(i.form))} onClick={() => void saveAll()}>
          {saving ? 'Salvataggio…' : reading > 0 ? 'Lettura in corso…' : 'Salva tutti'}
        </button>
      </div>
    </div>
  );
}
