import type { Contact, Page, SearchQuery } from '@cardvault/shared';
import { keepPreviousData, useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, NetworkError } from './api';
import { kvGet, kvSet } from './idb';

export type SearchParams = Partial<SearchQuery>;
const WALLET_CACHE = 'wallet-cache';
const PAGE_SIZE = 30;

/** Wallet: newest first, infinite. Page 1 is mirrored in IndexedDB for offline use. */
export function useWallet(params: SearchParams = {}) {
  // no filters (sorting alone still counts as the plain wallet): mirrored offline, per order
  const isDefault = !Object.entries(params).some(([k, v]) => k !== 'sort' && k !== 'dir' && v !== undefined && v !== '');
  const cacheKey = `${WALLET_CACHE}:${params.sort ?? 'createdAt'}`;
  return useInfiniteQuery({
    queryKey: ['contacts', 'wallet', params],
    initialPageParam: 1,
    queryFn: async ({ pageParam }) => {
      try {
        const page = await api.get<Page<Contact>>('/contacts', {
          sort: 'createdAt',
          dir: 'desc',
          ...params,
          page: pageParam,
          pageSize: PAGE_SIZE,
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
export function useContactImage(id: string | undefined, side: 'front' | 'back', enabled: boolean, version?: string) {
  const q = useQuery({
    queryKey: ['contacts', 'image', id, side, version],
    enabled: !!id && enabled,
    staleTime: Infinity,
    gcTime: 5 * 60_000,
    queryFn: async () => {
      const res = await api.request<Response>(`/contacts/${id}/images/${side}`, { response: true });
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
