import type { ContactInput } from '@cardvault/shared';
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

export interface OutboxItem {
  /** Idempotency key sent to the API as `clientRef`. */
  clientRef: string;
  contact: ContactInput;
  front?: Blob;
  back?: Blob;
  createdAt: number;
  attempts: number;
  lastError?: string;
  /** Set once the contact exists server-side; only photos remain to upload. */
  serverId?: string;
}

interface Schema extends DBSchema {
  outbox: { key: string; value: OutboxItem; indexes: { createdAt: number } };
  kv: { key: string; value: unknown };
}

let dbPromise: Promise<IDBPDatabase<Schema>> | null = null;

export function db() {
  dbPromise ??= openDB<Schema>('cardvault', 1, {
    upgrade(d) {
      const outbox = d.createObjectStore('outbox', { keyPath: 'clientRef' });
      outbox.createIndex('createdAt', 'createdAt');
      d.createObjectStore('kv');
    },
  });
  return dbPromise;
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  try {
    return (await (await db()).get('kv', key)) as T | undefined;
  } catch {
    return undefined;
  }
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  try {
    await (await db()).put('kv', value, key);
  } catch {
    /* private mode / quota: cache is best effort */
  }
}

/** Logout / account deletion: nothing of the previous user stays on the device. */
export async function clearLocalData(): Promise<void> {
  try {
    const d = await db();
    await Promise.all([d.clear('outbox'), d.clear('kv')]);
  } catch {
    /* ignore */
  }
}

/** Asks the browser not to evict our data (Safari ≥ 17, Chrome). */
export async function requestPersistence() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch {
    /* not supported */
  }
}
