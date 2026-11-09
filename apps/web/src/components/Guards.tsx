import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useSession } from '../lib/session';

export function Splash() {
  return (
    <div className="auth-page" aria-busy="true">
      <div className="auth-brand">
        <img src="/favicon.svg" alt="" width={64} height={64} />
        <span className="muted">Caricamento…</span>
      </div>
    </div>
  );
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useSession();
  const location = useLocation();
  if (status === 'loading') return <Splash />;
  if (status === 'anonymous') {
    return <Navigate to="/accedi" replace state={{ from: location.pathname + location.search }} />;
  }
  return <>{children}</>;
}

export function GuestOnly({ children }: { children: ReactNode }) {
  const { status } = useSession();
  const location = useLocation();
  if (status === 'loading') return <Splash />;
  if (status === 'authenticated' || status === 'offline') {
    const from = (location.state as { from?: string } | null)?.from ?? '/';
    return <Navigate to={from} replace />;
  }
  return <>{children}</>;
}
