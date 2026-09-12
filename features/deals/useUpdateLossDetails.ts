import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase/client';
import { activitiesService } from '@/lib/supabase/activities';
import { getCurrentOrganizationId } from '@/lib/supabase/orgId';
import { DEALS_VIEW_KEY, queryKeys } from '@/lib/query/queryKeys';
import { lossDetailsDescription } from '@/lib/utils/lossDetails';
import type { Deal, DealView } from '@/types';

export type LossDetails = { lossCategory: 'qualified' | 'disqualified'; lossReason: string };

export function useUpdateLossDetails(deal: Deal, canEdit: boolean) {
  const { profile, organizationId } = useAuth();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (values: LossDetails) => {
      if (!canEdit) throw new Error('Sem permissão para editar este lead.');
      if (!deal.isLost || deal.isWon) throw new Error('Este negócio não está perdido. Atualize o cartão.');
      const orgId = await getCurrentOrganizationId();
      if (!orgId || orgId !== organizationId) throw new Error('Organização indisponível. Atualize a página.');
      const updates = { ...values, lossReason: values.lossReason.trim() };
      if (!updates.lossReason) throw new Error('Informe o motivo da perda.');
      // Only classification/reason change. Closure date, qualification and stage stay intact.
      let query = supabase.from('deals').update({ loss_category: updates.lossCategory, loss_reason: updates.lossReason })
        .eq('id', deal.id).eq('organization_id', orgId).eq('is_lost', true).eq('is_won', false).is('deleted_at', null);
      query = deal.lossCategory ? query.eq('loss_category', deal.lossCategory) : query.is('loss_category', null);
      query = deal.lossReason ? query.eq('loss_reason', deal.lossReason) : query.is('loss_reason', null);
      const { data, error } = await query.select('id,updated_at').single();
      if (error || !data) throw new Error('Não foi possível salvar. O lead pode ter sido alterado ou seu acesso mudou. Atualize e tente novamente.');
      const author = profile?.nickname || profile?.display_name || profile?.first_name || profile?.email?.split('@')[0] || 'Usuário';
      let historyWarning = false;
      try {
        const result = await activitiesService.create({ dealId: deal.id, dealTitle: deal.title, type: 'STATUS_CHANGE',
          title: `${author} corrigiu os dados da perda`,
          description: `Antes:\n${lossDetailsDescription(deal.lossCategory, deal.lossReason)}\n\nDepois:\n${lossDetailsDescription(updates.lossCategory, updates.lossReason)}`,
          date: new Date().toISOString(), completed: true, user: { name: author, avatar: profile?.avatar_url || '' } });
        historyWarning = !!result.error || !result.data;
      } catch { historyWarning = true; }
      return { updates: { ...updates, updatedAt: data.updated_at }, historyWarning };
    },
    onSuccess: ({ updates }) => {
      client.setQueryData<DealView[]>(DEALS_VIEW_KEY, old => old?.map(item => item.id === deal.id ? { ...item, ...updates } : item));
      client.setQueryData<Deal>(queryKeys.deals.detail(deal.id), old => old ? { ...old, ...updates } : old);
      void client.invalidateQueries({ queryKey: ['performance-report', organizationId] });
      void client.invalidateQueries({ queryKey: queryKeys.activities.all });
    },
  });
}
