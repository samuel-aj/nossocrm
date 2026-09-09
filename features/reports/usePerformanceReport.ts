import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase/client';
import { getCurrentOrganizationId } from '@/lib/supabase/orgId';
import type { Board, Deal } from '@/types';
import { activityEvents, calculatePerformance, type MovementActivity, type PeriodRange, type StageEvent } from './performanceMetrics';

import { collectPages } from './collectPages';

export function usePerformanceReport(board: Board | undefined, range: PeriodRange, ownerId: string) {
  const { user, organizationId, loading } = useAuth();
  return useQuery({
    queryKey: ['performance-report', organizationId, user?.id, board?.id, range.start.toISOString(), range.end.toISOString(), ownerId],
    enabled: !loading && !!user && !!organizationId && !!board,
    staleTime: 0,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const orgId = await getCurrentOrganizationId();
      if (!orgId || orgId !== organizationId || !board) throw new Error('Organização indisponível. Atualize a página.');
      const rows = await collectPages<Record<string, any>>((from, to) => supabase.from('deals')
        .select('id,title,board_id,stage_id,created_at,updated_at,closed_at,is_won,is_lost,value,owner_id,loss_category,loss_reason')
        .eq('organization_id', orgId).eq('board_id', board.id).is('deleted_at', null).order('id').range(from, to));
      const deals: Deal[] = rows.map(row => ({
        id: row.id, title: row.title, boardId: row.board_id, status: row.stage_id,
        createdAt: row.created_at, updatedAt: row.updated_at, closedAt: row.closed_at,
        isWon: !!row.is_won, isLost: !!row.is_lost, value: Number(row.value) || 0,
        ownerId: row.owner_id || undefined, lossCategory: row.loss_category || undefined,
        lossReason: row.loss_reason || undefined, owner: { name: 'Sem responsável', avatar: '' },
        contactId: '', items: [], tags: [], priority: 'medium', probability: 0,
      }));
      const ownerIds = [...new Set(deals.map(deal => deal.ownerId).filter((id): id is string => !!id))];
      for (let offset = 0; offset < ownerIds.length; offset += 100) {
        const { data: profiles, error } = await supabase.from('profiles').select('id,first_name,last_name,email,avatar_url')
          .in('id', ownerIds.slice(offset, offset + 100));
        if (error) throw new Error('Não foi possível carregar os responsáveis: ' + error.message);
        for (const profile of profiles || []) {
          const name = [profile.first_name, profile.last_name].filter(Boolean).join(' ') || profile.email || 'Responsável não disponível';
          for (const deal of deals) if (deal.ownerId === profile.id) deal.owner = { name, avatar: profile.avatar_url || '' };
        }
      }
      for (const deal of deals) if (deal.ownerId && deal.owner.name === 'Sem responsável') deal.owner.name = 'Responsável não disponível';
      const activities: MovementActivity[] = [];
      const events: StageEvent[] = [];
      let webhookUnavailable = false;
      // Scope each request to deals already returned under the user's RLS.
      for (let offset = 0; offset < deals.length; offset += 100) {
        const ids = deals.slice(offset, offset + 100).map(deal => deal.id);
        const history = await collectPages<Record<string, any>>((from, to) => supabase.from('deal_stage_events')
          .select('deal_id,board_id,from_stage_id,to_stage_id,occurred_at').eq('organization_id', orgId)
          .eq('board_id', board.id).in('deal_id', ids).lte('occurred_at', range.end.toISOString()).order('id').range(from, to));
        for (const row of history) events.push({ dealId: row.deal_id, boardId: row.board_id,
          fromStageId: row.from_stage_id || undefined, stageId: row.to_stage_id, date: row.occurred_at });
        const batch = await collectPages<MovementActivity>((from, to) => supabase.from('activities')
          .select('deal_id,title,date').eq('organization_id', orgId).eq('type', 'STATUS_CHANGE')
          .in('deal_id', ids).is('deleted_at', null).lte('date', range.end.toISOString()).order('id').range(from, to));
        activities.push(...batch);
        if (!webhookUnavailable) {
          try {
            const webhooks = await collectPages<Record<string, any>>((from, to) => supabase.from('webhook_events_out')
              .select('deal_id,to_stage_id,from_stage_id,created_at,payload')
              .eq('organization_id', orgId).in('event_type', ['deal.stage_changed', 'deal.created']).in('deal_id', ids)
              .lte('created_at', range.end.toISOString()).order('id').range(from, to));
            for (const row of webhooks) {
              if (row.to_stage_id) events.push({ dealId: row.deal_id, stageId: row.to_stage_id,
                fromStageId: row.from_stage_id || undefined, boardId: row.payload?.deal?.board_id,
                date: row.payload?.occurred_at || row.created_at });
            }
          } catch {
            webhookUnavailable = true;
          }
        }
      }
      events.push(...activityEvents(activities, board));
      const metrics = calculatePerformance(deals, events, board, range, ownerId);
      return { ...metrics, deals, webhookUnavailable };
    },
  });
}
