import { displayName } from '@cardvault/shared';
import {
  AddressBookTabs,
  BellRinging,
  Cards,
  CheckCircle,
  Flag,
  MagnifyingGlass,
  PencilSimple,
  QrCode,
  Scan,
  Stop,
  UploadSimple,
} from '@phosphor-icons/react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { BusinessCard } from '../components/BusinessCard';
import { EventDialog } from '../components/EventDialog';
import { Rolodex } from '../components/Rolodex';
import { errorMessage } from '../lib/api';
import { ROLODEX_PAGE_SIZE, useFollowUps, useLetters, useStats, useTags, useWallet, type SearchParams } from '../lib/contacts';
import { useEventMode } from '../lib/event';
import type { OutboxItem } from '../lib/idb';
import { listOutbox, onOutboxChange } from '../lib/outbox';
import { today } from '../lib/save';
import { useSession } from '../lib/session';

export function useOutbox() {
  const [items, setItems] = useState<OutboxItem[]>([]);
  useEffect(() => {
    const load = () => void listOutbox().then(setItems);
    load();
    return onOutboxChange(load);
  }, []);
  return items;
}

type WalletView = 'rolodex' | 'stack';

/** Remembered per device; the rotary card file is the default. */
function useWalletView(): [WalletView, (v: WalletView) => void] {
  const [view, setView] = useState<WalletView>(() => {
    try {
      return localStorage.getItem('cv-wallet-view') === 'stack' ? 'stack' : 'rolodex';
    } catch {
      return 'rolodex';
    }
  });
  const set = useCallback((v: WalletView) => {
    setView(v);
    try {
      localStorage.setItem('cv-wallet-view', v);
    } catch {
      /* storage blocked: the choice lasts for this visit */
    }
  }, []);
  return [view, set];
}

export function WalletPage() {
  const navigate = useNavigate();
  const { user } = useSession();
  const [filter, setFilter] = useState<SearchParams>({});
  const [view, setView] = useWalletView();
  const rolodex = view === 'rolodex';
  // the card file is alphabetical, like the paper one; the stack shows the newest first
  const params: SearchParams = rolodex ? { ...filter, sort: 'name', dir: 'asc' } : filter;
  const wallet = useWallet(params, rolodex ? ROLODEX_PAGE_SIZE : undefined);
  const letters = useLetters(filter, rolodex);
  const tags = useTags();
  const stats = useStats();
  const pending = useOutbox();
  const { event, stop: stopEvent } = useEventMode();
  const [eventOpen, setEventOpen] = useState(false);
  const [q, setQ] = useState('');

  const contacts = wallet.data?.pages.flatMap((p) => p.items) ?? [];
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = wallet;
  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);
  const ensureLoaded = useCallback(
    async (count: number) => {
      let r = { data: wallet.data, hasNextPage: wallet.hasNextPage };
      while ((r.data?.pages.reduce((n, p) => n + p.items.length, 0) ?? 0) < count && r.hasNextPage) {
        r = await fetchNextPage();
      }
    },
    [wallet.data, wallet.hasNextPage, fetchNextPage],
  );
  const total = wallet.data?.pages[0]?.total ?? 0;
  const offline = wallet.data?.pages[0]?.offline;
  const filtered = Object.keys(filter).length > 0;
  const firstName = user?.displayName.split(' ')[0];

  function search(e: FormEvent) {
    e.preventDefault();
    navigate(q.trim() ? `/cerca?q=${encodeURIComponent(q.trim())}` : '/cerca');
  }

  return (
    <>
      <section className="wallet-hero" aria-labelledby="wallet-title">
        <div className="wallet-hero-top">
          <div>
            <p className="eyebrow">Ciao {firstName}</p>
            <h1 id="wallet-title">Il tuo wallet</h1>
          </div>
          <Link to="/il-mio-biglietto" className="hero-qr" aria-label="Il mio biglietto: mostra il QR">
            <QrCode size={26} />
          </Link>
        </div>
        {stats.data && stats.data.total > 0 && (
          <ul className="hero-stats" aria-label="Riepilogo">
            <li>
              <strong>{stats.data.total}</strong> {stats.data.total === 1 ? 'biglietto' : 'biglietti'}
            </li>
            <li>
              <strong>{stats.data.thisMonth}</strong> questo mese
            </li>
            {stats.data.followUpsPlanned > 0 && (
              <li>
                <Link to="/promemoria">
                  <strong>{stats.data.followUpsDue}</strong> da ricontattare
                </Link>
              </li>
            )}
          </ul>
        )}
        <form role="search" className="searchbar" onSubmit={search}>
          <MagnifyingGlass size={20} aria-hidden="true" />
          <label htmlFor="wallet-q" className="visually-hidden">
            Cerca nei biglietti
          </label>
          <input
            id="wallet-q"
            className="input"
            type="search"
            enterKeyHint="search"
            placeholder="Cerca per nome, azienda, città…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </form>
      </section>

      {event ? (
        <div className="event-banner" role="status">
          <Flag size={22} weight="fill" aria-hidden="true" />
          <div className="event-banner-text">
            <strong>Evento in corso: {event.name}</strong>
            <span className="small">I nuovi biglietti prendono evento, data e tag in automatico.</span>
          </div>
          <div className="inline">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              aria-pressed={filter.metAt === event.name}
              onClick={() => setFilter(filter.metAt === event.name ? {} : { metAt: event.name })}
            >
              {filter.metAt === event.name ? 'Tutti' : 'Vedi'}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={stopEvent}>
              <Stop size={16} /> Termina
            </button>
          </div>
        </div>
      ) : null}

      {stats.data && stats.data.followUpsDue > 0 && <DueStrip />}

      <div className="chips" role="toolbar" aria-label="Filtri rapidi">
        <button type="button" className="chip" aria-pressed={!filtered} onClick={() => setFilter({})}>
          Tutti
        </button>
        <button type="button" className="chip" aria-pressed={!!filter.favorite} onClick={() => setFilter(filter.favorite ? {} : { favorite: true })}>
          Preferiti
        </button>
        {!event && (
          <button type="button" className="chip chip-event" onClick={() => setEventOpen(true)}>
            <Flag size={16} aria-hidden="true" /> Modalità evento
          </button>
        )}
        {tags.data?.slice(0, 8).map((t) => (
          <button key={t.tag} type="button" className="chip" aria-pressed={filter.tag === t.tag} onClick={() => setFilter(filter.tag === t.tag ? {} : { tag: t.tag })}>
            {t.tag}
          </button>
        ))}
      </div>

      {offline && <p className="muted small" style={{ marginTop: '0.5rem' }}>Stai vedendo l'ultima copia salvata sul dispositivo.</p>}

      {pending.length > 0 && (
        <>
          <div className="section-title">
            <h2 className="h3">Da sincronizzare</h2>
            <span className="badge-sync">
              <span className="status-dot pending" /> {pending.length}
            </span>
          </div>
          <div className="wallet">
            {pending.map((p, i) => (
              <div key={p.clientRef} className="wallet-item appear" style={{ ['--i' as string]: i }}>
                <BusinessCard contact={p.contact} pending />
              </div>
            ))}
          </div>
          {pending.some((p) => p.lastError) && (
            <p className="field-error">Alcuni biglietti non sono stati salvati: {pending.find((p) => p.lastError)?.lastError}</p>
          )}
        </>
      )}

      <div style={{ marginTop: '1.25rem' }}>
        {wallet.isLoading ? (
          <div className="wallet" aria-busy="true" aria-label="Caricamento biglietti">
            {[0, 1, 2].map((i) => (
              <div key={i} className="wallet-item">
                <div className="skeleton" style={{ aspectRatio: '1.586', borderRadius: 14 }} />
              </div>
            ))}
          </div>
        ) : wallet.isError ? (
          <div className="alert alert-error" role="alert">
            {errorMessage(wallet.error)}{' '}
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void wallet.refetch()}>
              Riprova
            </button>
          </div>
        ) : contacts.length === 0 && !pending.length ? (
          filtered ? (
            <div className="empty">
              <p className="muted">Nessun biglietto con questo filtro.</p>
              <button type="button" className="btn btn-secondary" onClick={() => setFilter({})}>
                Mostra tutti
              </button>
            </div>
          ) : (
            <EmptyWallet />
          )
        ) : (
          <>
            <div className="spread" style={{ marginBottom: '0.5rem' }}>
              <span className="label">
                {rolodex ? 'In ordine alfabetico' : 'Dal più recente'}
                {filtered && total > 0 ? ` · ${total}` : ''}
              </span>
              <div className="view-switch" role="group" aria-label="Vista dei biglietti">
                <button type="button" aria-pressed={rolodex} onClick={() => setView('rolodex')}>
                  <AddressBookTabs size={16} /> Schedario
                </button>
                <button type="button" aria-pressed={!rolodex} onClick={() => setView('stack')}>
                  <Cards size={16} /> Pila
                </button>
              </div>
            </div>
            {rolodex ? (
              <Rolodex contacts={contacts} onNearEnd={loadMore} letters={letters.data} ensureLoaded={ensureLoaded} />
            ) : (
              <>
                <div className="wallet">
                  {contacts.map((c, i) => (
                    <Link
                      key={c.id}
                      to={`/contatti/${c.id}`}
                      viewTransition
                      className="wallet-item appear"
                      style={{ ['--i' as string]: Math.min(i, 8), viewTransitionName: `card-${c.id}` }}
                    >
                      <BusinessCard contact={c} />
                    </Link>
                  ))}
                </div>
                {wallet.hasNextPage && (
                  <div className="pager">
                    <button type="button" className="btn btn-secondary" disabled={wallet.isFetchingNextPage} onClick={() => void wallet.fetchNextPage()}>
                      {wallet.isFetchingNextPage ? 'Caricamento…' : 'Mostra altri'}
                    </button>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>

      <EventDialog open={eventOpen} onClose={() => setEventOpen(false)} />
    </>
  );
}

/** Reminders due today or overdue, right on the wallet. */
function DueStrip() {
  const followUps = useFollowUps();
  const due = (followUps.data ?? []).filter((c) => c.followUpOn && c.followUpOn <= today());
  if (!due.length) return null;
  return (
    <section className="due-strip" aria-labelledby="due-title">
      <div className="spread">
        <h2 id="due-title" className="h3">
          <BellRinging size={20} aria-hidden="true" /> Da ricontattare oggi
        </h2>
        <Link to="/promemoria" className="small">
          Tutti i promemoria
        </Link>
      </div>
      <ul>
        {due.slice(0, 3).map((c) => (
          <li key={c.id}>
            <Link to={`/contatti/${c.id}`}>
              <strong>{displayName(c)}</strong>
              <span className="muted small">{c.followUpNote || c.company}</span>
            </Link>
          </li>
        ))}
      </ul>
      {due.length > 3 && <p className="muted small">e altri {due.length - 3}</p>}
    </section>
  );
}

const STEPS = [
  { icon: Scan, title: 'Scatta', text: 'Inquadra il biglietto: il bordo viene trovato da solo.' },
  { icon: CheckCircle, title: 'Controlla', text: 'Il testo è letto sul telefono. Correggi i campi incerti.' },
  { icon: AddressBookTabs, title: 'Ritrova', text: 'Sfoglia lo schedario, cerca per nome, azienda o evento.' },
];

function EmptyWallet() {
  return (
    <div className="empty empty-steps">
      <h2>Il tuo primo biglietto in tre passi</h2>
      <ol className="steps-cards">
        {STEPS.map((s, i) => (
          <li key={s.title}>
            <span className="step-num" aria-hidden="true">
              {i + 1}
            </span>
            <s.icon size={30} aria-hidden="true" />
            <strong>{s.title}</strong>
            <span className="muted small">{s.text}</span>
          </li>
        ))}
      </ol>
      <div className="inline" style={{ justifyContent: 'center' }}>
        <Link to="/scansiona" className="btn btn-primary">
          <Scan size={18} /> Scansiona biglietto
        </Link>
        <Link to="/contatti/nuovo" className="btn btn-secondary">
          <PencilSimple size={18} /> Inserisci a mano
        </Link>
      </div>
      <Link to="/impostazioni#importa" className="small">
        <UploadSimple size={14} /> Importa da file vCard
      </Link>
    </div>
  );
}
