import { Link } from 'react-router';

export function NotFoundPage() {
  return (
    <div className="empty">
      <p className="eyebrow">Errore 404</p>
      <h1>Pagina non trovata</h1>
      <p className="muted">Il link potrebbe essere vecchio o il contatto eliminato.</p>
      <Link to="/" className="btn btn-primary">
        Torna al wallet
      </Link>
    </div>
  );
}
