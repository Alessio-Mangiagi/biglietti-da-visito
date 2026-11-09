import { ContactInputSchema, displayName, toVCard, type Contact, type ContactInput } from '@cardvault/shared';
import { PencilSimple, ShareNetwork } from '@phosphor-icons/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { useEffect, useRef, useState } from 'react';
import { BusinessCard } from '../components/BusinessCard';
import { ContactForm } from '../components/ContactForm';
import { useToast } from '../components/Toasts';
import { api, errorMessage } from '../lib/api';
import { useSession } from '../lib/session';

/** What goes in the QR: identity and contacts only, so the code stays easy to scan. */
function qrPayload(c: ContactInput) {
  return toVCard({ ...c, notes: '', tags: [], metAt: '', metOn: null, ocrText: '' }, '3.0');
}

export function MyCardPage() {
  const { user } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const card = useQuery({ queryKey: ['me', 'card'], queryFn: () => api.get<{ card: Contact | null }>('/me/card') });
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<ContactInput | null>(null);
  const [busy, setBusy] = useState(false);

  const current = card.data?.card ?? null;

  function startEdit() {
    const base = current
      ? ContactInputSchema.parse(current)
      : ContactInputSchema.parse({
          firstName: user?.displayName.split(' ')[0] ?? '',
          lastName: user?.displayName.split(' ').slice(1).join(' ') ?? '',
          emails: user ? [user.email] : [],
        });
    setForm(base);
    setEditing(true);
  }

  async function save() {
    if (!form) return;
    setBusy(true);
    try {
      const saved = await api.put<Contact>('/me/card', form);
      qc.setQueryData(['me', 'card'], { card: saved });
      setEditing(false);
      toast('Biglietto salvato');
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function share(c: ContactInput) {
    const file = new File([toVCard(c, '3.0')], `${displayName(c)}.vcf`, { type: 'text/vcard' });
    try {
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: displayName(c) });
      else if (navigator.share) await navigator.share({ title: displayName(c), text: qrPayload(c) });
      else toast('Condivisione non supportata da questo browser', 'info');
    } catch (err) {
      if ((err as Error).name !== 'AbortError') toast('Condivisione non riuscita', 'error');
    }
  }

  if (card.isLoading) return <div className="skeleton" style={{ aspectRatio: '1.586', maxWidth: 560, margin: '0 auto' }} />;
  if (card.isError) return <div className="alert alert-error">{errorMessage(card.error)}</div>;

  if (editing && form) {
    return (
      <div className="main-narrow stack" style={{ margin: '0 auto' }}>
        <h1>Il mio biglietto</h1>
        <div style={{ maxWidth: 420 }}>
          <BusinessCard contact={form} tone="navy" />
        </div>
        <ContactForm value={form} onChange={setForm} selfCard />
        <div className="spread">
          <button type="button" className="btn btn-ghost" onClick={() => setEditing(false)}>
            Annulla
          </button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()}>
            Salva biglietto
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="stack" style={{ maxWidth: 560, margin: '0 auto' }}>
      <div className="page-head">
        <div>
          <p className="eyebrow">Condividi</p>
          <h1>Il mio biglietto</h1>
        </div>
      </div>
      {current ? (
        <>
          <BusinessCard contact={current} tone="navy" />
          <QrCard text={qrPayload(current)} />
          <p className="muted small" style={{ textAlign: 'center' }}>
            Fai inquadrare il codice con la fotocamera: il telefono propone di salvare il contatto, senza app.
          </p>
          <div className="inline" style={{ justifyContent: 'center' }}>
            <button type="button" className="btn btn-primary" onClick={() => void share(current)}>
              <ShareNetwork size={18} /> Condividi vCard
            </button>
            <button type="button" className="btn btn-secondary" onClick={startEdit}>
              <PencilSimple size={18} /> Modifica
            </button>
          </div>
        </>
      ) : (
        <div className="empty">
          <h2>Crea il tuo biglietto digitale</h2>
          <p className="muted" style={{ maxWidth: '42ch' }}>
            Compila i tuoi dati una volta: otterrai un QR da mostrare a chi incontri e un file vCard da inviare.
          </p>
          <button type="button" className="btn btn-primary" onClick={startEdit}>
            Crea il mio biglietto
          </button>
        </div>
      )}
    </div>
  );
}

function QrCard({ text }: { text: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!ref.current) return;
    QRCode.toCanvas(ref.current, text, { errorCorrectionLevel: 'M', margin: 2, width: 520, color: { dark: '#0c4577', light: '#ffffff' } }).catch(() =>
      setError(true),
    );
  }, [text]);
  return (
    <div className="qr panel" role="img" aria-label="Codice QR con il tuo biglietto">
      {error ? <p className="muted">Troppi dati per un QR: accorcia i campi.</p> : <canvas ref={ref} />}
    </div>
  );
}
