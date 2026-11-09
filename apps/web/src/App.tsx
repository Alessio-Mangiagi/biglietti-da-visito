import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router';
import { AppShell } from './components/AppShell';
import { ChunkBoundary } from './components/ChunkBoundary';
import { GuestOnly, RequireAuth, Splash } from './components/Guards';
import { ForgotPasswordPage, LoginPage, RegisterPage, ResetPasswordPage, VerifyEmailPage } from './pages/Auth';
import { NotFoundPage } from './pages/NotFound';
import { WalletPage } from './pages/Wallet';

// the wallet and login load first; every other screen is its own chunk
const ScanPage = lazy(() => import('./pages/Scan'));
const ContactDetailPage = lazy(() => import('./pages/ContactDetail').then((m) => ({ default: m.ContactDetailPage })));
const ContactEditPage = lazy(() => import('./pages/ContactEdit').then((m) => ({ default: m.ContactEditPage })));
const MyCardPage = lazy(() => import('./pages/MyCard').then((m) => ({ default: m.MyCardPage })));
const PrivacyPage = lazy(() => import('./pages/Privacy').then((m) => ({ default: m.PrivacyPage })));
const SearchPage = lazy(() => import('./pages/Search').then((m) => ({ default: m.SearchPage })));
const SettingsPage = lazy(() => import('./pages/Settings').then((m) => ({ default: m.SettingsPage })));

const page = (el: React.ReactNode) => (
  <ChunkBoundary>
    <Suspense fallback={<div className="skeleton" style={{ height: 240 }} aria-busy="true" />}>{el}</Suspense>
  </ChunkBoundary>
);

const guest = (el: React.ReactNode) => <GuestOnly>{el}</GuestOnly>;

export function App() {
  return (
    <Routes>
      <Route path="/accedi" element={guest(<LoginPage />)} />
      <Route path="/registrati" element={guest(<RegisterPage />)} />
      <Route path="/password-dimenticata" element={guest(<ForgotPasswordPage />)} />
      <Route path="/reimposta-password" element={<ResetPasswordPage />} />
      <Route path="/conferma-email" element={<VerifyEmailPage />} />
      <Route path="/privacy" element={page(<PrivacyPage />)} />
      <Route
        path="/scansiona"
        element={
          <RequireAuth>
            <ChunkBoundary>
              <Suspense fallback={<Splash />}>
                <ScanPage />
              </Suspense>
            </ChunkBoundary>
          </RequireAuth>
        }
      />
      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route index element={<WalletPage />} />
        <Route path="cerca" element={page(<SearchPage />)} />
        <Route path="contatti/nuovo" element={page(<ContactEditPage />)} />
        <Route path="contatti/:id" element={page(<ContactDetailPage />)} />
        <Route path="contatti/:id/modifica" element={page(<ContactEditPage />)} />
        <Route path="il-mio-biglietto" element={page(<MyCardPage />)} />
        <Route path="impostazioni" element={page(<SettingsPage />)} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
