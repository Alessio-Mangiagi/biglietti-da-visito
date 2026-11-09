import { ContactInputSchema, type Contact, type ContactInput } from '@cardvault/shared';
import { ArrowLeft, Trash, UploadSimple } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ContactForm } from '../components/ContactForm';
import { DuplicateDialog } from '../components/DuplicateDialog';
import { useToast } from '../components/Toasts';
import { api, errorMessage, fieldErrors } from '../lib/api';
import { useContact } from '../lib/contacts';
import { uploadPhoto } from '../lib/outbox';
import { createContact, today, type Duplicate } from '../lib/save';
import { useSession } from '../lib/session';
import { findCard, loadImage, toJpeg, warp } from '../scan/image';

const blank = (): ContactInput => ({ ...ContactInputSchema.parse({}), metOn: today() });

export function ContactEditPage() {
  const { id } = useParams();
  const isNew = !id;
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const { status } = useSession();
  const existing = useContact(id);
  const [form, setForm] = useState<ContactInput | null>(isNew ? blank() : null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [dups, setDups] = useState<{ id: string; list: Duplicate[] } | null>(null);

  useEffect(() => {
    if (existing.data && !form) setForm(ContactInputSchema.parse(existing.data));
  }, [existing.data, form]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    const parsed = ContactInputSchema.safeParse(form);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), i.message])));
      setError('Controlla i campi evidenziati.');
      return;
    }
    setBusy(true);
    setError('');
    setErrors({});
    try {
      if (isNew) {
        const out = await createContact(parsed.data, {}, status === 'offline');
        await qc.invalidateQueries({ queryKey: ['contacts'] });
        if (out.kind === 'queued') {
          toast('Salvato sul dispositivo: verrà sincronizzato appena torni online.', 'info');
          navigate('/', { replace: true });
        } else if (out.duplicates.length) setDups({ id: out.contact.id, list: out.duplicates });
        else {
          toast('Contatto salvato');
          navigate(`/contatti/${out.contact.id}`, { replace: true });
        }
      } else {
        const saved = await api.put<Contact>(`/contacts/${id}`, parsed.data);
        qc.setQueryData(['contacts', 'one', id], saved);
        await qc.invalidateQueries({ queryKey: ['contacts'] });
        toast('Modifiche salvate');
        navigate(`/contatti/${id}`, { replace: true });
      }
    } catch (err) {
      setErrors(fieldErrors(err));
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!isNew && existing.isError) {
    return (
      <div className="empty">
        <p>{errorMessage(existing.error)}</p>
        <Link to="/" className="btn btn-secondary">
          Torna al wallet
        </Link>
      </div>
    );
  }
  if (!form) return <div className="skeleton" style={{ height: 400 }} aria-busy="true" />;

  return (
    <form className="main-narrow stack" style={{ margin: '0 auto' }} onSubmit={submit} noValidate>
      <div className="spread">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate(-1)}>
          <ArrowLeft size={18} /> Indietro
        </button>
      </div>
      <h1>{isNew ? 'Nuovo contatto' : 'Modifica contatto'}</h1>
      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}
      <ContactForm value={form} onChange={setForm} errors={errors} />
      {!isNew && existing.data && <PhotoManager contact={existing.data} />}
      <div className="spread" style={{ position: 'sticky', bottom: 'calc(var(--bottomnav-h) + var(--safe-bottom))', padding: '0.75rem 0', background: 'var(--bg)' }}>
        <button type="button" className="btn btn-ghost" onClick={() => navigate(-1)}>
          Annulla
        </button>
        <button className="btn btn-primary" disabled={busy}>
          {busy ? 'Salvataggio…' : 'Salva contatto'}
        </button>
      </div>
      {dups && (
        <DuplicateDialog
          newId={dups.id}
          duplicates={dups.list}
          onDone={(keptId, merged) => {
            toast(merged ? 'Contatti uniti' : 'Contatto salvato');
            void qc.invalidateQueries({ queryKey: ['contacts'] });
            navigate(`/contatti/${keptId}`, { replace: true });
          }}
        />
      )}
    </form>
  );
}

/** Replace or remove the stored photos without going through the scanner. */
function PhotoManager({ contact }: { contact: Contact }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function upload(side: 'front' | 'back', file?: File) {
    if (!file) return;
    setBusy(true);
    try {
      const canvas = await loadImage(file);
      const { quad, detected } = findCard(canvas);
      await uploadPhoto(contact.id, side, await toJpeg(detected ? warp(canvas, quad) : canvas));
      await qc.invalidateQueries({ queryKey: ['contacts'] });
      toast('Foto aggiornata');
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function remove(side: 'front' | 'back') {
    setBusy(true);
    try {
      await api.delete(`/contacts/${contact.id}/images/${side}`);
      await qc.invalidateQueries({ queryKey: ['contacts'] });
      toast('Foto rimossa');
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <fieldset className="panel stack" style={{ border: '1px solid var(--border)', margin: 0 }}>
      <legend className="eyebrow" style={{ padding: '0 0.4rem' }}>
        Foto del biglietto
      </legend>
      {(['front', 'back'] as const).map((side) => {
        const has = side === 'front' ? contact.hasFront : contact.hasBack;
        return (
          <div key={side} className="spread">
            <span>
              {side === 'front' ? 'Fronte' : 'Retro'} <span className="muted small">{has ? '· presente' : '· assente'}</span>
            </span>
            <span className="inline">
              <label className="btn btn-ghost btn-sm" aria-disabled={busy}>
                <UploadSimple size={16} /> {has ? 'Sostituisci' : 'Carica'}
                <input type="file" accept="image/*" hidden disabled={busy} onChange={(e) => void upload(side, e.target.files?.[0])} />
              </label>
              {has && (
                <button type="button" className="icon-btn" aria-label={`Rimuovi foto ${side === 'front' ? 'fronte' : 'retro'}`} disabled={busy} onClick={() => void remove(side)}>
                  <Trash size={18} />
                </button>
              )}
            </span>
          </div>
        );
      })}
    </fieldset>
  );
}
