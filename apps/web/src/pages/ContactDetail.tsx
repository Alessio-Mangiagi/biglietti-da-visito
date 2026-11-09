import { displayName, formatPhone, SOCIAL_LABELS, toHref, toVCard, type Contact } from '@cardvault/shared';
import {
  AddressBook,
  ArrowLeft,
  Envelope,
  MapPin,
  PencilSimple,
  Phone,
  ShareNetwork,
  Star,
  Trash,
  UsersThree,
  DownloadSimple,
} from '@phosphor-icons/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { BusinessCard } from '../components/BusinessCard';
import { DuplicateDialog } from '../components/DuplicateDialog';
import { Modal } from '../components/Modal';
import { useToast } from '../components/Toasts';
import { api, errorMessage, saveBlob } from '../lib/api';
import { useContact, useContactImage } from '../lib/contacts';
import type { Duplicate } from '../lib/save';

const PHONE_LABEL = { mobile: 'Cellulare', work: 'Ufficio', home: 'Casa', fax: 'Fax', other: 'Telefono' } as const;

export function ContactDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const contact = useContact(id);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showDups, setShowDups] = useState(false);
  const [busy, setBusy] = useState(false);

  const dups = useQuery({
    queryKey: ['contacts', 'dups', id],
    enabled: !!contact.data,
    queryFn: () => api.get<Duplicate[]>(`/contacts/${id}/duplicates`),
  });

  if (contact.isLoading) {
    return (
      <div className="detail-hero" aria-busy="true">
        <div className="skeleton" style={{ aspectRatio: '1.586', borderRadius: 14 }} />
        <div className="skeleton" style={{ height: 64 }} />
      </div>
    );
  }
  if (contact.isError || !contact.data) {
    return (
      <div className="empty">
        <p>{errorMessage(contact.error) || 'Contatto non trovato'}</p>
        <Link to="/" className="btn btn-secondary">
          Torna al wallet
        </Link>
      </div>
    );
  }
  const c = contact.data;
  const mainPhone = c.phones.find((p) => p.type === 'mobile') ?? c.phones.find((p) => p.type !== 'fax');
  const address = [c.address.street, [c.address.postalCode, c.address.city, c.address.province && `(${c.address.province})`].filter(Boolean).join(' '), c.address.country]
    .filter(Boolean)
    .join(', ');

  async function toggleFavorite() {
    const updated = await api.patch<Contact>(`/contacts/${c.id}`, { favorite: !c.favorite });
    qc.setQueryData(['contacts', 'one', c.id], updated);
    void qc.invalidateQueries({ queryKey: ['contacts', 'wallet'] });
  }

  async function remove() {
    setBusy(true);
    try {
      await api.delete(`/contacts/${c.id}`);
      await qc.invalidateQueries({ queryKey: ['contacts'] });
      toast('Contatto eliminato');
      navigate('/', { replace: true });
    } catch (err) {
      toast(errorMessage(err), 'error');
      setBusy(false);
    }
  }

  /** iPhone: Contacts only opens a vCard reached by navigation, so ask for a short signed link. */
  async function addToPhone() {
    try {
      const { url } = await api.post<{ url: string }>(`/contacts/${c.id}/vcard-link`);
      window.location.href = url;
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  }

  async function share() {
    const vcf = toVCard(c, '3.0');
    const file = new File([vcf], `${displayName(c)}.vcf`, { type: 'text/vcard' });
    try {
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: displayName(c) });
      else if (navigator.share) await navigator.share({ title: displayName(c), text: summary(c) });
      else {
        await navigator.clipboard.writeText(summary(c));
        toast('Dati copiati negli appunti');
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') toast('Condivisione non riuscita', 'error');
    }
  }

  return (
    <>
      <div className="spread" style={{ marginBottom: '0.75rem' }}>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => (history.length > 1 ? navigate(-1) : navigate('/'))}>
          <ArrowLeft size={18} /> Indietro
        </button>
        <div className="inline">
          <button type="button" className="icon-btn" aria-pressed={c.favorite} aria-label={c.favorite ? 'Togli dai preferiti' : 'Aggiungi ai preferiti'} onClick={() => void toggleFavorite()}>
            <Star size={22} weight={c.favorite ? 'fill' : 'regular'} />
          </button>
          <Link to={`/contatti/${c.id}/modifica`} className="btn btn-secondary btn-sm">
            <PencilSimple size={16} /> Modifica
          </Link>
        </div>
      </div>

      <div className="detail-hero">
        <div style={{ viewTransitionName: `card-${c.id}` }}>
          <BusinessCard contact={c} />
        </div>
        <nav className="detail-actions" aria-label="Azioni rapide">
          <a href={mainPhone ? `tel:${mainPhone.value.replace(/[^\d+]/g, '')}` : undefined} aria-disabled={!mainPhone}>
            <Phone size={22} /> Chiama
          </a>
          <a href={c.emails[0] ? `mailto:${c.emails[0]}` : undefined} aria-disabled={!c.emails[0]}>
            <Envelope size={22} /> Email
          </a>
          <a href={address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}` : undefined} target="_blank" rel="noopener noreferrer" aria-disabled={!address}>
            <MapPin size={22} /> Mappa
          </a>
          <button type="button" onClick={() => void addToPhone()}>
            <AddressBook size={22} /> Rubrica
          </button>
        </nav>
      </div>

      {dups.data && dups.data.length > 0 && (
        <div className="alert alert-warning spread" style={{ maxWidth: 560, margin: '0 auto 1rem' }}>
          <span className="inline">
            <UsersThree size={20} /> Possibile duplicato di {dups.data[0]!.name}
          </span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowDups(true)}>
            Verifica
          </button>
        </div>
      )}

      <div className="stack" style={{ maxWidth: 560, margin: '0 auto' }}>
        <section className="panel panel-flush" aria-label="Dettagli">
          <dl className="kv">
            {c.jobTitle && <Row k="Ruolo" v={c.jobTitle} />}
            {c.company && <Row k="Azienda" v={c.company} />}
            {c.phones.map((p, i) => (
              <Row key={`p${i}`} k={PHONE_LABEL[p.type]} v={<a href={`tel:${p.value.replace(/[^\d+]/g, '')}`}>{formatPhone(p.value)}</a>} />
            ))}
            {c.emails.map((e) => (
              <Row key={e} k="Email" v={<a href={`mailto:${e}`}>{e}</a>} />
            ))}
            {c.website && <Row k="Sito" v={<a href={toHref(c.website)} target="_blank" rel="noopener noreferrer">{c.website}</a>} />}
            {c.socials.map((s) => (
              <Row key={s.value} k={SOCIAL_LABELS[s.network]} v={<a href={toHref(s.value)} target="_blank" rel="noopener noreferrer">{s.value}</a>} />
            ))}
            {address && <Row k="Indirizzo" v={address} />}
            {(c.metAt || c.metOn) && (
              <Row k="Incontro" v={[c.metAt, c.metOn && new Date(`${c.metOn}T12:00:00`).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' })].filter(Boolean).join(' · ')} />
            )}
            {c.tags.length > 0 && (
              <Row k="Tag" v={<span className="inline">{c.tags.map((t) => <Link key={t} to={`/cerca?tag=${encodeURIComponent(t)}`} className="tag">{t}</Link>)}</span>} />
            )}
            {c.notes && <Row k="Note" v={<span style={{ whiteSpace: 'pre-wrap' }}>{c.notes}</span>} />}
          </dl>
        </section>

        {(c.hasFront || c.hasBack) && <Photos contact={c} />}

        <div className="inline">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void share()}>
            <ShareNetwork size={18} /> Condividi
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => saveBlob(new Blob([toVCard(c, '4.0')], { type: 'text/vcard' }), `${displayName(c)}.vcf`)}>
            <DownloadSimple size={18} /> Scarica vCard
          </button>
          <button type="button" className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)', marginLeft: 'auto' }} onClick={() => setConfirmDelete(true)}>
            <Trash size={18} /> Elimina
          </button>
        </div>
        <p className="muted small">
          Aggiunto il {new Date(c.createdAt).toLocaleDateString('it-IT')}
          {c.updatedAt !== c.createdAt && ` · modificato il ${new Date(c.updatedAt).toLocaleDateString('it-IT')}`}
        </p>
      </div>

      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Eliminare il contatto?"
        actions={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setConfirmDelete(false)}>
              Annulla
            </button>
            <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void remove()}>
              Elimina
            </button>
          </>
        }
      >
        <p>
          {displayName(c)} e le foto del biglietto verranno eliminati definitivamente.
        </p>
      </Modal>

      {showDups && dups.data && (
        <DuplicateDialog
          newId={c.id}
          duplicates={dups.data}
          onDone={(keptId, merged) => {
            setShowDups(false);
            void qc.invalidateQueries({ queryKey: ['contacts'] });
            if (merged) {
              toast('Contatti uniti');
              navigate(`/contatti/${keptId}`, { replace: true });
            }
          }}
        />
      )}
    </>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <>
      <dt>{k}</dt>
      <dd>{v}</dd>
    </>
  );
}

function Photos({ contact }: { contact: Contact }) {
  const [side, setSide] = useState<'front' | 'back'>(contact.hasFront ? 'front' : 'back');
  const img = useContactImage(contact.id, side, side === 'front' ? contact.hasFront : contact.hasBack, contact.updatedAt);
  return (
    <section className="panel stack-sm" aria-label="Foto del biglietto">
      <div className="spread">
        <h2 style={{ fontSize: '1.1rem' }}>Foto</h2>
        {contact.hasFront && contact.hasBack && (
          <div className="photo-tabs" role="tablist">
            {(['front', 'back'] as const).map((s) => (
              <button key={s} type="button" role="tab" className="chip" aria-selected={side === s} onClick={() => setSide(s)}>
                {s === 'front' ? 'Fronte' : 'Retro'}
              </button>
            ))}
          </div>
        )}
      </div>
      {img.url ? (
        <img className="photo" src={img.url} alt={`${side === 'front' ? 'Fronte' : 'Retro'} del biglietto`} />
      ) : img.error ? (
        <p className="muted small">Foto non disponibile offline.</p>
      ) : (
        <div className="skeleton" style={{ aspectRatio: '1.586' }} />
      )}
    </section>
  );
}

function summary(c: Contact): string {
  return [
    [c.prefix, c.firstName, c.lastName].filter(Boolean).join(' '),
    [c.jobTitle, c.company].filter(Boolean).join(' – '),
    ...c.phones.map((p) => p.value),
    ...c.emails,
    c.website,
  ]
    .filter(Boolean)
    .join('\n');
}
