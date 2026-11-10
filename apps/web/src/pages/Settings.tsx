import { PASSWORD_MIN, type User } from '@cardvault/shared';
import { BellRinging, CaretRight, DownloadSimple, Flag, IdentificationCard, SignOut, UploadSimple, UsersThree } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import { EventDialog } from '../components/EventDialog';
import { Modal } from '../components/Modal';
import { useToast } from '../components/Toasts';
import { api, errorMessage, saveResponse } from '../lib/api';
import { useEventMode } from '../lib/event';
import { clearLocalData } from '../lib/idb';
import { useSession } from '../lib/session';
import { PushBox } from './FollowUps';
import { useOutbox } from './Wallet';

type Theme = 'system' | 'light' | 'dark';

function readTheme(): Theme {
  try {
    const t = localStorage.getItem('cv-theme');
    return t === 'light' || t === 'dark' ? t : 'system';
  } catch {
    return 'system';
  }
}

function applyTheme(t: Theme) {
  try {
    if (t === 'system') localStorage.removeItem('cv-theme');
    else localStorage.setItem('cv-theme', t);
  } catch {
    /* storage blocked: theme still applies for this session */
  }
  if (t === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
}

function Section({ id, title, children }: { id?: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="panel stack" aria-labelledby={`${id ?? title}-h`}>
      <h2 id={`${id ?? title}-h`} style={{ fontSize: '1.15rem' }}>
        {title}
      </h2>
      {children}
    </section>
  );
}

export function SettingsPage() {
  const { user, setUser, signOut } = useSession();
  const toast = useToast();
  const qc = useQueryClient();
  const pending = useOutbox();
  const { hash } = useLocation();
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [name, setName] = useState(user?.displayName ?? '');
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const [pwError, setPwError] = useState('');
  const [importing, setImporting] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deletePw, setDeletePw] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const { event, stop: stopEvent } = useEventMode();
  const [eventOpen, setEventOpen] = useState(false);

  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView({ block: 'start' });
  }, [hash]);

  async function saveName(e: FormEvent) {
    e.preventDefault();
    try {
      setUser(await api.patch<User>('/me', { displayName: name }));
      toast('Profilo aggiornato');
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  }

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    setPwError('');
    if (pw.newPassword.length < PASSWORD_MIN) return setPwError(`La nuova password deve avere almeno ${PASSWORD_MIN} caratteri`);
    try {
      await api.post('/auth/change-password', pw);
      setPw({ currentPassword: '', newPassword: '' });
      toast('Password cambiata. Le altre sessioni sono state chiuse.');
    } catch (err) {
      setPwError(errorMessage(err));
    }
  }

  async function importVcf(file?: File) {
    if (!file) return;
    setImporting(true);
    try {
      const res = await api.request<{ created: number; skipped: number; errors: unknown[] }>('/contacts/import', {
        method: 'POST',
        raw: await file.text(),
        contentType: 'text/vcard',
      });
      await qc.invalidateQueries({ queryKey: ['contacts'] });
      toast(
        `Importati ${res.created} contatti` +
          (res.skipped ? `, ${res.skipped} già presenti` : '') +
          (res.errors.length ? `, ${res.errors.length} non validi` : ''),
      );
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setImporting(false);
    }
  }

  async function download(path: string, name: string) {
    try {
      await saveResponse(await api.request<Response>(path, { response: true }), name);
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  }

  async function deleteAccount() {
    setDeleteError('');
    try {
      await api.delete('/me', { password: deletePw });
      await clearLocalData();
      api.setSession(null);
      qc.clear();
      await signOut();
    } catch (err) {
      setDeleteError(errorMessage(err));
    }
  }

  return (
    <div className="main-narrow stack" style={{ margin: '0 auto' }}>
      <h1>Impostazioni</h1>

      <nav className="panel panel-flush" aria-label="Scorciatoie">
        <ul className="menu-list">
          <li>
            <Link to="/il-mio-biglietto">
              <IdentificationCard size={22} aria-hidden="true" /> Il mio biglietto <CaretRight size={18} aria-hidden="true" />
            </Link>
          </li>
          <li>
            <Link to="/team?tutti">
              <UsersThree size={22} aria-hidden="true" /> Team <CaretRight size={18} aria-hidden="true" />
            </Link>
          </li>
          <li>
            <Link to="/promemoria">
              <BellRinging size={22} aria-hidden="true" /> Da ricontattare <CaretRight size={18} aria-hidden="true" />
            </Link>
          </li>
        </ul>
      </nav>

      <Section id="evento" title="Modalità evento">
        {event ? (
          <div className="spread">
            <span className="inline">
              <Flag size={20} weight="fill" aria-hidden="true" /> In corso: <strong>{event.name}</strong>
            </span>
            <button type="button" className="btn btn-secondary btn-sm" onClick={stopEvent}>
              Termina
            </button>
          </div>
        ) : (
          <div className="spread">
            <span className="muted small">Ai convegni e alle fiere: ogni nuovo biglietto prende nome, data e tag dell’evento.</span>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEventOpen(true)}>
              <Flag size={16} /> Attiva
            </button>
          </div>
        )}
        <EventDialog open={eventOpen} onClose={() => setEventOpen(false)} />
      </Section>

      <Section id="notifiche" title="Notifiche">
        <PushBox />
      </Section>

      <Section title="Profilo">
        <form className="stack" onSubmit={saveName}>
          <p className="muted small">Account: {user?.email}</p>
          <div className="field">
            <label htmlFor="displayName">Nome visualizzato</label>
            <input id="displayName" className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </div>
          <div>
            <button className="btn btn-secondary btn-sm" disabled={!name.trim() || name === user?.displayName}>
              Salva nome
            </button>
          </div>
        </form>
      </Section>

      <Section title="Aspetto">
        <div className="inline" role="radiogroup" aria-label="Tema">
          {(['system', 'light', 'dark'] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={theme === t}
              className="chip"
              onClick={() => {
                setTheme(t);
                applyTheme(t);
              }}
            >
              {{ system: 'Come il dispositivo', light: 'Chiaro', dark: 'Scuro' }[t]}
            </button>
          ))}
        </div>
      </Section>

      <Section title="Sicurezza">
        <form className="stack" onSubmit={changePassword} noValidate>
          <input type="email" autoComplete="username" value={user?.email ?? ''} readOnly hidden />
          <div className="field">
            <label htmlFor="cur">Password attuale</label>
            <input id="cur" className="input" type="password" autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="new">Nuova password</label>
            <input id="new" className="input" type="password" autoComplete="new-password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} />
            <span className="field-hint">Almeno {PASSWORD_MIN} caratteri.</span>
          </div>
          {pwError && <span className="field-error">{pwError}</span>}
          <div>
            <button className="btn btn-secondary btn-sm" disabled={!pw.currentPassword || !pw.newPassword}>
              Cambia password
            </button>
          </div>
        </form>
      </Section>

      <Section id="importa" title="Importa ed esporta">
        <div className="stack-sm">
          <label className="btn btn-secondary" aria-disabled={importing}>
            <UploadSimple size={18} /> {importing ? 'Importazione…' : 'Importa file vCard (.vcf)'}
            <input type="file" accept=".vcf,text/vcard,text/x-vcard" hidden disabled={importing} onChange={(e) => void importVcf(e.target.files?.[0])} />
          </label>
          <p className="field-hint">I contatti con email o telefono già presenti vengono saltati.</p>
        </div>
        <div className="inline">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void download('/contacts/export.vcf', 'cardvault.vcf')}>
            <DownloadSimple size={16} /> Tutti in vCard
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void download('/contacts/export.csv', 'cardvault.csv')}>
            <DownloadSimple size={16} /> Tutti in CSV (Excel)
          </button>
        </div>
      </Section>

      <Section title="Privacy e dati">
        <p className="small">
          Il testo dei biglietti viene riconosciuto su questo dispositivo. Le foto sono conservate cifrate sul server e
          nessun dato viene condiviso con terze parti. <Link to="/privacy">Leggi l'informativa</Link>.
        </p>
        <div className="inline">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void download('/me/export', 'cardvault-dati.json')}>
            <DownloadSimple size={16} /> Scarica tutti i miei dati
          </button>
        </div>
      </Section>

      <Section title="Account">
        <div className="inline">
          <button type="button" className="btn btn-secondary" onClick={() => (pending.length ? setConfirmLogout(true) : void signOut())}>
            <SignOut size={18} /> Esci
          </button>
          <button type="button" className="btn btn-ghost" style={{ color: 'var(--danger)' }} onClick={() => setDeleting(true)}>
            Elimina account
          </button>
        </div>
      </Section>

      <p className="muted small" style={{ textAlign: 'center' }}>
        CardVault {import.meta.env.VITE_APP_VERSION ?? ''}
      </p>

      <Modal
        open={confirmLogout}
        onClose={() => setConfirmLogout(false)}
        title="Biglietti non sincronizzati"
        actions={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setConfirmLogout(false)}>
              Resta connesso
            </button>
            <button type="button" className="btn btn-danger" onClick={() => void signOut()}>
              Esci e scarta
            </button>
          </>
        }
      >
        <p>
          Hai {pending.length} {pending.length === 1 ? 'biglietto salvato' : 'biglietti salvati'} solo su questo dispositivo. Uscendo
          verranno cancellati. Collegati a internet per sincronizzarli prima di uscire.
        </p>
      </Modal>

      <Modal
        open={deleting}
        onClose={() => setDeleting(false)}
        title="Eliminare l'account?"
        actions={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setDeleting(false)}>
              Annulla
            </button>
            <button type="button" className="btn btn-danger" disabled={!deletePw} onClick={() => void deleteAccount()}>
              Elimina definitivamente
            </button>
          </>
        }
      >
        <p>
          Verranno cancellati per sempre l'account, tutti i biglietti e le foto. L'operazione non si può annullare: se vuoi una
          copia, scarica prima i tuoi dati.
        </p>
        <div className="field">
          <label htmlFor="del-pw">Conferma con la password</label>
          <input id="del-pw" className="input" type="password" autoComplete="current-password" value={deletePw} onChange={(e) => setDeletePw(e.target.value)} />
        </div>
        {deleteError && <span className="field-error">{deleteError}</span>}
      </Modal>
    </div>
  );
}
