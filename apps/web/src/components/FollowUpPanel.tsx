import { displayName, type Contact } from '@cardvault/shared';
import { BellRinging, CalendarPlus, Check } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { errorMessage, saveBlob } from '../lib/api';
import { setFollowUp } from '../lib/contacts';
import { today } from '../lib/save';
import { useToast } from './Toasts';

const QUICK = [
  { label: 'Tra 3 giorni', days: 3 },
  { label: 'Tra una settimana', days: 7 },
  { label: 'Tra un mese', days: 30 },
];

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const formatDay = (iso: string) => {
  const t = today();
  if (iso === t) return 'oggi';
  if (iso === addDays(t, 1)) return 'domani';
  if (iso === addDays(t, -1)) return 'ieri';
  return new Date(`${iso}T12:00:00`).toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'long' });
};

/** Calendar entry for the reminder: works on every phone, also without notifications. */
export function reminderIcs(c: Contact): Blob {
  const day = c.followUpOn!.replace(/-/g, '');
  const next = addDays(c.followUpOn!, 1).replace(/-/g, '');
  const esc = (s: string) => s.replace(/[\\;,]/g, (m) => `\\${m}`).replace(/\r?\n/g, '\\n');
  const phone = c.phones[0]?.value;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//CardVault//IT',
    'BEGIN:VEVENT',
    `UID:${c.id}-${day}@cardvault`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')}`,
    `DTSTART;VALUE=DATE:${day}`,
    `DTEND;VALUE=DATE:${next}`,
    `SUMMARY:${esc(`Ricontatta ${displayName(c)}`)}`,
    `DESCRIPTION:${esc([c.followUpNote, c.company, phone, c.emails[0]].filter(Boolean).join('\n'))}`,
    'BEGIN:VALARM',
    'TRIGGER:PT9H',
    'ACTION:DISPLAY',
    `DESCRIPTION:${esc(`Ricontatta ${displayName(c)}`)}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return new Blob([lines.join('\r\n')], { type: 'text/calendar' });
}

export function FollowUpPanel({ contact: c }: { contact: Contact }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [custom, setCustom] = useState('');
  const [note, setNote] = useState(c.followUpNote);

  async function set(on: string | null) {
    setBusy(true);
    try {
      await setFollowUp(qc, c.id, on, on ? note : '');
      toast(on ? `Promemoria per ${formatDay(on)}` : 'Fatto: promemoria chiuso');
      if (!on) setNote('');
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  if (c.followUpOn) {
    const late = c.followUpOn < today();
    return (
      <section className={`panel followup${late ? ' is-late' : ''}`} aria-labelledby="fu-title">
        <div className="spread">
          <h2 id="fu-title" className="h3">
            <BellRinging size={20} aria-hidden="true" /> Ricontatta {formatDay(c.followUpOn)}
          </h2>
          {late && <span className="tag tag-warning">In ritardo</span>}
        </div>
        {c.followUpNote && <p style={{ margin: 0 }}>{c.followUpNote}</p>}
        <div className="inline">
          <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void set(null)}>
            <Check size={16} /> Fatto
          </button>
          <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void set(addDays(today(), 7))}>
            Rimanda di una settimana
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => saveBlob(reminderIcs(c), `Ricontatta ${displayName(c)}.ics`)}
          >
            <CalendarPlus size={16} /> Aggiungi al calendario
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="panel followup" aria-labelledby="fu-title">
      <h2 id="fu-title" className="h3">
        <BellRinging size={20} aria-hidden="true" /> Ricontattare?
      </h2>
      <div className="field">
        <label htmlFor="fu-note">Promemoria (facoltativo)</label>
        <input id="fu-note" className="input" maxLength={500} placeholder="Es. inviare il preventivo" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <div className="inline">
        {QUICK.map((q) => (
          <button key={q.days} type="button" className="chip" disabled={busy} onClick={() => void set(addDays(today(), q.days))}>
            {q.label}
          </button>
        ))}
      </div>
      <form
        className="inline"
        onSubmit={(e) => {
          e.preventDefault();
          if (custom) void set(custom);
        }}
      >
        <label htmlFor="fu-date" className="visually-hidden">
          Scegli una data
        </label>
        <input id="fu-date" className="input" type="date" min={today()} value={custom} onChange={(e) => setCustom(e.target.value)} style={{ maxWidth: 200 }} />
        <button type="submit" className="btn btn-secondary btn-sm" disabled={!custom || busy}>
          Imposta
        </button>
      </form>
    </section>
  );
}
