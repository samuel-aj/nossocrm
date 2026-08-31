'use client';

/**
 * O que esta organização pode usar em Automações.
 *
 * - ROBÔS: liberados para todas as organizações (não há chave).
 * - AGENTE DE IA: só quando o SUPER ADMIN da agência liberou a organização.
 *   O admin do cliente NÃO se autolibera — por isso aqui só há leitura.
 */
import { useQuery } from '@tanstack/react-query';

export const WA_AGENTS_ACCESS_QUERY_KEY = ['waAgentsAccess'] as const;

type AccessResponse = { agentsApproved: boolean; isAdmin: boolean };

async function fetchAccess(): Promise<AccessResponse> {
  const res = await fetch('/api/wa-agents/access', { credentials: 'include' });
  const json = (await res.json().catch(() => null)) as (Partial<AccessResponse> & { error?: string }) | null;
  if (!res.ok) throw new Error(json?.error || `Falha (HTTP ${res.status})`);
  return { agentsApproved: !!json?.agentsApproved, isAdmin: !!json?.isAdmin };
}

export interface UseWaAgentsAccessResult {
  /** Agente de IA liberado para esta organização pelo super admin */
  agentsApproved: boolean;
  /** Usuário atual é admin da organização */
  isAdmin: boolean;
  isLoading: boolean;
}

/** Hook React `useWaAgentsAccess`. */
export function useWaAgentsAccess(): UseWaAgentsAccessResult {
  const query = useQuery({
    queryKey: WA_AGENTS_ACCESS_QUERY_KEY,
    queryFn: fetchAccess,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  return {
    agentsApproved: query.data?.agentsApproved ?? false,
    isAdmin: query.data?.isAdmin ?? false,
    isLoading: query.isLoading,
  };
}
