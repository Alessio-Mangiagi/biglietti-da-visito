import { displayName, type Contact } from '@cardvault/shared';
import { BellRinging, BellSimpleSlash, CalendarPlus, Check } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { addDays, formatDay, reminderIcs } from '../components/FollowUpPanel';
import { useToast } from '../components/Toasts';
import { errorMessage, saveBlob } from '../lib/api';
import { setFollowUp, useFollowUps } from '../lib/contacts';
import { enablePush, pushState, testPush, type PushState } from '../lib/push';
import { today } from '../lib/save';

export function FollowUpsPage() {
  const list = useFollowUps();
  const t = today();
  const groups: Array<{ title: string; items: Contact[] }> = [
    { title: 'In ritardo', items: [] },
    { title: 'Oggi', items: [] },
    { title: 'Prossimi', items: [] },
  ];
  for (const c of list.data ?? []) groups[c.followUpOn! < t ? 0 : c.followUpOn === t ? 1 : 2]!.items.push(c);

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">Promemoria</p>
          <h1>Da ricontattare</h1>
        </div>
      </div>
      <PushBox />
      {list.isLoading ? (
        <div className="skeleton" style={{ height: 160 }} aria-busy="true" />
      ) : list.isError ? (
        <div className="alert alert-error" role="alert">
          {errorMessage(list.error)}
        </div>
      ) : !list.data?.length ? (
        <div className="empty">
          <BellRinging size={40} aria-hidden="true" />
          <p className="muted" style={{ maxWidth: '42ch' }}>
            Nessun promemoria. Dalla scheda di un contatto scegli «Tra una settimana» o una data: lo ritrovi qui e, se attivi le notifiche, ti avvisiamo
            quel giorno.
          </p>
        </div>
      ) : (
        groups
          .filter((g) => g.items.length)
          .map((g) => (
            <section key={g.title} className="stack-sm" style={{ marginBottom: '1.5rem' }}>
              <h2 className="h3">
                {g.title} <span className="muted small">· {g.items.length}</span>
              </h2>
              <ul className="result-list">
                {g.items.map((c) => (
                  <FollowUpRow key={c.id} contact={c} late={g.title === 'In ritardo'} />
                ))}
              </ul>
            </section>
          ))
      )}
    </>
  );
}

function FollowUpRow({ contact: c, late }: { contact: Contact; late: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function set(on: string | null) {
    setBusy(true);
    try {
      await setFollowUp(qc, c.id, on, c.followUpNote);
      toast(on ? `Rimandato a ${formatDay(on)}` : `${displayName(c)}: fatto`);
    } catch (err) {
      toast(errorMessage(err), 'error');
      setBusy(false);
    }
  }
  return (
    <li className="result followup-row">
      <Link to={`/contatti/${c.id}`} className="result-main">
        <span className="result-title">{displayName(c)}</span>
        <span className="result-sub">
          <span className={late ? 'text-warning' : undefined}>{formatDay(c.followUpOn!)}</span>
          {c.followUpNote ? ` · ${c.followUpNote}` : c.company ? ` · ${c.company}` : ''}
        </span>
      </Link>
      <div className="inline followup-actions">
        <button type="button" className="icon-btn" aria-label={`Fatto: ${displayName(c)}`} disabled={busy} onClick={() => void set(null)}>
          <Check size={20} />
        </button>
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void set(addDays(today(), 7))}>
          +7 gg
        </button>
        <button type="button" className="icon-btn" aria-label={`Aggiungi al calendario: ${displayName(c)}`} onClick={() => saveBlob(reminderIcs(c), `Ricontatta ${displayName(c)}.ics`)}>
          <CalendarPlus size={20} />
        </button>
      </div>
    </li>
  );
}

/** Daily push reminder: on/off, with the iPhone "add to Home Screen" caveat. */
export function PushBox() {
  const toast = useToast();
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    pushState()
      .then(setState)
      .catch(() => setState('unsupported'));
  }, []);
  if (state === 'server-off') {
    return (
      <p className="muted small" style={{ marginBottom: '1rem' }}>
        Le notifiche non sono ancora attive su questo server: per ora usa «Aggiungi al calendario» sui promemoria.
      </p>
    );
  }
  if (!state || state === 'on') {
    return state === 'on' ? (
      <p className="muted small inline" style={{ marginBottom: '1rem' }}>
        <BellRinging size={16} aria-hidden="true" /> Notifiche attive su questo dispositivo: ti avvisiamo la mattina in cui c’è qualcuno da ricontattare.{' '}
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() =>
            void testPush()
              .then((r) => toast(r.sent ? 'Notifica di prova inviata' : 'Nessun dispositivo raggiunto', r.sent ? 'success' : 'error'))
              .catch((e) => toast(errorMessage(e), 'error'))
          }
        >
          Prova
        </button>
      </p>
    ) : null;
  }
  return (
    <div className="alert push-box" style={{ marginBottom: '1rem' }}>
      {state === 'needs-install' ? (
        <p style={{ margin: 0 }}>
          <strong>Vuoi un avviso il giorno giusto?</strong> Su iPhone le notifiche funzionano con l’app nella schermata Home: tocca Condividi → «Aggiungi a
          Home», apri CardVault da lì e torna su questa pagina. Intanto puoi usare «Aggiungi al calendario».
        </p>
      ) : state === 'unsupported' ? (
        <p style={{ margin: 0 }}>Questo browser non supporta le notifiche: usa «Aggiungi al calendario» sui promemoria.</p>
      ) : state === 'denied' ? (
        <p className="inline" style={{ margin: 0 }}>
          <BellSimpleSlash size={18} aria-hidden="true" /> Notifiche bloccate: riattivale dalle impostazioni del browser per questo sito.
        </p>
      ) : (
        <div className="spread">
          <span>
            <strong>Avvisami il giorno giusto</strong>
            <br />
            <span className="small">Una notifica la mattina in cui hai qualcuno da ricontattare.</span>
          </span>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const s = await enablePush();
                setState(s);
                if (s === 'on') toast('Notifiche attivate');
              } catch (err) {
                toast(errorMessage(err), 'error');
              } finally {
                setBusy(false);
              }
            }}
          >
            <BellRinging size={16} /> Attiva notifiche
          </button>
        </div>
      )}
    </div>
  );
}
