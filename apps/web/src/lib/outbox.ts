import type { Contact } from '@cardvault/shared';
import { api, ApiError, NetworkError } from './api';
import { db, type OutboxItem } from './idb';

type Listener = () => void;
const listeners = new Set<Listener>();
export const onOutboxChange = (fn: Listener) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
const notify = () => listeners.forEach((fn) => fn());

export async function listOutbox(): Promise<OutboxItem[]> {
  try {
    return await (await db()).getAllFromIndex('outbox', 'createdAt');
  } catch {
    return [];
  }
}

export async function enqueue(item: Omit<OutboxItem, 'createdAt' | 'attempts'>): Promise<void> {
  await (await db()).put('outbox', { ...item, createdAt: Date.now(), attempts: 0 });
  notify();
}

export async function removeFromOutbox(clientRef: string) {
  await (await db()).delete('outbox', clientRef);
  notify();
}

export async function uploadPhoto(id: string, side: 'front' | 'back', blob: Blob) {
  await api.request(`/contacts/${id}/images/${side}`, { method: 'PUT', raw: blob, contentType: blob.type || 'image/jpeg' });
}

let running: Promise<number> | null = null;

/**
 * Sends queued scans. No Background Sync on iOS, so this runs on start-up, when the
 * network comes back and when the app returns to the foreground.
 * Returns how many items were synced.
 */
export function flushOutbox(): Promise<number> {
  if (running) return running;
  running = (async () => {
    if (!navigator.onLine || !api.hasToken) return 0;
    let done = 0;
    for (const item of await listOutbox()) {
      try {
        let id = item.serverId;
        if (!id) {
          const res = await api.post<{ contact: Contact }>('/contacts', { ...item.contact, clientRef: item.clientRef });
          id = res.contact.id;
          item.serverId = id;
          await (await db()).put('outbox', item);
        }
        if (item.front) await uploadPhoto(id, 'front', item.front);
        if (item.back) await uploadPhoto(id, 'back', item.back);
        await (await db()).delete('outbox', item.clientRef);
        done++;
      } catch (err) {
        if (err instanceof NetworkError) break; // offline again: retry later
        const message = err instanceof ApiError ? err.message : String(err);
        await (await db()).put('outbox', { ...item, attempts: item.attempts + 1, lastError: message });
        if (err instanceof ApiError && err.status === 401) break;
      }
    }
    notify();
    return done;
  })().finally(() => {
    running = null;
  });
  return running;
}
