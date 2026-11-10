import type { ContactInput } from '@cardvault/shared';
import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { useSession } from './session';

/**
 * "Modalità evento": while it is on, every new card gets the event name, its date and a
 * tag, so after a fair the cards can be found together. Per device and per user.
 */
export interface EventMode {
  name: string;
  /** YYYY-MM-DD */
  date: string;
  tag: string;
  startedAt: number;
}

const key = (userId: string) => `cv-event:${userId}`;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());

function read(userId: string | undefined): string | null {
  if (!userId) return null;
  try {
    return localStorage.getItem(key(userId));
  } catch {
    return null;
  }
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  // another tab started or ended the event
  const onStorage = (e: StorageEvent) => e.key?.startsWith('cv-event:') && fn();
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(fn);
    window.removeEventListener('storage', onStorage);
  };
}

function parseEvent(raw: string | null): EventMode | null {
  try {
    return raw ? (JSON.parse(raw) as EventMode) : null;
  } catch {
    return null;
  }
}

export function useEventMode() {
  const { user } = useSession();
  const raw = useSyncExternalStore(subscribe, () => read(user?.id));
  const event = useMemo(() => parseEvent(raw), [raw]);

  const start = useCallback(
    (name: string, date: string) => {
      if (!user) return;
      const ev: EventMode = { name: name.trim().slice(0, 200), date, tag: name.trim().slice(0, 40), startedAt: Date.now() };
      try {
        localStorage.setItem(key(user.id), JSON.stringify(ev));
      } catch {
        /* storage blocked: nothing to remember */
      }
      notify();
    },
    [user],
  );

  const stop = useCallback(() => {
    if (!user) return;
    try {
      localStorage.removeItem(key(user.id));
    } catch {
      /* ignore */
    }
    notify();
  }, [user]);

  return { event, start, stop };
}

/** Event fields for a new card; what the card (or the user) already says wins. */
export function applyEvent<T extends Pick<ContactInput, 'metAt' | 'metOn' | 'tags'>>(c: T, ev: EventMode | null): T {
  if (!ev) return c;
  const hasTag = c.tags.some((t) => t.toLowerCase() === ev.tag.toLowerCase());
  return { ...c, metAt: c.metAt || ev.name, metOn: ev.date, tags: hasTag ? c.tags : [...c.tags, ev.tag] };
}
