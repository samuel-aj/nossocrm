'use client';

/**
 * Chave beta "Agentes de IA e Robôs" da organização.
 * GET /api/wa-agents/beta devolve { enabled, isAdmin }; POST (admin) liga/desliga.
 */
import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

export const WA_AGENTS_BETA_QUERY_KEY = ['waAgentsBeta'] as const;

type BetaResponse = { enabled: boolean; isAdmin: boolean };

async function fetchBeta(): Promise<BetaResponse> {
  const res = await fetch('/api/wa-agents/beta', { credentials: 'include' });
  const json = (await res.json().catch(() => null)) as Partial<BetaResponse> & { error?: string } | null;
  if (!res.ok) throw new Error(json?.error || `Falha (HTTP ${res.status})`);
  return { enabled: !!json?.enabled, isAdmin: !!json?.isAdmin };
}

async function postBeta(enabled: boolean): Promise<boolean> {
  const res = await fetch('/api/wa-agents/beta', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
  const json = (await res.json().catch(() => null)) as { enabled?: boolean; error?: string } | null;
  if (!res.ok) throw new Error(json?.error || `Falha (HTTP ${res.status})`);
  return !!json?.enabled;
}

export interface UseWaAgentsBetaResult {
  /** Beta ligada na organização */
  enabled: boolean;
  /** Usuário atual é admin (pode ligar/desligar) */
  isAdmin: boolean;
  isLoading: boolean;
  /** Liga/desliga a beta (admin). Lança erro em falha. */
  setEnabled: (value: boolean) => Promise<void>;
}

/**
 * Hook React `useWaAgentsBeta`.
 * @returns {UseWaAgentsBetaResult} Estado da beta e função para alterar.
 */
export function useWaAgentsBeta(): UseWaAgentsBetaResult {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: WA_AGENTS_BETA_QUERY_KEY,
    queryFn: fetchBeta,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const mutation = useMutation({
    mutationFn: postBeta,
    onSuccess: (enabled) => {
      qc.setQueryData<BetaResponse>(WA_AGENTS_BETA_QUERY_KEY, (prev) => ({
        enabled,
        isAdmin: prev?.isAdmin ?? true,
      }));
      void qc.invalidateQueries({ queryKey: WA_AGENTS_BETA_QUERY_KEY });
    },
  });

  const { mutateAsync } = mutation;
  const setEnabled = useCallback(
    async (value: boolean) => {
      await mutateAsync(value);
    },
    [mutateAsync]
  );

  return {
    enabled: query.data?.enabled ?? false,
    isAdmin: query.data?.isAdmin ?? false,
    isLoading: query.isLoading,
    setEnabled,
  };
}
