/**
 * TanStack Query hooks para Sugestoes/Feedback (beta).
 *
 * - Lista via GET /api/suggestions (so super_admin; ja ordenada por status no servidor).
 * - Criar (qualquer usuario), marcar status (feito/descartado) e apagar.
 * - Espera a auth ficar pronta antes de buscar (igual aos demais hooks).
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../index';
import { useAuth } from '@/context/AuthContext';
import type { Suggestion, SuggestionStatus } from '@/features/suggestions/types';

async function fetchJson(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error || 'Erro inesperado');
  return json;
}

const STATUS_RANK: Record<SuggestionStatus, number> = { pending: 0, done: 1, discarded: 2 };

function sortByStatus(list: Suggestion[]): Suggestion[] {
  return [...list].sort(
    (a, b) =>
      (STATUS_RANK[a.status] - STATUS_RANK[b.status]) || (a.created_at < b.created_at ? 1 : -1),
  );
}

export const useSuggestions = () => {
  const { user, profile, loading: authLoading } = useAuth();
  const isSuperAdmin = profile?.role === 'super_admin';
  return useQuery({
    queryKey: queryKeys.suggestions.lists(),
    queryFn: async () => {
      const json = await fetchJson('/api/suggestions');
      return ((json as { data?: Suggestion[] }).data || []) as Suggestion[];
    },
    enabled: !authLoading && !!user && isSuperAdmin,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
  });
};

/**
 * Contagem global de sugestões (só o número) — para usuários que NÃO são
 * super_admin, como incentivo. Não busca para super_admin (que vê a lista).
 */
export const useSuggestionsCount = () => {
  const { user, profile, loading: authLoading } = useAuth();
  const isSuperAdmin = profile?.role === 'super_admin';
  return useQuery({
    queryKey: [...queryKeys.suggestions.all, 'count'] as const,
    queryFn: async () => {
      const json = await fetchJson('/api/suggestions/count');
      return (json as { count?: number }).count ?? 0;
    },
    enabled: !authLoading && !!user && !isSuperAdmin,
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

/** Marca o status da sugestão (pendente/feito/descartado) — só super_admin. */
export const useSetSuggestionStatus = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: SuggestionStatus }) => {
      await fetchJson(`/api/suggestions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      return { id, status };
    },
    onMutate: async ({ id, status }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.suggestions.all });
      const previous = queryClient.getQueryData<Suggestion[]>(queryKeys.suggestions.lists());
      queryClient.setQueryData<Suggestion[]>(queryKeys.suggestions.lists(), (old = []) =>
        sortByStatus(old.map(s => (s.id === id ? { ...s, status } : s))),
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
