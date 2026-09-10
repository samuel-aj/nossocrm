import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/context/ToastContext';
import { BoardFilterDefaults, EMPTY_GENERAL, EMPTY_PERIOD, GeneralSettings, PeriodSettings, generalSchema, periodSchema } from './boardFilters';

export function useBoardFilters(userId: string | undefined, orgId: string | null | undefined, boardId: string | null, legacyStatus: GeneralSettings['status'], urlStatus?: GeneralSettings['status']) {
  const scope = `${userId}:${orgId}:${boardId}`;
  const key = ['boardFilterDefaults', userId, orgId, boardId];
  const qc = useQueryClient();
  const { addToast } = useToast();
  const [draft, setDraft] = useState<{ scope: string; general?: GeneralSettings; period?: PeriodSettings }>({ scope });
  // A different user/org/funnel starts from its own defaults, even when revisiting.
  if (draft.scope !== scope) setDraft({ scope });
  const query = useQuery<BoardFilterDefaults>({
    queryKey: key,
    enabled: !!userId && !!orgId && !!boardId && !boardId.startsWith('temp-'),
    queryFn: async () => {
      const res = await fetch(`/api/boards/${boardId}/filters`, { headers: { 'x-org-id': orgId! } });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      return { general: generalSchema.safeParse(data.general).data ?? null, period: periodSchema.safeParse(data.period).data ?? null };
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const saved = query.data;
  const baseGeneral = saved?.general ?? { ...EMPTY_GENERAL, status: legacyStatus };
  const general = (draft.scope === scope && draft.general) || (urlStatus ? { ...baseGeneral, status: urlStatus } : baseGeneral);
  const period = (draft.scope === scope && draft.period) || saved?.period || EMPTY_PERIOD;
  const setGeneral = (patch: Partial<GeneralSettings>) => setDraft(current => ({
    ...(current.scope === scope ? current : { scope }),
    general: { ...((current.scope === scope && current.general) || general), ...patch },
  }));
  const setPeriod = (value: PeriodSettings) => setDraft(current => ({ ...(current.scope === scope ? current : { scope }), period: value }));
  const save = useMutation({
    mutationFn: async (patch: Partial<BoardFilterDefaults>) => {
      const res = await fetch(`/api/boards/${boardId}/filters`, {
        method: 'PATCH', headers: { 'content-type': 'application/json', 'x-org-id': orgId! }, body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      return { data: { general: generalSchema.safeParse(data.general).data ?? null, period: periodSchema.safeParse(data.period).data ?? null }, key };
    },
    onSuccess: ({ data, key: savedKey }) => { qc.setQueryData(savedKey, data); addToast('Seu padrão deste funil foi atualizado.', 'success'); },
    onError: (error: Error) => addToast(error.message || 'Não foi possível salvar seus filtros.', 'error'),
  });
  return { general, period, setGeneral, setPeriod, saved, pin: save.mutate, saving: save.isPending, ready: !!saved, loading: query.isLoading, loadError: query.isError };
}
export type BoardFilterControls = ReturnType<typeof useBoardFilters>;
