import { useState } from 'react';
import { errorMessage } from '../lib/api';
import { mergeInto, type Duplicate } from '../lib/save';
import { Modal } from './Modal';

interface Props {
  newId: string;
  duplicates: Duplicate[];
  onDone: (keptId: string, merged: boolean) => void;
}

const BY = { email: 'stessa email', phone: 'stesso telefono' } as const;

/** Offered right after saving when the new contact shares an e-mail or phone with others. */
export function DuplicateDialog({ newId, duplicates, onDone }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const first = duplicates[0];
  if (!first) return null;

  async function merge(targetId: string) {
    setBusy(true);
    setError('');
    try {
      await mergeInto(targetId, newId);
      onDone(targetId, true);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      title="Possibile duplicato"
      onClose={() => onDone(newId, false)}
      actions={
        <>
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => onDone(newId, false)}>
            Mantieni entrambi
          </button>
          {duplicates.length === 1 && (
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void merge(first.id)}>
              Unisci
            </button>
          )}
        </>
      }
    >
      <p>Hai già in archivio {duplicates.length === 1 ? 'un contatto' : 'alcuni contatti'} con dati in comune:</p>
      <ul className="result-list panel panel-flush divide">
        {duplicates.map((d) => (
          <li key={d.id} className="result spread">
            <div className="result-main">
              <div className="result-title">{d.name}</div>
              <div className="result-sub">
                {[d.company, d.matchedOn.map((m) => BY[m]).join(' e ')].filter(Boolean).join(' · ')}
              </div>
            </div>
            {duplicates.length > 1 && (
              <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void merge(d.id)}>
                Unisci
              </button>
            )}
          </li>
        ))}
      </ul>
      <p className="muted small">
        Unendo, i dati nuovi completano quelli esistenti: nessun campo già compilato viene sovrascritto e le note vengono accodate.
      </p>
      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}
    </Modal>
  );
}
