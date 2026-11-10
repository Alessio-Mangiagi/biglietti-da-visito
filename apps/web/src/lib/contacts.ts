import type { Contact, Page, SearchQuery, WalletStats } from '@cardvault/shared';
import { keepPreviousData, useInfiniteQuery, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, NetworkError } from './api';
import { kvGet, kvSet } from './idb';
import { today } from './save';

export type SearchParams = Partial<SearchQuery>;
const WALLET_CACHE = 'wallet-cache';
const PAGE_SIZE = 30;
/** The card file loads bigger pages: jumping to a letter may need everything before it. */
export const ROLODEX_PAGE_SIZE = 100;

/** Wallet: newest first, infinite. Page 1 is mirrored in IndexedDB for offline use. */
export function useWallet(params: SearchParams = {}, pageSize = PAGE_SIZE) {
  // no filters (sorting alone still counts as the plain wallet): mirrored offline, per order
  const isDefault = !Object.entries(params).some(([k, v]) => k !== 'sort' && k !== 'dir' && v !== undefined && v !== '');
  const cacheKey = `${WALLET_CACHE}:${params.sort ?? 'createdAt'}`;
  return useInfiniteQuery({
    queryKey: ['contacts', 'wallet', params, pageSize],
    initialPageParam: 1,
    queryFn: async ({ pageParam }) => {
      try {
        const page = await api.get<Page<Contact>>('/contacts', {
          sort: 'createdAt',
          dir: 'desc',
          ...params,
          page: pageParam,
          pageSize,
        });
        if (isDefault && pageParam === 1) void kvSet(cacheKey, page);
        return { ...page, offline: false };
      } catch (err) {
        const cached = err instanceof NetworkError && isDefault && pageParam === 1 ? await kvGet<Page<Contact>>(cacheKey) : undefined;
        if (cached) return { ...cached, offline: true };
        throw err;
      }
    },
    getNextPageParam: (last) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
  });
}

export function useSearch(params: SearchParams, enabled = true) {
  return useQuery({
    queryKey: ['contacts', 'search', params],
    queryFn: () => api.get<Page<Contact>>('/contacts', params as Record<string, string>),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useContact(id: string | undefined) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: ['contacts', 'one', id],
    enabled: !!id,
    queryFn: async () => {
      try {
        return await api.get<Contact>(`/contacts/${id}`);
      } catch (err) {
        if (!(err instanceof NetworkError)) throw err;
        // offline: look in what the wallet already loaded
        const pages = qc.getQueriesData<{ pages: Array<Page<Contact>> }>({ queryKey: ['contacts', 'wallet'] });
        for (const [, data] of pages) {
          const hit = data?.pages.flatMap((p) => p.items).find((c) => c.id === id);
          if (hit) return hit;
        }
        const cached = (await kvGet<Page<Contact>>(`${WALLET_CACHE}:createdAt`)) ?? (await kvGet<Page<Contact>>(`${WALLET_CACHE}:name`));
        const hit = cached?.items.find((c) => c.id === id);
        if (hit) return hit;
        throw err;
      }
    },
  });
}

export function useTags() {
  return useQuery({
    queryKey: ['contacts', 'tags'],
    queryFn: () => api.get<Array<{ tag: string; count: number }>>('/contacts/tags'),
    staleTime: 60_000,
  });
}

export function useEvents() {
  return useQuery({
    queryKey: ['contacts', 'events'],
    queryFn: () => api.get<string[]>('/contacts/events'),
    staleTime: 60_000,
  });
}

/** Authenticated photo → object URL (an <img src> cannot carry the bearer token). */
export function useContactImage(id: string | undefined, side: 'front' | 'back', enabled: boolean, version?: string, teamId?: string) {
  const path = teamId ? `/teams/${teamId}/contacts/${id}/images/${side}` : `/contacts/${id}/images/${side}`;
  const q = useQuery({
    queryKey: ['contacts', 'image', id, side, version, teamId],
    enabled: !!id && enabled,
    staleTime: Infinity,
    gcTime: 5 * 60_000,
    queryFn: async () => {
      const res = await api.request<Response>(path, { response: true });
      return res.blob();
    },
  });
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!q.data) return setUrl(undefined);
    const u = URL.createObjectURL(q.data);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [q.data]);
  return { url, isLoading: q.isLoading, error: q.error };
}

/** Header numbers; `today` is the device's own date so "due" matches the user's calendar. */
export function useStats() {
  return useQuery({
    queryKey: ['contacts', 'stats'],
    queryFn: () => api.get<WalletStats>('/contacts/stats', { today: today() }),
    staleTime: 60_000,
  });
}

export function useFollowUps() {
  return useQuery({
    queryKey: ['contacts', 'follow-ups'],
    queryFn: () => api.get<Contact[]>('/contacts/follow-ups'),
  });
}

export async function setFollowUp(qc: QueryClient, id: string, on: string | null, note = ''): Promise<Contact> {
  const updated = await api.put<Contact>(`/contacts/${id}/follow-up`, { on, note });
  qc.setQueryData(['contacts', 'one', id], updated);
  void qc.invalidateQueries({ queryKey: ['contacts', 'follow-ups'] });
  void qc.invalidateQueries({ queryKey: ['contacts', 'stats'] });
  return updated;
}

export interface LetterIndex {
  letter: string;
  /** Position of the first card with this letter, in name order. */
  offset: number;
  count: number;
}

/** A–Z tabs of the card file: where each letter starts, for the current filter. */
export function useLetters(params: SearchParams, enabled: boolean) {
  return useQuery({
    queryKey: ['contacts', 'letters', params],
    enabled,
    queryFn: () => api.get<LetterIndex[]>('/contacts/letters', params as Record<string, string>),
    staleTime: 30_000,
  });
}
