/**
 * Preferências da organização (GET/PATCH /api/settings/org).
 * Hoje: etapa "Inativos" (inactive_leads_enabled). Leitura para qualquer
 * membro; gravação só admin (o servidor valida).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';

interface OrgPreferences {
  inactive_leads_enabled: boolean;
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orgPreferences'] });
    },
  });

  return {
    inactiveLeadsEnabled: !!query.data?.inactive_leads_enabled,
    isLoading: query.isLoading,
    setInactiveLeadsEnabled,
  };
};
