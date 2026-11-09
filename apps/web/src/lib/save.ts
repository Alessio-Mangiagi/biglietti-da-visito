import type { Contact, ContactInput } from '@cardvault/shared';
import { api, NetworkError } from './api';
import { enqueue, uploadPhoto } from './outbox';

export interface Duplicate {
  id: string;
  name: string;
  company: string;
  matchedOn: Array<'email' | 'phone'>;
}

export type SaveOutcome =
  | { kind: 'saved'; contact: Contact; duplicates: Duplicate[] }
  | { kind: 'queued' };

export interface Photos {
  front?: Blob;
  back?: Blob;
}

/**
 * Creates a contact and uploads its photos. Whatever cannot reach the server (offline,
 * network drop half-way) goes to the outbox under the same clientRef, so a retry never
 * creates a second contact.
 */
export async function createContact(input: ContactInput, photos: Photos, forceOffline = false): Promise<SaveOutcome> {
  const clientRef = crypto.randomUUID();
  if (forceOffline || !navigator.onLine) {
    await enqueue({ clientRef, contact: input, ...photos });
    return { kind: 'queued' };
  }
  let created: { contact: Contact; duplicates: Duplicate[] };
  try {
    created = await api.post('/contacts', { ...input, clientRef });
  } catch (err) {
    if (!(err instanceof NetworkError)) throw err;
    await enqueue({ clientRef, contact: input, ...photos });
    return { kind: 'queued' };
  }
  try {
    if (photos.front) await uploadPhoto(created.contact.id, 'front', photos.front);
    if (photos.back) await uploadPhoto(created.contact.id, 'back', photos.back);
  } catch {
    // contact exists; let the outbox finish the photos later
    await enqueue({ clientRef, contact: input, ...photos, serverId: created.contact.id });
  }
  return { kind: 'saved', ...created };
}

export async function mergeInto(targetId: string, sourceId: string): Promise<Contact> {
  return api.post<Contact>(`/contacts/${targetId}/merge`, { sourceId });
}

export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
