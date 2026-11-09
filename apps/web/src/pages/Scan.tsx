import { LOW_CONFIDENCE, mergeParsed, parseCard, type ParsedField, type ParseResult } from '@cardvault/parser';
import type { ContactInput } from '@cardvault/shared';
import { ArrowLeft, Camera as CameraIcon, CaretRight, QrCode } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Camera, type Capture } from '../components/Camera';
import { ContactForm } from '../components/ContactForm';
import { CropEditor } from '../components/CropEditor';
import { DuplicateDialog } from '../components/DuplicateDialog';
import { Modal } from '../components/Modal';
import { useToast } from '../components/Toasts';
import { errorMessage } from '../lib/api';
import { createContact, today, type Duplicate } from '../lib/save';
import { useSession } from '../lib/session';
import type { Quad } from '../scan/geometry';
import { findCard, imageDataOf, ocrCanvas, rotate, toJpeg, warp } from '../scan/image';
import { recognize, warmUpOcr, type OcrProgress } from '../scan/ocr';
import { findContactQr } from '../scan/qr';

type Side = 'front' | 'back';
type Step = 'camera' | 'crop' | 'back-prompt' | 'processing' | 'review';

interface Raw {
  canvas: HTMLCanvasElement;
  quad: Quad;
  detected: boolean;
}

const STEP_LABELS = ['Scatto', 'Ritaglio', 'Lettura', 'Revisione'];
const stepIndex = (s: Step) => ({ camera: 0, crop: 1, 'back-prompt': 1, processing: 2, review: 3 })[s];

/** How many useful fields a parse found — used to pick the better orientation. */
const score = (r: ParseResult) =>
  (r.contact.firstName || r.contact.lastName ? 2 : 0) +
  (r.contact.company ? 1 : 0) +
  r.contact.emails.length * 2 +
  r.contact.phones.length * 2 +
  (r.contact.website ? 1 : 0);

export default function ScanPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const { status } = useSession();

  const [step, setStep] = useState<Step>('camera');
  const [side, setSide] = useState<Side>('front');
  const [raw, setRaw] = useState<Raw | null>(null);
  const [cropped, setCropped] = useState<Partial<Record<Side, HTMLCanvasElement>>>({});
  const [qrFound, setQrFound] = useState<ParseResult | null>(null);
  const [progress, setProgress] = useState<{ label: string; value: number }>({ label: '', value: 0 });
  const [result, setResult] = useState<ParseResult | null>(null);
  const [form, setForm] = useState<ContactInput | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [dups, setDups] = useState<{ id: string; list: Duplicate[] } | null>(null);
  const [confirmExit, setConfirmExit] = useState(false);
  const previews = usePreviews(cropped);

  useEffect(() => warmUpOcr(), []);

  // --------------------------------------------------------------- capture
  function onCapture({ canvas, guide }: Capture) {
    setError('');
    // a vCard QR anywhere in the frame beats OCR
    const qr = findContactQr(imageDataOf(canvas));
    if (qr && side === 'front') setQrFound(qr);
    const { quad, detected } = findCard(canvas, guide);
    setRaw({ canvas, quad, detected });
    setStep('crop');
  }

  function rotateRaw() {
    if (!raw) return;
    const h = raw.canvas.height;
    const q = raw.quad.map((p) => ({ x: h - p.y, y: p.x })) as Quad;
    // keep top-left first after a clockwise turn
    setRaw({ canvas: rotate(raw.canvas, 90), quad: [q[3], q[0], q[1], q[2]], detected: raw.detected });
  }

  function confirmCrop() {
    if (!raw) return;
    const out = warp(raw.canvas, raw.quad);
    const next = { ...cropped, [side]: out };
    setCropped(next);
    setRaw(null);
    if (side === 'front') setStep('back-prompt');
    else void processAll(next);
  }

  // --------------------------------------------------------------- OCR
  async function readSide(canvas: HTMLCanvasElement, label: string): Promise<ParseResult> {
    const report = (p: OcrProgress) =>
      setProgress({ label: p.stage === 'load' ? 'Preparo il riconoscimento del testo…' : label, value: p.stage === 'load' ? p.progress * 0.2 : 0.2 + p.progress * 0.8 });
    const qr = findContactQr(imageDataOf(canvas));
    if (qr) return qr;
    let best = parseCard(await recognize(ocrCanvas(canvas), report));
    if (score(best) < 3) {
      // maybe upside down
      setProgress({ label: 'Provo a girare la foto…', value: 0.5 });
      const flipped = parseCard(await recognize(ocrCanvas(rotate(canvas, 180)), report));
      if (score(flipped) > score(best)) best = flipped;
    }
    return best;
  }

  async function processAll(sides: Partial<Record<Side, HTMLCanvasElement>>) {
    setStep('processing');
    setError('');
    try {
      let res: ParseResult;
      if (qrFound) {
        res = qrFound;
      } else {
        res = await readSide(sides.front!, 'Leggo il fronte…');
      }
      if (sides.back) {
        const back = await readSide(sides.back, 'Leggo il retro…');
        res = mergeParsed(res, back);
      }
      setResult(res);
      setForm({ ...res.contact, metOn: res.contact.metOn ?? today() });
      setStep('review');
    } catch (err) {
      setError(`Lettura non riuscita: ${(err as Error).message}. Puoi compilare i campi a mano.`);
      setResult({ contact: {} as ContactInput, confidence: {}, leftovers: [], source: 'ocr' });
      setForm(emptyForm());
      setStep('review');
    }
  }

  const uncertain = useMemo(() => {
    const s = new Set<ParsedField>();
    if (!result || result.source === 'qr') return s;
    for (const [k, v] of Object.entries(result.confidence)) if (v < LOW_CONFIDENCE) s.add(k as ParsedField);
    return s;
  }, [result]);

  // --------------------------------------------------------------- save
  async function save() {
    if (!form) return;
    setSaving(true);
    setError('');
    try {
      const photos = {
        front: cropped.front ? await toJpeg(cropped.front) : undefined,
        back: cropped.back ? await toJpeg(cropped.back) : undefined,
      };
      const out = await createContact(form, photos, status === 'offline');
      await qc.invalidateQueries({ queryKey: ['contacts'] });
      if (out.kind === 'queued') {
        toast('Salvato sul dispositivo: verrà sincronizzato appena torni online.', 'info');
        navigate('/', { replace: true });
      } else if (out.duplicates.length) {
        setDups({ id: out.contact.id, list: out.duplicates });
      } else {
        toast('Contatto salvato');
        navigate(`/contatti/${out.contact.id}`, { replace: true });
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const dirty = step !== 'camera' || !!cropped.front;
  const exit = () => (dirty ? setConfirmExit(true) : navigate(-1));

  // --------------------------------------------------------------- render
  if (step === 'camera') {
    return (
      <Camera
        side={side}
        onCapture={onCapture}
        onClose={() => (cropped.front ? setStep('back-prompt') : navigate(-1))}
        onError={(m) => setError(m)}
      />
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-inner">
          <button type="button" className="icon-btn" aria-label="Esci dalla scansione" onClick={exit}>
            <ArrowLeft size={22} />
          </button>
          <h1 style={{ fontSize: '1.15rem' }}>Nuovo biglietto</h1>
        </div>
      </header>
      <main className="main main-narrow" style={{ paddingBottom: 'calc(var(--safe-bottom) + 2rem)' }}>
        <ol className="steps" aria-label="Avanzamento">
          {STEP_LABELS.map((l, i) => (
            <li key={l} aria-current={stepIndex(step) === i ? 'step' : undefined} className={stepIndex(step) > i ? 'done' : undefined}>
              {l}
            </li>
          ))}
        </ol>

        {error && (
          <div className="alert alert-error" role="alert" style={{ marginBottom: '1rem' }}>
            {error}
          </div>
        )}

        {step === 'crop' && raw && (
          <>
            <h2 style={{ marginBottom: '0.75rem' }}>Ritaglia il {side === 'front' ? 'fronte' : 'retro'}</h2>
            <CropEditor
              image={raw.canvas}
              quad={raw.quad}
              detected={raw.detected}
              onChange={(quad) => setRaw({ ...raw, quad })}
              onRotate={rotateRaw}
              onAuto={() => setRaw({ ...raw, ...findCard(raw.canvas) })}
              onConfirm={confirmCrop}
            />
            <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: '0.75rem' }} onClick={() => setStep('camera')}>
              <CameraIcon size={16} /> Rifai la foto
            </button>
          </>
        )}

        {step === 'back-prompt' && (
          <div className="stack">
            <h2>Il biglietto ha un retro?</h2>
            {qrFound && (
              <div className="alert alert-success inline">
                <QrCode size={20} /> Trovato un QR con i dati del contatto: i campi saranno esatti.
              </div>
            )}
            <div className="thumbs">
              <figure className="thumb" style={{ margin: 0 }}>
                {previews.front && <img src={previews.front} alt="Fronte ritagliato" />}
              </figure>
              <button type="button" className="thumb" style={{ cursor: 'pointer' }} onClick={() => (setSide('back'), setStep('camera'))}>
                <span className="inline">
                  <CameraIcon size={20} /> Scatta il retro
                </span>
              </button>
            </div>
            <p className="muted small">Il retro aiuta quando indirizzo, telefoni o social sono stampati dietro.</p>
            <div className="spread">
              <button type="button" className="btn btn-secondary" onClick={() => (setSide('back'), setStep('camera'))}>
                Scatta il retro
              </button>
              <button type="button" className="btn btn-primary" onClick={() => void processAll(cropped)}>
                Continua <CaretRight size={16} />
              </button>
            </div>
          </div>
        )}

        {step === 'processing' && (
          <div className="stack" aria-live="polite" aria-busy="true">
            <h2>Lettura del biglietto</h2>
            <p className="muted">{progress.label || 'Avvio…'}</p>
            <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress.value * 100)}>
              <span style={{ width: `${Math.round(progress.value * 100)}%` }} />
            </div>
            <p className="muted small">Il testo viene riconosciuto su questo dispositivo. La prima volta il motore OCR (circa 12 MB) viene scaricato e poi resta disponibile anche offline.</p>
            {previews.front && <img className="photo" src={previews.front} alt="" />}
          </div>
        )}

        {step === 'review' && form && (
          <div className="stack">
            <div className="spread">
              <h2>Controlla i dati</h2>
              {result?.source === 'qr' && (
                <span className="tag">
                  <QrCode size={14} /> da QR
                </span>
              )}
            </div>
            {uncertain.size > 0 && (
              <div className="alert alert-warning">
                I campi evidenziati sono stati letti con poca sicurezza: verificali prima di salvare.
              </div>
            )}
            {(previews.front || previews.back) && (
              <div className="thumbs">
                {(['front', 'back'] as const).map((s) =>
                  previews[s] ? (
                    <figure key={s} className="thumb" style={{ margin: 0 }}>
                      <img src={previews[s]} alt={s === 'front' ? 'Fronte' : 'Retro'} />
                    </figure>
                  ) : null,
                )}
              </div>
            )}
            {result && result.leftovers.length > 0 && (
              <div className="field">
                <span className="label">Altro testo trovato</span>
                <div className="inline">
                  {result.leftovers.map((l) => (
                    <button
                      key={l}
                      type="button"
                      className="chip"
                      title="Aggiungi alle note"
                      onClick={() => {
                        setForm({ ...form, notes: [form.notes, l].filter(Boolean).join('\n') });
                        setResult({ ...result, leftovers: result.leftovers.filter((x) => x !== l) });
                      }}
                    >
                      + {l}
                    </button>
                  ))}
                </div>
                <span className="field-hint">Tocca per aggiungere alle note.</span>
              </div>
            )}
            <ContactForm value={form} onChange={setForm} uncertain={uncertain} />
            {form.ocrText && (
              <details className="panel">
                <summary className="label" style={{ cursor: 'pointer' }}>
                  Testo letto dal biglietto
                </summary>
                <pre className="mono small" style={{ whiteSpace: 'pre-wrap', margin: '0.75rem 0 0' }}>
                  {form.ocrText}
                </pre>
              </details>
            )}
            <div className="form-actions no-nav">
              <button type="button" className="btn btn-ghost" onClick={exit}>
                Annulla
              </button>
              <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void save()}>
                {saving ? 'Salvataggio…' : 'Salva contatto'}
              </button>
            </div>
          </div>
        )}
      </main>

      {dups && (
        <DuplicateDialog
          newId={dups.id}
          duplicates={dups.list}
          onDone={(id, merged) => {
            toast(merged ? 'Contatti uniti' : 'Contatto salvato');
            void qc.invalidateQueries({ queryKey: ['contacts'] });
            navigate(`/contatti/${id}`, { replace: true });
          }}
        />
      )}

      <Modal
        open={confirmExit}
        onClose={() => setConfirmExit(false)}
        title="Uscire dalla scansione?"
        actions={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setConfirmExit(false)}>
              Continua
            </button>
            <button type="button" className="btn btn-danger" onClick={() => navigate('/', { replace: true })}>
              Esci senza salvare
            </button>
          </>
        }
      >
        <p>Le foto e i dati letti andranno persi.</p>
      </Modal>
    </div>
  );
}

function emptyForm(): ContactInput {
  return {
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
  };
}

/** Object URLs of the cropped sides, revoked when they change. */
function usePreviews(c: Partial<Record<Side, HTMLCanvasElement>>) {
  const [urls, setUrls] = useState<Partial<Record<Side, string>>>({});
  const prev = useRef<Partial<Record<Side, string>>>({});
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next: Partial<Record<Side, string>> = {};
      for (const s of ['front', 'back'] as const) {
        const canvas = c[s];
        if (canvas) next[s] = URL.createObjectURL(await toJpeg(canvas, 0.7));
      }
      if (cancelled) return Object.values(next).forEach((u) => URL.revokeObjectURL(u!));
      Object.values(prev.current).forEach((u) => URL.revokeObjectURL(u!));
      prev.current = next;
      setUrls(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [c]);
  useEffect(() => () => Object.values(prev.current).forEach((u) => URL.revokeObjectURL(u!)), []);
  return urls;
}
