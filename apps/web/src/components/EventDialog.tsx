import { useState } from 'react';
import { useEvents } from '../lib/contacts';
import { useEventMode } from '../lib/event';
import { today } from '../lib/save';
import { Modal } from './Modal';
import { useToast } from './Toasts';

/** Starts "modalità evento": name and date of the fair/meeting, reused by every new card. */
export function EventDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { start } = useEventMode();
  const events = useEvents();
  const toast = useToast();
  const [name, setName] = useState('');
  const [date, setDate] = useState(today);
  const [error, setError] = useState('');

  function submit() {
    if (name.trim().length < 2) return setError('Scrivi il nome dell’evento');
    start(name, date || today());
    toast(`Modalità evento attiva: ${name.trim()}`);
    setName('');
    setError('');
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Modalità evento"
      actions={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Annulla
          </button>
          <button type="submit" form="event-form" className="btn btn-primary">
            Attiva
          </button>
        </>
      }
    >
      <form
        id="event-form"
        className="stack-sm"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <p className="muted small" style={{ margin: 0 }}>
          Finché è attiva, ogni biglietto che scansioni prende nome dell’evento, data e un tag: dopo la fiera li ritrovi tutti insieme.
        </p>
        <div className="field">
          <label htmlFor="event-name">Nome dell’evento</label>
          <input
            id="event-name"
            className="input"
            list="event-suggestions"
            placeholder="Es. SAIE Bologna 2026"
            autoComplete="off"
            maxLength={200}
            value={name}
            aria-invalid={!!error || undefined}
            aria-describedby={error ? 'event-error' : undefined}
            onChange={(e) => setName(e.target.value)}
          />
          <datalist id="event-suggestions">
            {events.data?.map((ev) => <option key={ev} value={ev} />)}
          </datalist>
          {error && (
            <span id="event-error" className="field-error">
              {error}
            </span>
          )}
        </div>
        <div className="field">
          <label htmlFor="event-date">Data</label>
          <input id="event-date" className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </form>
    </Modal>
  );
}
