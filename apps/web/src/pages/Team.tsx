import {
  displayName,
  formatPhone,
  SHARED_FIELDS_NOTE,
  SOCIAL_LABELS,
  toE164,
  toHref,
  type SharedContact,
  type TeamDetail,
  type TeamSummary,
} from '@cardvault/shared';
import {
  ArrowLeft,
  Copy,
  Crown,
  DownloadSimple,
  Envelope,
  LinkSimple,
  MagnifyingGlass,
  MapPin,
  Phone,
  Plus,
  ShareNetwork,
  SignOut,
  Trash,
  UserMinus,
  UsersThree,
  WhatsappLogo,
} from '@phosphor-icons/react';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { BusinessCard } from '../components/BusinessCard';
import { Modal } from '../components/Modal';
import { useToast } from '../components/Toasts';
import { errorMessage } from '../lib/api';
import { useContactImage, useSearch } from '../lib/contacts';
import { useSession } from '../lib/session';
import { useContactTeams, useSharedContact, useTeam, useTeamActions, useTeamContacts, useTeams } from '../lib/teams';

export const INVITE_KEY = 'cv-invite';

// ================================================================== teams list

export function TeamsPage() {
  const teams = useTeams();
  const [params] = useSearchParams();
  // how many teams there were on arrival: creating one here must not trigger the redirect below
  const onArrival = useRef<number | null>(null);
  if (teams.data && onArrival.current === null) onArrival.current = teams.data.length;
  if (teams.isLoading) return <div className="skeleton" style={{ height: 200 }} aria-busy="true" />;
  if (teams.isError) {
    return (
      <div className="alert alert-error" role="alert">
        {errorMessage(teams.error)}
      </div>
    );
  }
  const list = teams.data ?? [];
  // most people are in exactly one team (Cosedil): go straight to it
  if (onArrival.current === 1 && list.length === 1 && !params.has('tutti')) return <Navigate to={`/team/${list[0]!.id}`} replace />;

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">Rubrica condivisa</p>
          <h1>Team</h1>
        </div>
      </div>
      {list.length === 0 && <TeamIntro />}
      {list.length > 0 && (
        <ul className="result-list" style={{ marginBottom: '1.5rem' }}>
          {list.map((t) => (
            <TeamRow key={t.id} team={t} />
          ))}
        </ul>
      )}
      <CreateTeam first={list.length === 0} />
    </>
  );
}

function TeamRow({ team: t }: { team: TeamSummary }) {
  return (
    <li className="result">
      <span className="avatar" aria-hidden="true">
        <UsersThree size={20} />
      </span>
      <Link to={`/team/${t.id}`} className="result-main">
        <span className="result-title">{t.name}</span>
        <span className="result-sub">
          {t.memberCount} {t.memberCount === 1 ? 'membro' : 'membri'} · {t.contactCount} {t.contactCount === 1 ? 'biglietto' : 'biglietti'}
          {t.role === 'admin' ? ' · amministratore' : ''}
        </span>
      </Link>
    </li>
  );
}

function TeamIntro() {
  return (
    <section className="team-intro">
      <UsersThree size={44} aria-hidden="true" />
      <h2>Una rubrica in comune con i colleghi</h2>
      <ul className="checklist">
        <li>Ognuno sceglie quali biglietti condividere: gli altri li vedono e possono salvarli nei propri contatti.</li>
        <li>{SHARED_FIELDS_NOTE}</li>
        <li>Si entra solo con un link di invito, valido 7 giorni.</li>
      </ul>
      <p className="muted small">Hai ricevuto un invito? Apri il link dal telefono e sei dentro.</p>
    </section>
  );
}

function CreateTeam({ first }: { first: boolean }) {
  const actions = useTeamActions();
  const navigate = useNavigate();
  const toast = useToast();
  const [open, setOpen] = useState(first);
  const [name, setName] = useState(first ? 'Cosedil' : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const t = await actions.create(name);
      toast(`Team ${t.name} creato`);
      navigate(`/team/${t.id}?invita=1`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className="btn btn-secondary" onClick={() => setOpen(true)}>
        <Plus size={18} /> Crea un altro team
      </button>
    );
  }
  return (
    <form className="panel stack-sm" onSubmit={(e) => void submit(e)}>
      <h2 className="h3">{first ? 'Crea la rubrica del tuo team' : 'Nuovo team'}</h2>
      <div className="field">
        <label htmlFor="team-name">Nome del team</label>
        <input id="team-name" className="input" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!!error || undefined} />
        {error && <span className="field-error">{error}</span>}
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        Diventi amministratore: potrai invitare i colleghi con un link.
      </p>
      <div>
        <button type="submit" className="btn btn-primary" disabled={busy || name.trim().length < 2}>
          Crea team
        </button>
      </div>
    </form>
  );
}

// ================================================================== one team

export function TeamPage() {
  const { teamId } = useParams();
  const [params, setParams] = useSearchParams();
  const team = useTeam(teamId);
  // right after creating a team, the invite link is what you need
  const tab = params.get('vista') === 'membri' || params.has('invita') ? 'members' : 'cards';

  if (team.isLoading) return <div className="skeleton" style={{ height: 240 }} aria-busy="true" />;
  if (team.isError || !team.data) {
    return (
      <div className="empty">
        <p>{errorMessage(team.error) || 'Team non trovato'}</p>
        <Link to="/team?tutti" className="btn btn-secondary">
          I tuoi team
        </Link>
      </div>
    );
  }
  const t = team.data;
  const setTab = (v: 'cards' | 'members') => setParams(v === 'members' ? { vista: 'membri' } : {}, { replace: true });

  return (
    <>
      <section className="wallet-hero team-hero" aria-labelledby="team-title">
        <div className="wallet-hero-top">
          <div>
            <p className="eyebrow">Rubrica condivisa</p>
            <h1 id="team-title">{t.name}</h1>
          </div>
          <Link to="/team?tutti" className="hero-qr" aria-label="Tutti i tuoi team">
            <UsersThree size={24} />
          </Link>
        </div>
        <ul className="hero-stats" aria-label="Riepilogo">
          <li>
            <strong>{t.contactCount}</strong> {t.contactCount === 1 ? 'biglietto' : 'biglietti'}
          </li>
          <li>
            <strong>{t.memberCount}</strong> {t.memberCount === 1 ? 'membro' : 'membri'}
          </li>
        </ul>
      </section>

      <div className="view-switch team-tabs" role="tablist" aria-label="Sezioni del team">
        <button type="button" role="tab" aria-selected={tab === 'cards'} aria-pressed={tab === 'cards'} onClick={() => setTab('cards')}>
          Biglietti
        </button>
        <button type="button" role="tab" aria-selected={tab === 'members'} aria-pressed={tab === 'members'} onClick={() => setTab('members')}>
          Membri
        </button>
      </div>

      {tab === 'cards' ? <TeamCards team={t} /> : <TeamMembers team={t} autoInvite={params.has('invita')} />}
    </>
  );
}

function TeamCards({ team }: { team: TeamDetail }) {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [adding, setAdding] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(id);
  }, [q]);
  const list = useTeamContacts(team.id, debounced);
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="stack" style={{ marginTop: '1rem' }}>
      <div className="spread">
        <form role="search" className="searchbar" style={{ flex: 1, minWidth: 200 }} onSubmit={(e) => e.preventDefault()}>
          <MagnifyingGlass size={20} aria-hidden="true" />
          <label htmlFor="team-q" className="visually-hidden">
            Cerca nei biglietti del team
          </label>
          <input id="team-q" className="input" type="search" placeholder="Cerca nel team" value={q} onChange={(e) => setQ(e.target.value)} />
        </form>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setAdding(true)}>
          <Plus size={16} /> Condividi i miei
        </button>
      </div>

      {list.isLoading ? (
        <div className="wallet" aria-busy="true">
          <div className="wallet-item">
            <div className="skeleton" style={{ aspectRatio: '1.586', borderRadius: 14 }} />
          </div>
        </div>
      ) : list.isError ? (
        <div className="alert alert-error" role="alert">
          {errorMessage(list.error)}
        </div>
      ) : items.length === 0 ? (
        <div className="empty">
          <p className="muted" style={{ maxWidth: '44ch' }}>
            {debounced
              ? 'Nessun biglietto del team corrisponde alla ricerca.'
              : 'Ancora nessun biglietto condiviso. Tocca «Condividi i miei», oppure apri un tuo contatto e scegli il team in «Condividi con i colleghi».'}
          </p>
        </div>
      ) : (
        <div className="team-grid">
          {items.map((c) => (
            <Link key={c.id} to={`/team/${team.id}/contatti/${c.id}`} className="shared-item">
              <BusinessCard contact={c} />
              <span className="shared-by small">{c.mine ? 'Condiviso da te' : `Da ${c.sharedBy.name}`}</span>
            </Link>
          ))}
        </div>
      )}
      {list.hasNextPage && (
        <div className="pager">
          <button type="button" className="btn btn-secondary" disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
            {list.isFetchingNextPage ? 'Caricamento…' : 'Mostra altri'}
          </button>
        </div>
      )}
      <ShareMine team={team} open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}

/** Pick some of my own cards and share them with the team in one go. */
function ShareMine({ team, open, onClose }: { team: TeamDetail; open: boolean; onClose: () => void }) {
  const [q, setQ] = useState('');
  const mine = useSearch({ q: q.trim() || undefined, sort: 'name', dir: 'asc', pageSize: 50 }, open);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Condividi con ${team.name}`}
      actions={
        <button type="button" className="btn btn-primary" onClick={onClose}>
          Fatto
        </button>
      }
    >
      <p className="muted small" style={{ marginTop: 0 }}>
        {SHARED_FIELDS_NOTE}
      </p>
      <label htmlFor="share-q" className="visually-hidden">
        Cerca nei tuoi biglietti
      </label>
      <input id="share-q" className="input" type="search" placeholder="Cerca nei tuoi biglietti" value={q} onChange={(e) => setQ(e.target.value)} />
      <ul className="share-list">
        {mine.data?.items.map((c) => (
          <ShareToggle key={c.id} teamId={team.id} contactId={c.id} label={displayName(c)} sub={c.company} />
        ))}
      </ul>
      {mine.data && mine.data.total > mine.data.items.length && <p className="muted small">Cerca per vedere gli altri {mine.data.total - mine.data.items.length}.</p>}
    </Modal>
  );
}

function ShareToggle({ teamId, contactId, label, sub }: { teamId: string; contactId: string; label: string; sub: string }) {
  const shared = useContactTeams(contactId, true);
  const actions = useTeamActions();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const on = !!shared.data?.includes(teamId);
  return (
    <li>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={on}
          disabled={busy || shared.isLoading}
          onChange={async () => {
            setBusy(true);
            try {
              if (on) await actions.unshare(teamId, contactId);
              else await actions.share(teamId, contactId);
              await shared.refetch();
            } catch (err) {
              toast(errorMessage(err), 'error');
            } finally {
              setBusy(false);
            }
          }}
        />
        <span>
          {label}
          {sub && <span className="muted small"> · {sub}</span>}
        </span>
      </label>
    </li>
  );
}

function TeamMembers({ team, autoInvite }: { team: TeamDetail; autoInvite: boolean }) {
  const { user } = useSession();
  const actions = useTeamActions();
  const toast = useToast();
  const navigate = useNavigate();
  const admin = team.role === 'admin';
  const [invite, setInvite] = useState<{ url: string; expiresAt: string } | null>(null);
  const [confirm, setConfirm] = useState<null | { kind: 'leave' | 'delete' | 'remove'; userId?: string; name?: string }>(null);
  const [rename, setRename] = useState(team.name);
  const [busy, setBusy] = useState(false);

  async function makeInvite() {
    try {
      setInvite(await actions.invite(team.id));
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  }
  useEffect(() => {
    if (autoInvite && admin) void makeInvite();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoInvite, admin]);

  async function shareInvite() {
    if (!invite) return;
    const text = `Entra nella rubrica condivisa ${team.name} su CardVault: ${invite.url}`;
    try {
      if (navigator.share) await navigator.share({ title: `Invito a ${team.name}`, text, url: invite.url });
      else {
        await navigator.clipboard.writeText(invite.url);
        toast('Link copiato');
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') toast('Condivisione non riuscita', 'error');
    }
  }

  async function run(fn: () => Promise<unknown>, done: string, after?: () => void) {
    setBusy(true);
    try {
      await fn();
      toast(done);
      setConfirm(null);
      after?.();
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack" style={{ marginTop: '1rem' }}>
      {admin && (
        <section className="panel stack-sm" aria-labelledby="invite-title">
          <h2 id="invite-title" className="h3">
            <LinkSimple size={20} aria-hidden="true" /> Invita i colleghi
          </h2>
          {invite ? (
            <>
              <div className="invite-link">
                <code className="mono small">{invite.url}</code>
              </div>
              <p className="muted small" style={{ margin: 0 }}>
                Chi apre il link (e ha un account CardVault) entra nel team. Valido fino al{' '}
                {new Date(invite.expiresAt).toLocaleDateString('it-IT', { day: 'numeric', month: 'long' })}.
              </p>
              <div className="inline">
                <button type="button" className="btn btn-primary btn-sm" onClick={() => void shareInvite()}>
                  <ShareNetwork size={16} /> Invia il link
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => void navigator.clipboard.writeText(invite.url).then(() => toast('Link copiato'))}
                >
                  <Copy size={16} /> Copia
                </button>
              </div>
            </>
          ) : (
            <div>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => void makeInvite()}>
                <LinkSimple size={16} /> Crea link di invito
              </button>
            </div>
          )}
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            style={{ justifySelf: 'start' }}
            onClick={() => void run(() => actions.revokeInvites(team.id), 'Tutti i link di invito sono stati disattivati', () => setInvite(null))}
          >
            Disattiva i link già inviati
          </button>
        </section>
      )}

      <section className="panel panel-flush" aria-labelledby="members-title">
        <h2 id="members-title" className="h3" style={{ padding: '1rem 1rem 0' }}>
          Membri · {team.memberCount}
        </h2>
        <ul className="result-list">
          {team.members.map((m) => {
            const me = m.userId === user?.id;
            return (
              <li key={m.userId} className="result">
                <span className="avatar" aria-hidden="true">
                  {m.displayName.charAt(0).toUpperCase()}
                </span>
                <span className="result-main">
                  <span className="result-title">
                    {m.displayName}
                    {me ? ' (tu)' : ''}
                  </span>
                  <span className="result-sub">
                    {m.role === 'admin' ? 'Amministratore · ' : ''}
                    {m.email}
                  </span>
                </span>
                {admin && !me && (
                  <span className="inline">
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={m.role === 'admin' ? `Togli amministratore a ${m.displayName}` : `Rendi amministratore ${m.displayName}`}
                      aria-pressed={m.role === 'admin'}
                      onClick={() => void run(() => actions.setRole(team.id, m.userId, m.role === 'admin' ? 'member' : 'admin'), 'Ruolo aggiornato')}
                    >
                      <Crown size={20} weight={m.role === 'admin' ? 'fill' : 'regular'} />
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={`Rimuovi ${m.displayName} dal team`}
                      onClick={() => setConfirm({ kind: 'remove', userId: m.userId, name: m.displayName })}
                    >
                      <UserMinus size={20} />
                    </button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {admin && (
        <form
          className="panel stack-sm"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => actions.rename(team.id, rename), 'Nome aggiornato');
          }}
        >
          <div className="field">
            <label htmlFor="team-rename">Nome del team</label>
            <input id="team-rename" className="input" maxLength={80} value={rename} onChange={(e) => setRename(e.target.value)} />
          </div>
          <div>
            <button type="submit" className="btn btn-secondary btn-sm" disabled={busy || rename.trim().length < 2 || rename.trim() === team.name}>
              Rinomina
            </button>
          </div>
        </form>
      )}

      <div className="inline">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirm({ kind: 'leave' })}>
          <SignOut size={18} /> Esci dal team
        </button>
        {admin && (
          <button type="button" className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)', marginLeft: 'auto' }} onClick={() => setConfirm({ kind: 'delete' })}>
            <Trash size={18} /> Elimina team
          </button>
        )}
      </div>

      <Modal
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title={confirm?.kind === 'delete' ? `Eliminare ${team.name}?` : confirm?.kind === 'leave' ? `Uscire da ${team.name}?` : `Rimuovere ${confirm?.name}?`}
        actions={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setConfirm(null)}>
              Annulla
            </button>
            <button
              type="button"
              className="btn btn-danger"
              disabled={busy}
              onClick={() => {
                if (confirm?.kind === 'delete') void run(() => actions.remove(team.id), 'Team eliminato', () => navigate('/team?tutti', { replace: true }));
                else if (confirm?.kind === 'leave')
                  void run(() => actions.removeMember(team.id, user!.id), 'Sei uscito dal team', () => navigate('/team?tutti', { replace: true }));
                else if (confirm?.userId) void run(() => actions.removeMember(team.id, confirm.userId!), `${confirm.name} rimosso`);
              }}
            >
              {confirm?.kind === 'delete' ? 'Elimina' : confirm?.kind === 'leave' ? 'Esci' : 'Rimuovi'}
            </button>
          </>
        }
      >
        <p>
          {confirm?.kind === 'delete'
            ? 'La rubrica condivisa sparisce per tutti. I biglietti restano nel wallet di chi li ha scansionati.'
            : confirm?.kind === 'leave'
              ? 'I biglietti che hai condiviso escono dal team; restano nel tuo wallet.'
              : 'I biglietti che ha condiviso escono dal team; restano nel suo wallet.'}
        </p>
      </Modal>
    </div>
  );
}

// ================================================================ shared card

export function SharedContactPage() {
  const { teamId, id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const query = useSharedContact(teamId, id);
  const team = useTeam(teamId);
  const actions = useTeamActions();
  const [busy, setBusy] = useState(false);

  if (query.isLoading) return <div className="skeleton" style={{ aspectRatio: '1.586', maxWidth: 560, margin: '0 auto' }} aria-busy="true" />;
  if (query.isError || !query.data) {
    return (
      <div className="empty">
        <p>{errorMessage(query.error) || 'Contatto non trovato'}</p>
        <Link to={`/team/${teamId}`} className="btn btn-secondary">
          Torna al team
        </Link>
      </div>
    );
  }
  const c = query.data;
  const mobile = c.phones.find((p) => p.type === 'mobile');
  const mainPhone = mobile ?? c.phones.find((p) => p.type !== 'fax');
  const whatsapp = mobile ? toE164(mobile.value)?.replace('+', '') : undefined;
  const address = [c.address.street, [c.address.postalCode, c.address.city].filter(Boolean).join(' '), c.address.country].filter(Boolean).join(', ');
  const canRemove = c.mine || team.data?.role === 'admin';

  async function copy() {
    setBusy(true);
    try {
      const out = await actions.copy(teamId!, c.id);
      toast(out.duplicates.length ? `Salvato: hai già un contatto simile (${out.duplicates[0]!.name})` : 'Salvato nei tuoi contatti');
      navigate(`/contatti/${out.contact.id}`);
    } catch (err) {
      toast(errorMessage(err), 'error');
      setBusy(false);
    }
  }

  return (
    <>
      <div className="spread" style={{ marginBottom: '0.75rem' }}>
        <Link to={`/team/${teamId}`} className="btn btn-ghost btn-sm">
          <ArrowLeft size={18} /> {team.data?.name ?? 'Team'}
        </Link>
        {!c.mine && (
          <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void copy()}>
            <DownloadSimple size={16} /> Salva nei miei
          </button>
        )}
      </div>
      <div className="detail-hero">
        <BusinessCard contact={c} />
        <nav className="detail-actions" aria-label="Azioni rapide">
          <a href={mainPhone ? `tel:${mainPhone.value.replace(/[^\d+]/g, '')}` : undefined} aria-disabled={!mainPhone}>
            <Phone size={22} /> Chiama
          </a>
          <a href={whatsapp ? `https://wa.me/${whatsapp}` : undefined} target="_blank" rel="noopener noreferrer" aria-disabled={!whatsapp}>
            <WhatsappLogo size={22} /> WhatsApp
          </a>
          <a href={c.emails[0] ? `mailto:${c.emails[0]}` : undefined} aria-disabled={!c.emails[0]}>
            <Envelope size={22} /> Email
          </a>
          <a
            href={address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}` : undefined}
            target="_blank"
            rel="noopener noreferrer"
            aria-disabled={!address}
          >
            <MapPin size={22} /> Mappa
          </a>
        </nav>
      </div>
      <div className="stack" style={{ maxWidth: 560, margin: '0 auto' }}>
        <section className="panel panel-flush" aria-label="Dettagli">
          <dl className="kv">
            {c.jobTitle && <Row k="Ruolo" v={c.jobTitle} />}
            {c.company && <Row k="Azienda" v={c.company} />}
            {c.phones.map((p, i) => (
              <Row key={`p${i}`} k="Telefono" v={<a href={`tel:${p.value.replace(/[^\d+]/g, '')}`}>{formatPhone(p.value)}</a>} />
            ))}
            {c.emails.map((e) => (
              <Row key={e} k="Email" v={<a href={`mailto:${e}`}>{e}</a>} />
            ))}
            {c.website && <Row k="Sito" v={<a href={toHref(c.website)} target="_blank" rel="noopener noreferrer">{c.website}</a>} />}
            {c.socials.map((s) => (
              <Row key={s.value} k={SOCIAL_LABELS[s.network]} v={<a href={toHref(s.value)} target="_blank" rel="noopener noreferrer">{s.value}</a>} />
            ))}
            {address && <Row k="Indirizzo" v={address} />}
          </dl>
        </section>
        {c.hasFront && <SharedPhoto contact={c} />}
        <p className="muted small">
          {c.mine ? 'Condiviso da te' : `Condiviso da ${c.sharedBy.name}`} il {new Date(c.sharedAt).toLocaleDateString('it-IT')}
        </p>
        {canRemove && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            style={{ justifySelf: 'start', color: 'var(--danger)' }}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await actions.unshare(teamId!, c.id);
                toast('Tolto dal team');
                navigate(`/team/${teamId}`, { replace: true });
              } catch (err) {
                toast(errorMessage(err), 'error');
                setBusy(false);
              }
            }}
          >
            <Trash size={18} /> Togli dal team
          </button>
        )}
      </div>
    </>
  );
}

function SharedPhoto({ contact }: { contact: SharedContact }) {
  const img = useContactImage(contact.id, 'front', true, contact.updatedAt, contact.teamId);
  return (
    <section className="panel stack-sm" aria-label="Foto del biglietto">
      {img.url ? <img className="photo" src={img.url} alt="Fronte del biglietto" /> : <div className="skeleton" style={{ aspectRatio: '1.586' }} />}
    </section>
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

// ================================================================== invites

/** /team/invito#<token> — works logged out too: the token waits until you sign in. */
export function JoinTeamPage() {
  const { status } = useSession();
  const location = useLocation();
  const navigate = useNavigate();
  const actions = useTeamActions();
  const toast = useToast();
  const token = useMemo(() => {
    const fromHash = location.hash.slice(1);
    if (fromHash) return fromHash;
    try {
      return sessionStorage.getItem(INVITE_KEY) ?? '';
    } catch {
      return '';
    }
  }, [location.hash]);
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof actions.preview>> | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const signedIn = status === 'authenticated';

  useEffect(() => {
    if (!token) return;
    if (!signedIn) {
      try {
        sessionStorage.setItem(INVITE_KEY, token);
      } catch {
        /* the link has to be opened again after login */
      }
      return;
    }
    try {
      sessionStorage.removeItem(INVITE_KEY);
    } catch {
      /* ignore */
    }
    actions.preview(token).then(setPreview, (err) => setError(errorMessage(err)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, signedIn]);

  async function join() {
    setBusy(true);
    try {
      const t = await actions.join(token);
      toast(`Benvenuto in ${t.name}`);
      navigate(`/team/${t.id}`, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card stack" style={{ textAlign: 'center' }}>
        <div className="auth-brand">
          <img src="/favicon.svg" alt="" width={56} height={56} />
          <span>CardVault</span>
        </div>
        {!token ? (
          <p>Link di invito incompleto: chiedi al collega di inviartelo di nuovo.</p>
        ) : !signedIn ? (
          status === 'loading' ? (
            <p className="muted">Caricamento…</p>
          ) : (
            <>
              <h1 style={{ fontSize: '1.5rem' }}>Sei stato invitato in un team</h1>
              <p className="muted">Accedi o crea un account: poi entri nella rubrica condivisa.</p>
              <Link to="/accedi" className="btn btn-primary btn-block">
                Accedi
              </Link>
              <Link to="/registrati" className="btn btn-secondary btn-block">
                Crea un account
              </Link>
            </>
          )
        ) : error ? (
          <>
            <div className="alert alert-error" role="alert">
              {error}
            </div>
            <Link to="/" className="btn btn-secondary">
              Vai al wallet
            </Link>
          </>
        ) : !preview ? (
          <p className="muted" aria-busy="true">
            Verifico l’invito…
          </p>
        ) : preview.alreadyMember ? (
          <>
            <h1 style={{ fontSize: '1.5rem' }}>Sei già in {preview.teamName}</h1>
            <Link to={`/team/${preview.teamId}`} className="btn btn-primary btn-block">
              Apri la rubrica
            </Link>
          </>
        ) : (
          <>
            <UsersThree size={44} style={{ margin: '0 auto', color: 'var(--primary)' }} aria-hidden="true" />
            <h1 style={{ fontSize: '1.5rem' }}>Entra in {preview.teamName}</h1>
            <p className="muted">
              {preview.invitedBy} ti invita nella rubrica condivisa ({preview.memberCount} {preview.memberCount === 1 ? 'membro' : 'membri'}).
            </p>
            <p className="small muted">{SHARED_FIELDS_NOTE}</p>
            <button type="button" className="btn btn-primary btn-block" disabled={busy} onClick={() => void join()}>
              Entra nel team
            </button>
            <Link to="/" className="btn btn-ghost btn-block">
              Non ora
            </Link>
          </>
        )}
      </div>
    </div>
  );
}

/** After login, a pending invite (opened while signed out) takes over once. */
export function usePendingInvite() {
  const navigate = useNavigate();
  useEffect(() => {
    let token: string | null;
    try {
      token = sessionStorage.getItem(INVITE_KEY);
    } catch {
      token = null;
    }
    if (token) navigate(`/team/invito#${token}`, { replace: true });
  }, [navigate]);
}
