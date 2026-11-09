import type { ContactInput } from '@cardvault/shared';
import { AddressBookTabs, Cards, MagnifyingGlass, PencilSimple, Scan, UploadSimple } from '@phosphor-icons/react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { BusinessCard } from '../components/BusinessCard';
import { Rolodex } from '../components/Rolodex';
import { errorMessage } from '../lib/api';
import { useTags, useWallet, type SearchParams } from '../lib/contacts';
import type { OutboxItem } from '../lib/idb';
import { listOutbox, onOutboxChange } from '../lib/outbox';
import { useSession } from '../lib/session';

const SAMPLE: ContactInput = {
  prefix: 'Ing.',
  firstName: 'Marta',
  lastName: 'Colombo',
  company: 'Il tuo primo biglietto',
  jobTitle: 'Inquadralo con la fotocamera',
  emails: [],
  phones: [],
  website: '',
  address: { street: '', city: '', postalCode: '', province: '', country: '' },
  socials: [],
  notes: '',
  tags: [],
  metAt: '',
  metOn: null,
  favorite: false,
  ocrText: '',
};

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
  // the card file is alphabetical, like the paper one; the stack shows the newest first
  const wallet = useWallet(view === 'rolodex' ? { ...filter, sort: 'name', dir: 'asc' } : filter);
  const tags = useTags();
  const pending = useOutbox();
  const [q, setQ] = useState('');

  const contacts = wallet.data?.pages.flatMap((p) => p.items) ?? [];
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = wallet;
  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);
  const total = wallet.data?.pages[0]?.total ?? 0;
  const offline = wallet.data?.pages[0]?.offline;
  const filtered = Object.keys(filter).length > 0;

  function search(e: FormEvent) {
    e.preventDefault();
    navigate(q.trim() ? `/cerca?q=${encodeURIComponent(q.trim())}` : '/cerca');
  }

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">Ciao {user?.displayName.split(' ')[0]}</p>
          <h1>Il tuo wallet</h1>
        </div>
        {total > 0 && (
          <span className="muted small" aria-live="polite">
            {total} {total === 1 ? 'biglietto' : 'biglietti'}
          </span>
        )}
      </div>

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

      <div className="chips" role="toolbar" aria-label="Filtri rapidi">
        <button type="button" className="chip" aria-pressed={!filtered} onClick={() => setFilter({})}>
          Tutti
        </button>
        <button type="button" className="chip" aria-pressed={!!filter.favorite} onClick={() => setFilter(filter.favorite ? {} : { favorite: true })}>
          Preferiti
        </button>
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
              <span className="label">{view === 'rolodex' ? 'In ordine alfabetico' : 'Dal più recente'}</span>
              <div className="view-switch" role="group" aria-label="Vista dei biglietti">
                <button type="button" aria-pressed={view === 'rolodex'} onClick={() => setView('rolodex')}>
                  <AddressBookTabs size={16} /> Schedario
                </button>
                <button type="button" aria-pressed={view === 'stack'} onClick={() => setView('stack')}>
                  <Cards size={16} /> Pila
                </button>
              </div>
            </div>
            {view === 'rolodex' ? (
              <Rolodex contacts={contacts} onNearEnd={loadMore} />
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
    </>
  );
}

function EmptyWallet() {
  return (
    <div className="empty">
      <BusinessCard contact={SAMPLE} tone="paper" />
      <h2>Nessun biglietto, per ora</h2>
      <p className="muted" style={{ maxWidth: '40ch' }}>
        Fotografa un biglietto da visita: il testo viene letto sul telefono e trasformato in un contatto da rivedere e salvare.
      </p>
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
