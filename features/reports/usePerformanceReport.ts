import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase/client';
import { getCurrentOrganizationId } from '@/lib/supabase/orgId';
import type { Board, Deal } from '@/types';
import { calculatePerformance, type PeriodRange, type StageEvent, type PerformanceMode } from './performanceMetrics';
import { lifecycleEventFromRow, type DbLifecycleEvent } from './performanceHistory';
import { collectPages } from './collectPages';
import type { DbDealItem } from '@/lib/supabase/deals';

interface ReportDealRow {
  id: string; title: string; board_id: string; stage_id: string; created_at: string; updated_at: string;
  closed_at: string | null; qualified_at: string | null; qualification_date_source: Deal['qualificationDateSource'];
  is_won: boolean; is_lost: boolean; value: number | string; owner_id: string | null;
  loss_category: Deal['lossCategory']; loss_reason: string | null;
}
interface StageEventRow { deal_id: string; board_id: string; from_stage_id: string | null; to_stage_id: string; occurred_at: string }
const DEAL_COLUMNS = 'id,title,board_id,stage_id,created_at,updated_at,closed_at,qualified_at,qualification_date_source,is_won,is_lost,value,owner_id,loss_category,loss_reason';
const EVENT_COLUMNS = 'id,deal_id,board_id,event_type,occurred_at,source,snapshot_source,stage_id,owner_id,value,title,deal_created_at,items,loss_category,loss_reason,is_won,is_lost';

export function usePerformanceReport(board: Board | undefined, range: PeriodRange, ownerId: string, comparisonRange?: PeriodRange, productId = '', mode: PerformanceMode = 'cohort') {
  const { user, organizationId, loading } = useAuth();
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!organizationId || !board?.id) return;
    const channel = supabase.channel(`performance:${organizationId}:${board.id}`);
    for (const table of ['deals', 'deal_items', 'deal_lifecycle_events', 'deal_stage_events', 'boards', 'board_stages']) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table, filter: `organization_id=eq.${organizationId}` }, () => {
        void queryClient.invalidateQueries({ queryKey: ['performance-report', organizationId] });
      });
    }
    channel.subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [organizationId, board?.id, queryClient]);
  // Rules are input data, not just the board ID: renames, order and MQL changes invalidate derived metrics.
  const rulesKey = board ? [board.wonStageId, board.lostStageId, board.linkedLifecycleStage, board.stages.map(stage => [stage.id, stage.label, stage.color, stage.linkedLifecycleStage])] : null;
  return useQuery({
    queryKey: ['performance-report', organizationId, user?.id, board?.id, rulesKey, range.start.toISOString(), range.end.toISOString(), ownerId, comparisonRange?.start.toISOString(), comparisonRange?.end.toISOString(), mode, productId],
    enabled: !loading && !!user && !!organizationId && !!board,
    staleTime: 0,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const orgId = await getCurrentOrganizationId();
      if (!orgId || orgId !== organizationId || !board) throw new Error('Organização indisponível. Atualize a página.');
      // These SELECTs use the signed-in client and RLS. History is scoped by its own board,
      // independently of the deal's current board, so transfers do not erase past results.
      const [currentRows, lifecycleRows, stageRows] = await Promise.all([
        collectPages<ReportDealRow>((from, to) => supabase.from('deals').select(DEAL_COLUMNS)
          .eq('organization_id', orgId).eq('board_id', board.id).is('deleted_at', null).order('id').range(from, to)),
        collectPages<DbLifecycleEvent>((from, to) => supabase.from('deal_lifecycle_events').select(EVENT_COLUMNS)
          .eq('organization_id', orgId).eq('board_id', board.id).order('id').range(from, to)),
        collectPages<StageEventRow>((from, to) => supabase.from('deal_stage_events')
          .select('deal_id,board_id,from_stage_id,to_stage_id,occurred_at').eq('organization_id', orgId)
          .eq('board_id', board.id).order('id').range(from, to)),
      ]);
      const rowsById = new Map(currentRows.map(row => [row.id, row]));
      const referencedIds = [...new Set([...lifecycleRows, ...stageRows].map(event => event.deal_id))].filter(id => !rowsById.has(id));
      for (let offset = 0; offset < referencedIds.length; offset += 100) {
        const rows = await collectPages<ReportDealRow>((from, to) => supabase.from('deals').select(DEAL_COLUMNS)
          .eq('organization_id', orgId).in('id', referencedIds.slice(offset, offset + 100)).is('deleted_at', null).order('id').range(from, to));
        for (const row of rows) rowsById.set(row.id, row);
      }
      const deals: Deal[] = [...rowsById.values()].map(row => ({
        id: row.id, title: row.title, boardId: row.board_id, status: row.stage_id,
        qualifiedAt: row.qualified_at || undefined, qualificationDateSource: row.qualification_date_source,
        createdAt: row.created_at, updatedAt: row.updated_at, closedAt: row.closed_at || undefined,
        isWon: !!row.is_won, isLost: !!row.is_lost, value: Number(row.value) || 0,
        ownerId: row.owner_id || undefined, lossCategory: row.loss_category || undefined,
        lossReason: row.loss_reason || undefined, owner: { name: row.owner_id ? 'Responsável não disponível' : 'Sem responsável', avatar: '' },
        contactId: '', items: [], tags: [], priority: 'medium', probability: 0,
      }));
      const dealsById = new Map(deals.map(deal => [deal.id, deal]));
      const lifecycleEvents = lifecycleRows.filter(row => dealsById.has(row.deal_id)).map(lifecycleEventFromRow);
      const events: StageEvent[] = stageRows.filter(row => dealsById.has(row.deal_id)).map(row => ({
        dealId: row.deal_id, boardId: row.board_id, fromStageId: row.from_stage_id || undefined, stageId: row.to_stage_id, date: row.occurred_at,
      }));
      for (let offset = 0; offset < deals.length; offset += 100) {
        const ids = deals.slice(offset, offset + 100).map(deal => deal.id);
        const items = await collectPages<Pick<DbDealItem, 'id' | 'deal_id' | 'product_id' | 'name' | 'quantity' | 'price'>>((from, to) => supabase.from('deal_items')
          .select('id,deal_id,product_id,name,quantity,price').eq('organization_id', orgId)
          .in('deal_id', ids).order('id').range(from, to));
        for (const item of items) dealsById.get(item.deal_id)?.items.push({ id: item.id, productId: item.product_id || '', name: item.name,
          quantity: item.quantity, price: Number(item.price) || 0 });
      }
      const owners = new Map<string, Deal['owner']>();
      const ownerIds = [...new Set([...deals, ...lifecycleEvents].map(item => item.ownerId).filter((id): id is string => !!id))];
      for (let offset = 0; offset < ownerIds.length; offset += 100) {
        const { data: profiles, error } = await supabase.from('profiles').select('id,first_name,last_name,email,avatar_url')
          .in('id', ownerIds.slice(offset, offset + 100));
        if (error) throw new Error('Não foi possível carregar os responsáveis: ' + error.message);
        for (const profile of profiles || []) owners.set(profile.id, {
          name: [profile.first_name, profile.last_name].filter(Boolean).join(' ') || profile.email || 'Responsável não disponível', avatar: profile.avatar_url || '',
        });
      }
      for (const item of [...deals, ...lifecycleEvents]) if (item.ownerId) item.owner = owners.get(item.ownerId) || { name: 'Responsável não disponível', avatar: '' };
      const productOptions = new Map<string, string>();
      for (const item of [...deals.flatMap(deal => deal.items), ...lifecycleEvents.flatMap(event => event.items)]) if (item.productId) productOptions.set(item.productId, item.name);
      const metrics = calculatePerformance(deals, events, board, range, ownerId, comparisonRange, new Date(), { mode, lifecycleEvents, productId });
      return { ...metrics, deals, webhookUnavailable: false,
        ownerOptions: ownerIds.map(id => ({ id, name: owners.get(id)?.name || 'Responsável não disponível' })),
        productOptions: [...productOptions].map(([id, name]) => ({ id, name })) };
    },
  });
}
