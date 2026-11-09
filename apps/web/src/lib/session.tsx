import type { AuthResponse, User } from '@cardvault/shared';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, NetworkError } from './api';
import { clearLocalData, kvGet, kvSet, requestPersistence } from './idb';
import { flushOutbox } from './outbox';

/**
 * loading       – checking the refresh cookie
 * authenticated – online session with an access token
 * offline       – no network at start-up but a user was signed in on this device:
 *                 cached wallet is browsable and scans are queued
 * anonymous     – show the login screen
 */
export type SessionStatus = 'loading' | 'authenticated' | 'offline' | 'anonymous';

interface SessionValue {
  status: SessionStatus;
  user: User | null;
  signIn: (res: AuthResponse) => void;
  signOut: () => Promise<void>;
  setUser: (u: User) => void;
}

const Ctx = createContext<SessionValue | null>(null);
const USER_KEY = 'session-user';

export function SessionProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [user, setUserState] = useState<User | null>(null);

  const boot = useCallback(async () => {
    try {
      const res = await api.refresh();
      if (res) {
        setUserState(res.user);
        setStatus('authenticated');
        void kvSet(USER_KEY, res.user);
        void requestPersistence();
        void flushOutbox();
      } else {
        setStatus('anonymous');
      }
    } catch (err) {
      const cached = await kvGet<User>(USER_KEY);
      if (err instanceof NetworkError && cached) {
        setUserState(cached);
        setStatus('offline');
      } else {
        setStatus('anonymous');
      }
    }
  }, []);

  useEffect(() => {
    void boot();
  }, [boot]);

  // server says the session is over (refresh failed) → back to login
  useEffect(() => {
    const off = api.onSession((u) => {
      if (!u) {
        setUserState(null);
        setStatus((s) => (s === 'loading' ? s : 'anonymous'));
      }
    });
    return () => void off();
  }, []);

  // reconnect: upgrade an offline session, push the queue
  useEffect(() => {
    const online = () => {
      if (status === 'offline') void boot();
      else if (status === 'authenticated') void flushOutbox().then((n) => {
          if (n) void qc.invalidateQueries({ queryKey: ['contacts'] });
        });
    };
    const visible = () => document.visibilityState === 'visible' && online();
    window.addEventListener('online', online);
    document.addEventListener('visibilitychange', visible);
    return () => {
      window.removeEventListener('online', online);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [status, boot, qc]);

  const value = useMemo<SessionValue>(
    () => ({
      status,
      user,
      signIn(res) {
        api.setSession(res);
        setUserState(res.user);
        setStatus('authenticated');
        void kvSet(USER_KEY, res.user);
        void requestPersistence();
        void flushOutbox();
      },
      async signOut() {
        await api.post('/auth/logout').catch(() => {});
        api.setSession(null);
        qc.clear();
        await clearLocalData();
        setUserState(null);
        setStatus('anonymous');
      },
      setUser(u) {
        setUserState(u);
        void kvSet(USER_KEY, u);
      },
    }),
    [status, user, qc],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession outside SessionProvider');
  return v;
}
