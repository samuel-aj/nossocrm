'use client';

import { useQuery } from '@tanstack/react-query';

export type ActorKind = 'user' | 'bot' | 'agent' | 'integration' | 'system';

export type DealEvent = {
  id: string;
  kind: string;
  field: string | null;
  old_value: unknown;
  new_value: unknown;
  detail: Record<string, unknown> | null;
  actor_kind: ActorKind;
  actor_id: string | null;
  actor_name: string | null;
  created_at: string;
};

export type ActivityMeta = {
  createdAt: string | null;
  authorName: string | null;
  authorKind: string | null;
  editedAt: string | null;
  editedByName: string | null;
};

export type ApiNote = { id: string; content: string; createdAt: string; updatedAt: string | null; authorName: string | null };

export type DealHistory = {
  available: boolean;
  since: string | null;
  events: DealEvent[];
  activityMeta: Record<string, ActivityMeta>;
  apiNotes: ApiNote[];
};

export const dealHistoryKey = (dealId: string) => ['dealHistory', dealId] as const;

/** Histórico do lead (alterações com autor, autor das notas/atividades, notas da API). */
export function useDealHistory(dealId: string | null | undefined, enabled = true) {
  return useQuery<DealHistory>({
    queryKey: dealHistoryKey(dealId ?? ''),
    enabled: !!dealId && enabled,
    queryFn: async () => {
      const res = await fetch(`/api/deals/${dealId}/history`, { credentials: 'include', headers: { accept: 'application/json' } });
      const j = (await res.json().catch(() => null)) as (DealHistory & { error?: string }) | null;
      if (!res.ok || !j) throw new Error(j?.error || 'Falha ao carregar o histórico');
      return j;
    },
    // alterações feitas por robô/agente/outra pessoa aparecem sem recarregar
    refetchInterval: 10_000,
    staleTime: 3_000,
  });
}

export type DealFollowup = {
  rule: { enabled: boolean; delay_seconds: number; action_type: 'bot' | 'message' };
  schedule: {
    status: 'scheduled' | 'processing' | 'done' | 'failed' | 'skipped' | 'cancelled';
    due_at: string;
    fired_at: string | null;
    last_result: Record<string, unknown> | null;
    anchor_at: string;
  } | null;
} | null;

/** Estado do follow-up por inatividade da etapa atual do lead. */
export function useDealFollowup(dealId: string | null | undefined, stageId: string | undefined) {
  return useQuery<DealFollowup>({
    queryKey: ['dealFollowup', dealId ?? '', stageId ?? ''],
    enabled: !!dealId,
    queryFn: async () => {
      const res = await fetch(`/api/wa-agents/deal-followup/${dealId}`, { credentials: 'include' });
      if (!res.ok) return null;
      const j = (await res.json().catch(() => null)) as { followup?: DealFollowup } | null;
      return j?.followup ?? null;
    },
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
}
