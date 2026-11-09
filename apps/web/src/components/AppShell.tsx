import { Cards, Gear, IdentificationCard, MagnifyingGlass, Scan, WifiSlash } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { useSession } from '../lib/session';

export function useOnline() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

const NAV = [
  { to: '/', label: 'Wallet', short: 'Wallet', icon: Cards, end: true },
  { to: '/cerca', label: 'Cerca', short: 'Cerca', icon: MagnifyingGlass, end: false },
  { to: '/il-mio-biglietto', label: 'Il mio biglietto', short: 'Il mio', icon: IdentificationCard, end: false },
  { to: '/impostazioni', label: 'Impostazioni', short: 'Altro', icon: Gear, end: false },
];

export function AppShell() {
  const online = useOnline();
  const { status } = useSession();
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  return (
    <div className="app">
      <a href="#main" className="visually-hidden">
        Vai al contenuto
      </a>
      <header className="topbar">
        {(!online || status === 'offline') && (
          <div className="banner" role="status">
            <WifiSlash size={16} /> Sei offline: le scansioni restano sul dispositivo e si sincronizzano dopo.
          </div>
        )}
        {needRefresh && (
          <div className="banner update" role="status">
            Nuova versione disponibile.
            <button
              type="button"
              className="btn btn-sm btn-secondary"
              style={{ color: '#fff', borderColor: '#fff' }}
              onClick={() => updateServiceWorker(true)}
            >
              Aggiorna
            </button>
          </div>
        )}
        <div className="topbar-inner">
          <NavLink to="/" className="brand" aria-label="CardVault, vai al wallet">
            <img src="/favicon.svg" alt="" />
            CardVault
          </NavLink>
          <nav className="topnav" aria-label="Principale">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end}>
                {n.label}
              </NavLink>
            ))}
            <NavLink to="/scansiona" className="btn btn-primary btn-sm" style={{ marginLeft: '0.5rem' }}>
              <Scan size={18} /> Scansiona
            </NavLink>
          </nav>
        </div>
      </header>

      <main id="main" className="main">
        <Outlet />
      </main>

      <nav className="bottomnav" aria-label="Principale">
        <ul>
          {NAV.slice(0, 2).map((n) => (
            <li key={n.to}>
              <NavLink to={n.to} end={n.end}>
                <n.icon size={24} />
                {n.short}
              </NavLink>
            </li>
          ))}
          <li>
            <NavLink to="/scansiona" className="scan-fab" aria-label="Scansiona biglietto">
              <Scan size={28} />
            </NavLink>
          </li>
          {NAV.slice(2).map((n) => (
            <li key={n.to}>
              <NavLink to={n.to} end={n.end}>
                <n.icon size={24} />
                {n.short}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
