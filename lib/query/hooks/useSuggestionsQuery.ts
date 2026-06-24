/**
 * TanStack Query hooks para Sugestoes/Feedback (beta).
 *
 * - Lista via GET /api/suggestions (ja ordenada por votos no servidor).
 * - Criar / votar / desvotar / apagar com optimistic update.
 * - Espera a auth ficar pronta antes de buscar (igual aos demais hooks).
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../index';
import { useAuth } from '@/context/AuthContext';
import type { Suggestion } from '@/features/suggestions/types';

async function fetchJson(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error || 'Erro inesperado');
  return json;
}

function sortByVotes(list: Suggestion[]): Suggestion[] {
  return [...list].sort(
    (a, b) => b.votes_count - a.votes_count || (a.created_at < b.created_at ? 1 : -1),
  );
}

export const useSuggestions = () => {
  const { user, profile, loading: authLoading } = useAuth();
  const isAdmin = profile?.role === 'admin' || profile?.role === 'super_admin';
  return useQuery({
    queryKey: queryKeys.suggestions.lists(),
    queryFn: async () => {
      const json = await fetchJson('/api/suggestions');
      return ((json as { data?: Suggestion[] }).data || []) as Suggestion[];
    },
    enabled: !authLoading && !!user && isAdmin,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
  });
};

export const useCreateSuggestion = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (content: string) => {
      const json = await fetchJson('/api/suggestions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      return (json as { data: Suggestion }).data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.suggestions.all });
    },
  });
};

/** Alterna o voto: se `voted` for true, desvota (DELETE); senao vota (POST). */
export const useVoteSuggestion = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, voted }: { id: string; voted: boolean }) => {
      await fetchJson(`/api/suggestions/${id}/vote`, {
        method: voted ? 'DELETE' : 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      return { id, voted };
    },
    onMutate: async ({ id, voted }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.suggestions.all });
      const previous = queryClient.getQueryData<Suggestion[]>(queryKeys.suggestions.lists());
      queryClient.setQueryData<Suggestion[]>(queryKeys.suggestions.lists(), (old = []) =>
        sortByVotes(
          old.map(s =>
            s.id === id
              ? { ...s, voted_by_me: !voted, votes_count: s.votes_count + (voted ? -1 : 1) }
              : s,
          ),
        ),
      );
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.suggestions.lists(), context.previous);
      }
    },
  });
};

export const useDeleteSuggestion = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await fetchJson(`/api/suggestions/${id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
      });
      return id;
    },
    onMutate: async (id: string) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.suggestions.all });
      const previous = queryClient.getQueryData<Suggestion[]>(queryKeys.suggestions.lists());
      queryClient.setQueryData<Suggestion[]>(queryKeys.suggestions.lists(), (old = []) =>
        old.filter(s => s.id !== id),
      );
      return { previous };
    },
    onError: (_error, _id, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.suggestions.lists(), context.previous);
      }
    },
  });
};
