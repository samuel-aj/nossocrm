/**
 * TanStack Query hooks da caixa de ajustes.
 *
 * - "Meus pedidos" via GET /api/feedback; todos os pedidos (só super_admin) via ?scope=all.
 * - Detalhe com anexos e mensagens via GET /api/feedback/[id].
 * - Criar pedido e responder quando o pedido precisa de detalhes.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../index';
import { useAuth } from '@/context/AuthContext';
import type { CreateFeedbackInput } from '@/lib/feedback/schemas';
import type { AttachmentKind, FeedbackKind, FeedbackStatus } from '@/lib/feedback/constants';

export interface FeedbackRow {
  id: string; organization_id: string; author_id: string | null; kind: FeedbackKind | null;
  body: string; transcript: string | null; status: FeedbackStatus; priority_label: string | null;
  public_reply: string | null; tutorial_url: string | null; origin: 'caixa' | 'mural';
  created_at: string; updated_at: string; organization_name?: string | null; author_name?: string;
}
export interface FeedbackDetail extends FeedbackRow {
  screen_path: string | null; device: string | null;
  attachments: Array<{ id: string; kind: AttachmentKind; mime: string; size_bytes: number; url: string | null }>;
  messages: Array<{ id: string; author_kind: 'user' | 'agent'; body: string; created_at: string }>;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error || 'Erro inesperado');
  return body as T;
}

export const useMyFeedback = () => {
  const { user, loading } = useAuth();
  return useQuery({
    queryKey: queryKeys.feedback.list({ scope: 'mine' }),
    queryFn: async () => (await fetchJson<{ data: FeedbackRow[] }>('/api/feedback')).data,
    enabled: !loading && !!user, staleTime: 30_000,
  });
};

export const useAllFeedback = (filters: { status?: string; organizationId?: string }) => {
  const { user, profile, loading } = useAuth();
  const qs = new URLSearchParams({ scope: 'all', ...(filters.status ? { status: filters.status } : {}),
    ...(filters.organizationId ? { organizationId: filters.organizationId } : {}) });
  return useQuery({
    queryKey: queryKeys.feedback.list({ scope: 'all', ...filters }),
    queryFn: async () => (await fetchJson<{ data: FeedbackRow[] }>(`/api/feedback?${qs}`)).data,
    enabled: !loading && !!user && profile?.role === 'super_admin', staleTime: 30_000,
  });
};

export const useFeedbackDetail = (id: string | null) => useQuery({
  queryKey: queryKeys.feedback.detail(id ?? ''),
  queryFn: async () => (await fetchJson<{ data: FeedbackDetail }>(`/api/feedback/${id}`)).data,
  enabled: !!id,
});

export const useCreateFeedback = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateFeedbackInput) => fetchJson<{ data: { id: string } }>('/api/feedback', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.feedback.all }),
  });
};

export const useReplyFeedback = (id: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => fetchJson(`/api/feedback/${id}/messages`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body }),
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.feedback.all }),
  });
};
