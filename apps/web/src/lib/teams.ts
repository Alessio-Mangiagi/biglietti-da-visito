import type { Contact, InvitePreview, Page, SharedContact, TeamDetail, TeamInvite, TeamSummary } from '@cardvault/shared';
import { keepPreviousData, useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import type { Duplicate } from './save';

export function useTeams(enabled = true) {
  return useQuery({
    queryKey: ['teams'],
    enabled,
    queryFn: () => api.get<TeamSummary[]>('/teams'),
    staleTime: 60_000,
  });
}

export function useTeam(teamId: string | undefined) {
  return useQuery({
    queryKey: ['teams', teamId],
    enabled: !!teamId,
    queryFn: () => api.get<TeamDetail>(`/teams/${teamId}`),
  });
}

export function useTeamContacts(teamId: string | undefined, q: string) {
  return useInfiniteQuery({
    queryKey: ['teams', teamId, 'contacts', q],
    enabled: !!teamId,
    initialPageParam: 1,
    placeholderData: keepPreviousData,
    queryFn: ({ pageParam }) => api.get<Page<SharedContact>>(`/teams/${teamId}/contacts`, { q: q || undefined, page: pageParam, pageSize: 50 }),
    getNextPageParam: (last) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
  });
}

export function useSharedContact(teamId: string | undefined, id: string | undefined) {
  return useQuery({
    queryKey: ['teams', teamId, 'contact', id],
    enabled: !!teamId && !!id,
    queryFn: () => api.get<SharedContact>(`/teams/${teamId}/contacts/${id}`),
  });
}

/** Teams this contact of mine is shared with. */
export function useContactTeams(contactId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['teams', 'of', contactId],
    enabled: !!contactId && enabled,
    queryFn: () => api.get<string[]>(`/contacts/${contactId}/teams`),
  });
}

export function useTeamActions() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ['teams'] });
  return {
    create: async (name: string) => {
      const t = await api.post<TeamDetail>('/teams', { name });
      await refresh();
      return t;
    },
    rename: async (teamId: string, name: string) => {
      await api.patch<TeamDetail>(`/teams/${teamId}`, { name });
      await refresh();
    },
    remove: async (teamId: string) => {
      await api.delete(`/teams/${teamId}`);
      qc.removeQueries({ queryKey: ['teams', teamId] });
      await refresh();
    },
    invite: (teamId: string) => api.post<TeamInvite>(`/teams/${teamId}/invites`),
    revokeInvites: (teamId: string) => api.delete(`/teams/${teamId}/invites`),
    preview: (token: string) => api.post<InvitePreview>('/teams/join/preview', { token }),
    join: async (token: string) => {
      const t = await api.post<TeamDetail>('/teams/join', { token });
      await refresh();
      return t;
    },
    removeMember: async (teamId: string, userId: string) => {
      await api.delete(`/teams/${teamId}/members/${userId}`);
      await refresh();
    },
    setRole: async (teamId: string, userId: string, role: 'admin' | 'member') => {
      await api.patch(`/teams/${teamId}/members/${userId}`, { role });
      await refresh();
    },
    share: async (teamId: string, contactId: string) => {
      await api.post(`/teams/${teamId}/contacts`, { contactId });
      await refresh();
    },
    unshare: async (teamId: string, contactId: string) => {
      await api.delete(`/teams/${teamId}/contacts/${contactId}`);
      await refresh();
    },
    copy: async (teamId: string, contactId: string) => {
      const out = await api.post<{ contact: Contact; duplicates: Duplicate[] }>(`/teams/${teamId}/contacts/${contactId}/copy`);
      await qc.invalidateQueries({ queryKey: ['contacts'] });
      return out;
    },
  };
}
