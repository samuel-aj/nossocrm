/**
 * Preferências da organização (GET/PATCH /api/settings/org).
 * Hoje: etapa "Inativos" (inactive_leads_enabled) e motivos de perda
 * personalizados e categorias de origem (null = padrão do sistema). Leitura para
 * qualquer membro; gravação só admin (o servidor valida).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { DEFAULT_LEAD_SOURCES } from '@/lib/deals/leadSource';

/** Filtro de status com que o quadro abre. */
export type DealStatusFilter = 'open' | 'won' | 'lost' | 'all';

interface OrgPreferences {
  inactive_leads_enabled: boolean;
  loss_reasons_qualified: string[] | null;
  loss_reasons_disqualified: string[] | null;
  /** null = "open" (padrão do sistema) */
  default_deal_status_filter: DealStatusFilter | null;
  lead_source_options: string[] | null;
}

/**
 * Payload do salvamento dos motivos de perda.
 * undefined = não mexer nessa lista; null/lista vazia = voltar ao padrão.
 */
export interface LossReasonsUpdate {
  qualified?: string[] | null;
  disqualified?: string[] | null;
}

export const useOrgPreferences = () => {
  const { user } = useAuth();
  const qc = useQueryClient();

  const query = useQuery<OrgPreferences>({
    queryKey: ['orgPreferences'],
    queryFn: async () => {
      const res = await fetch('/api/settings/org', {
        credentials: 'include',
        headers: { accept: 'application/json' },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((json as { error?: string }).error || 'Falha ao carregar preferências');
      return json as OrgPreferences;
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const setInactiveLeadsEnabled = useMutation({
    mutationFn: async (enabled: boolean) => {
      const res = await fetch('/api/settings/org', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ inactive_leads_enabled: enabled }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((json as { error?: string }).error || 'Falha ao salvar preferência');
    },
    // Retornar a promise faz o React Query esperar o refetch terminar antes
    // dos callbacks do componente (evita sincronizar com cache velho).
    onSuccess: () => qc.invalidateQueries({ queryKey: ['orgPreferences'] }),
  });

  const setDefaultDealStatusFilter = useMutation({
    mutationFn: async (value: DealStatusFilter) => {
      const res = await fetch('/api/settings/org', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ default_deal_status_filter: value }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((json as { error?: string }).error || 'Falha ao salvar preferência');
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['orgPreferences'] }),
  });

  const setLossReasons = useMutation({
    mutationFn: async (update: LossReasonsUpdate) => {
      const body: Record<string, unknown> = {};
      if (update.qualified !== undefined) body.loss_reasons_qualified = update.qualified;
      if (update.disqualified !== undefined) body.loss_reasons_disqualified = update.disqualified;
      const res = await fetch('/api/settings/org', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((json as { error?: string }).error || 'Falha ao salvar motivos');
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['orgPreferences'] }),
  });

  const setLeadSourceOptions = useMutation({
    mutationFn: async (options: string[] | null) => {
      const res = await fetch('/api/settings/org', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ lead_source_options: options }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((json as { error?: string }).error || 'Falha ao salvar origens');
      return json as { lead_source_options: string[] | null };
    },
    onSuccess: (saved) => {
      qc.setQueryData<OrgPreferences>(['orgPreferences'], old => old ? { ...old, lead_source_options: saved.lead_source_options } : old);
      return qc.invalidateQueries({ queryKey: ['orgPreferences'] });
    },
  });

  return {
    inactiveLeadsEnabled: !!query.data?.inactive_leads_enabled,
    /** null = organização usa os motivos padrão do sistema. */
    lossReasonsQualified: query.data?.loss_reasons_qualified ?? null,
    lossReasonsDisqualified: query.data?.loss_reasons_disqualified ?? null,
    /** Filtro com que o quadro abre; undefined enquanto carrega (não força nada) */
    defaultDealStatusFilter: query.data ? (query.data.default_deal_status_filter ?? 'open') : undefined,
    leadSourceOptions: query.data?.lead_source_options ?? DEFAULT_LEAD_SOURCES,
    isLoading: query.isLoading,
    isError: query.isError,
    setInactiveLeadsEnabled,
    setDefaultDealStatusFilter,
    setLossReasons,
    setLeadSourceOptions,
  };
};
