import { Component, type ReactNode } from 'react';

interface State {
  failed: boolean;
}

/**
 * A lazy screen that cannot be downloaded (offline before the service worker cached it,
 * or a deploy replaced the chunk) would otherwise leave a blank page.
 */
export class ChunkBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="empty" role="alert">
        <h2>Schermata non disponibile</h2>
        <p className="muted" style={{ maxWidth: '40ch' }}>
          {navigator.onLine
            ? 'Non è stato possibile caricarla: probabilmente è uscita una nuova versione.'
            : 'Sei offline e questa schermata non è ancora stata salvata sul dispositivo.'}
        </p>
        <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
          Riprova
        </button>
      </div>
    );
  }
}
