import { displayName, initials, SORT_FIELDS, type Contact, type SortField } from '@cardvault/shared';
import { DownloadSimple, Faders, MagnifyingGlass, Star, X } from '@phosphor-icons/react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useToast } from '../components/Toasts';
import { api, errorMessage, saveResponse } from '../lib/api';
import { useEvents, useSearch, useTags, type SearchParams } from '../lib/contacts';

const FIELD_FILTERS = [
  ['name', 'Nome'],
  ['company', 'Azienda'],
  ['jobTitle', 'Ruolo'],
  ['city', 'Città'],
] as const;

const SORT_LABELS: Record<SortField, string> = {
  name: 'Nome',
  company: 'Azienda',
  createdAt: 'Data di inserimento',
  metOn: 'Data incontro',
};

const KEYS = ['q', 'name', 'company', 'jobTitle', 'city', 'tag', 'metAt', 'metFrom', 'metTo', 'favorite', 'sort', 'dir', 'page'] as const;
const PAGE_SIZE = 25;

function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Wraps accent-insensitive matches of the query words in <mark>. */
function highlight(text: string, words: string[]): ReactNode {
  if (!text || !words.length) return text;
  const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const folded = fold(text);
  // NFD folding keeps 1:1 positions for Latin text without combining sequences
  if (folded.length !== text.length) return text;
  const ranges: Array<[number, number]> = [];
  for (const w of words.map(fold).filter((x) => x.length > 1)) {
    let i = folded.indexOf(w);
    while (i >= 0) {
      ranges.push([i, i + w.length]);
      i = folded.indexOf(w, i + w.length);
    }
  }
  if (!ranges.length) return text;
  ranges.sort((a, b) => a[0] - b[0]);
  const out: ReactNode[] = [];
  let pos = 0;
  for (const [s, e] of ranges) {
    if (s < pos) continue;
    out.push(text.slice(pos, s), <mark key={s}>{text.slice(s, e)}</mark>);
    pos = e;
  }
  out.push(text.slice(pos));
  return out;
}

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const toast = useToast();
  const tags = useTags();
  const events = useEvents();
  const [q, setQ] = useState(params.get('q') ?? '');
  const debouncedQ = useDebounced(q);
  const [showFilters, setShowFilters] = useState(KEYS.some((k) => !['q', 'sort', 'dir', 'page'].includes(k) && params.get(k)));
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const get = (k: (typeof KEYS)[number]) => params.get(k) ?? '';
  const update = (patch: Partial<Record<(typeof KEYS)[number], string>>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (!('page' in patch)) next.delete('page');
    setParams(next, { replace: true });
  };

  useEffect(() => {
    if (debouncedQ !== get('q')) update({ q: debouncedQ.trim() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQ]);

  const query: SearchParams = useMemo(() => {
    const p: Record<string, unknown> = { pageSize: PAGE_SIZE };
    for (const k of KEYS) {
      const v = params.get(k);
      if (v) p[k] = k === 'page' ? Number(v) : k === 'favorite' ? v === 'true' : v;
    }
    return p as SearchParams;
  }, [params]);

  const results = useSearch(query);
  const items = results.data?.items ?? [];
  const total = results.data?.total ?? 0;
  const page = Number(get('page') || 1);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const words = (get('q') + ' ' + get('name') + ' ' + get('company') + ' ' + get('jobTitle') + ' ' + get('city')).split(/\s+/).filter(Boolean);
  const activeFilters = KEYS.filter((k) => !['q', 'sort', 'dir', 'page'].includes(k) && get(k)).length;

  async function exportAs(kind: 'vcf' | 'csv', onlySelected: boolean) {
    try {
      const filters = Object.fromEntries(KEYS.filter((k) => k !== 'page' && get(k)).map((k) => [k, get(k)]));
      const res = await api.request<Response>(`/contacts/export.${kind}`, {
        response: true,
        query: onlySelected ? { ids: [...selected].join(',') } : filters,
      });
      await saveResponse(res, `cardvault.${kind}`);
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  }

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  return (
    <>
      <div className="page-head">
        <h1>Cerca</h1>
        <button type="button" className="btn btn-ghost btn-sm" aria-expanded={showFilters} aria-controls="filters" onClick={() => setShowFilters(!showFilters)}>
          <Faders size={18} /> Filtri{activeFilters ? ` (${activeFilters})` : ''}
        </button>
      </div>

      <div role="search" className="stack-sm">
        <div className="searchbar">
          <MagnifyingGlass size={20} aria-hidden="true" />
          <label htmlFor="q" className="visually-hidden">
            Cerca in tutti i campi
          </label>
          <input
            id="q"
            className="input"
            type="search"
            enterKeyHint="search"
            autoFocus={!params.toString()}
            placeholder="Nome, azienda, email, telefono, note…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>

        {showFilters && (
          <section id="filters" className="panel stack" aria-label="Filtri per campo">
            <div className="filters">
              {FIELD_FILTERS.map(([key, label]) => (
                <div key={key} className="field">
                  <label htmlFor={`f-${key}`}>{label}</label>
                  <input id={`f-${key}`} className="input" value={get(key)} onChange={(e) => update({ [key]: e.target.value })} />
                </div>
              ))}
              <div className="field">
                <label htmlFor="f-tag">Tag</label>
                <select id="f-tag" className="select" value={get('tag')} onChange={(e) => update({ tag: e.target.value })}>
                  <option value="">Tutti</option>
                  {tags.data?.map((t) => (
                    <option key={t.tag} value={t.tag}>
                      {t.tag} ({t.count})
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="f-metAt">Luogo o evento</label>
                <input id="f-metAt" className="input" list="f-events" value={get('metAt')} onChange={(e) => update({ metAt: e.target.value })} />
                <datalist id="f-events">
                  {events.data?.map((e) => <option key={e} value={e} />)}
                </datalist>
              </div>
              <div className="field">
                <label htmlFor="f-from">Incontrati dal</label>
                <input id="f-from" className="input" type="date" value={get('metFrom')} onChange={(e) => update({ metFrom: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="f-to">al</label>
                <input id="f-to" className="input" type="date" value={get('metTo')} onChange={(e) => update({ metTo: e.target.value })} />
              </div>
            </div>
            <div className="spread">
              <label className="checkbox">
                <input type="checkbox" checked={get('favorite') === 'true'} onChange={(e) => update({ favorite: e.target.checked ? 'true' : '' })} />
                <span>Solo preferiti</span>
              </label>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => (setQ(''), setParams({}, { replace: true }))}>
                <X size={16} /> Azzera
              </button>
            </div>
          </section>
        )}

        <div className="spread" style={{ marginTop: '0.5rem' }}>
          <span className="muted small" aria-live="polite">
            {results.isFetching && !results.data ? 'Ricerca…' : `${total} ${total === 1 ? 'risultato' : 'risultati'}`}
          </span>
          <div className="inline">
            <label htmlFor="sort" className="visually-hidden">
              Ordina per
            </label>
            <select id="sort" className="select" style={{ minHeight: 36, width: 'auto' }} value={get('sort') || 'name'} onChange={(e) => update({ sort: e.target.value })}>
              {SORT_FIELDS.map((s) => (
                <option key={s} value={s}>
                  {SORT_LABELS[s]}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              aria-label={get('dir') === 'desc' ? 'Ordine decrescente' : 'Ordine crescente'}
              onClick={() => update({ dir: get('dir') === 'desc' ? '' : 'desc' })}
            >
              {get('dir') === 'desc' ? 'Z→A' : 'A→Z'}
            </button>
          </div>
        </div>
      </div>

      {selected.size > 0 && (
        <div className="alert spread" style={{ marginTop: '0.75rem' }}>
          <span>{selected.size} selezionati</span>
          <span className="inline">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void exportAs('vcf', true)}>
              vCard
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void exportAs('csv', true)}>
              CSV
            </button>
            <button type="button" className="icon-btn" aria-label="Annulla selezione" onClick={() => setSelected(new Set())}>
              <X size={18} />
            </button>
          </span>
        </div>
      )}

      <div style={{ marginTop: '0.75rem' }}>
        {results.isError ? (
          <div className="alert alert-error">{errorMessage(results.error)}</div>
        ) : results.isLoading ? (
          <div className="stack-sm">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="skeleton" style={{ height: 64 }} />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="empty">
            <p className="muted">Nessun biglietto trovato. Prova con meno parole o controlla i filtri.</p>
          </div>
        ) : (
          <ul className="result-list panel panel-flush divide" style={{ opacity: results.isPlaceholderData ? 0.6 : 1 }}>
            {items.map((c) => (
              <ResultRow key={c.id} c={c} words={words} checked={selected.has(c.id)} onToggle={() => toggle(c.id)} />
            ))}
          </ul>
        )}
      </div>

      {pages > 1 && (
        <nav className="pager" aria-label="Pagine">
          <button type="button" className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => update({ page: String(page - 1) })}>
            Precedente
          </button>
          <span className="small">
            Pagina {page} di {pages}
          </span>
          <button type="button" className="btn btn-ghost btn-sm" disabled={page >= pages} onClick={() => update({ page: String(page + 1) })}>
            Successiva
          </button>
        </nav>
      )}

      {total > 0 && (
        <div className="inline" style={{ justifyContent: 'center', marginTop: '1.25rem' }}>
          <span className="muted small">Esporta i risultati:</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void exportAs('vcf', false)}>
            <DownloadSimple size={16} /> vCard
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void exportAs('csv', false)}>
            <DownloadSimple size={16} /> CSV (Excel)
          </button>
        </div>
      )}
    </>
  );
}

function ResultRow({ c, words, checked, onToggle }: { c: Contact; words: string[]; checked: boolean; onToggle: () => void }) {
  const sub = [c.jobTitle, c.company, c.address.city].filter(Boolean).join(' · ');
  return (
    <li className="result" style={{ padding: 0 }}>
      <label className="icon-btn" style={{ marginLeft: '0.4rem' }}>
        <input type="checkbox" checked={checked} onChange={onToggle} aria-label={`Seleziona ${displayName(c)}`} style={{ width: 18, height: 18, accentColor: 'var(--primary)' }} />
      </label>
      <Link to={`/contatti/${c.id}`} className="result" style={{ flex: 1, minWidth: 0, paddingLeft: '0.25rem' }}>
        <span className="avatar" aria-hidden="true">
          {initials(c)}
        </span>
        <span className="result-main">
          <span className="result-title" style={{ display: 'block' }}>
            {highlight(displayName(c), words)}
            {c.favorite && <Star size={14} weight="fill" style={{ color: 'var(--green)', marginLeft: 6, verticalAlign: '-1px' }} aria-label="Preferito" />}
          </span>
          <span className="result-sub" style={{ display: 'block' }}>
            {highlight(sub, words)}
          </span>
        </span>
        {c.tags[0] && <span className="tag">{c.tags[0]}</span>}
      </Link>
    </li>
  );
}
