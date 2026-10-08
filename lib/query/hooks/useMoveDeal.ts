import { getDealLeadSource } from '@/lib/deals/leadSource';
/**
 * Unified hook for moving deals between stages
 * 
 * This is the SINGLE SOURCE OF TRUTH for deal movement logic.
 * Use this hook everywhere instead of calling updateDeal/updateDealStatus directly.
 * 
 * Features:
 * - Detects won/lost stages via linkedLifecycleStage
 * - Creates activity history entries
 * - Updates contact lifecycle stage (LinkedStage automation)
 * - Creates deal in next board (NextBoard automation)
 * - Optimistic updates for instant UI feedback
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys, DEALS_VIEW_KEY } from '../queryKeys';
import { dealsService } from '@/lib/supabase';
import { boardsService } from '@/lib/supabase/boards'; // Added
import { activitiesService } from '@/lib/supabase/activities';
import { contactsService } from '@/lib/supabase/contacts';
import type { Deal, DealView, Board, Activity } from '@/types';
import { useAuth } from '@/context/AuthContext';
import { lossDetailsDescription } from '@/lib/utils/lossDetails';
import { resolveBoardMoveOutcome } from '@/lib/boards/boardOutcome';

interface MoveDealParams {
  dealId: string;
  targetStageId: string;
  lossReason?: string;
  /** Lead era qualificado ou desqualificado quando foi perdido (relatórios) */
  lossCategory?: 'qualified' | 'disqualified';
  // Context needed for automations
  deal: Deal | DealView;
  board: Board;
  lifecycleStages?: { id: string; name: string }[];
  explicitWin?: boolean;
  explicitLost?: boolean;
  explicitReopen?: boolean;
}

interface MoveDealResult {
  dealId: string;
  newStatus: string;
  isWon?: boolean;
  isLost?: boolean;
  confirmed?: Partial<Deal>;
}

// Context type for optimistic updates
interface MoveDealContext {
  previousDeals: DealView[] | undefined;
  previousDetail: Deal | undefined;
}

/**
 * Hook React `useMoveDeal` que encapsula uma lógica reutilizável.
 * @returns {UseMutationResult<MoveDealResult, Error, MoveDealParams, MoveDealContext>} Retorna um valor do tipo `UseMutationResult<MoveDealResult, Error, MoveDealParams, MoveDealContext>`.
 */
export const useMoveDeal = () => {
  const queryClient = useQueryClient();
  // Autor do movimento: vai na atividade ("Fulano moveu para X"). 'Sistema'
  // fica reservado para automações (LinkedStage, NextBoard).
  const { profile } = useAuth();
  const autor = {
    name:
      profile?.nickname ||
      profile?.display_name ||
      profile?.name ||
      profile?.first_name ||
      (profile?.email || '').split('@')[0] ||
      'Sistema',
    avatar: profile?.avatar_url || '',
  };

  return useMutation<MoveDealResult, Error, MoveDealParams, MoveDealContext>({
    mutationFn: async ({ dealId, targetStageId, lossReason, lossCategory, deal, board, lifecycleStages, explicitWin, explicitLost, explicitReopen }) => {
      const targetStage = board.stages.find(s => s.id === targetStageId);
      if (!targetStage) throw new Error('Etapa indisponível neste funil. Atualize a página.');
      const outcome = resolveBoardMoveOutcome({ board, deal, targetStageId, explicitWin, explicitLost, explicitReopen });
      const { isWon, isLost } = outcome;

      // Build updates object
      const changingBoard = board.id !== deal.boardId;
      const changingStage = changingBoard || targetStageId !== deal.status;
      const updates: Partial<Deal> = {
        ...(changingBoard && { boardId: board.id }),
        status: targetStageId,
        ...(changingStage && { lastStageChangeDate: new Date().toISOString() }),
        ...(lossReason && { lossReason }),
        ...(lossCategory && { lossCategory }),
        // A legacy Customer-stage correction is normalized by the DB from its
        // evidence. Sending a fresh explicit win could invent a new win date.
        ...(!outcome.recoveringLegacyWin && { isWon, isLost }),
      };

      // 1. Update the deal
      const { data: confirmed, error: dealError } = await dealsService.update(dealId, updates);
      if (dealError) {
        throw dealError;
      }

      // 2. Create activity "Moveu para X" (fire and forget - don't block UI)
      const stageLabel = targetStage?.label || targetStageId;
      activitiesService.create({
        dealId,
        dealTitle: deal.title,
        type: 'STATUS_CHANGE',
        title: changingBoard ? `Moveu para ${board.name}, etapa ${stageLabel}` : `Moveu para ${stageLabel}`,
        description: isLost ? lossDetailsDescription(lossCategory, lossReason) : undefined,
        date: new Date().toISOString(),
        completed: true,
        user: autor,
      } as Omit<Activity, 'id' | 'createdAt'>).catch(console.error);

      // 3. LinkedStage: Update contact stage when moving to linked column
      if (targetStage.linkedLifecycleStage && deal.contactId && changingStage && !explicitReopen) {
        const lifecycleStageName =
          lifecycleStages?.find(ls => ls.id === targetStage.linkedLifecycleStage)?.name ||
          targetStage.linkedLifecycleStage;

        contactsService.update(deal.contactId, {
          stage: targetStage.linkedLifecycleStage
        }).catch(console.error);

        activitiesService.create({
          dealId,
          dealTitle: deal.title,
          type: 'STATUS_CHANGE',
          title: `Contato promovido para ${lifecycleStageName}`,
          description: `Automático via LinkedStage da etapa "${targetStage.label}"`,
          date: new Date().toISOString(),
          completed: true,
          user: { name: 'Sistema', avatar: '' },
        } as Omit<Activity, 'id' | 'createdAt'>).catch(console.error);
      }

      // 4. NextBoard Automation (async, don't block)
      // A false flag on a Customer column can also be an explicit reopening.
      // Only the transactional response can distinguish a fresh gain there
      // from restoration of an old, possibly undated, legacy gain.
      const confirmedNewPromotion = !deal.isWon && confirmed?.isWon
        && !!confirmed.closedAt && confirmed.closedAt === confirmed.lastStageChangeDate
        && confirmed.closedAt !== deal.closedAt;
      const isSuccessStage =
        ((outcome.newPromotion || confirmedNewPromotion) && (confirmed?.isWon ?? isWon)) ||
        (changingStage && !isLost && ['MQL', 'SALES_QUALIFIED'].includes(targetStage.linkedLifecycleStage || ''));

      if (isSuccessStage && board.nextBoardId) {
        (async () => {
          try {
            const targetBoard = await boardsService.get(board.nextBoardId!);
            if (targetBoard && targetBoard.stages.length > 0) {
              const entryStageId = targetBoard.stages[0].id;

              const { error: copyError } = await dealsService.create({
                title: deal.title,
                leadSource: getDealLeadSource(deal),
                value: deal.value,
                contactId: deal.contactId,
                boardId: targetBoard.id,
                // Status/stage devem refletir o board de destino (não o stage do board anterior)
                status: entryStageId,
                priority: deal.priority,
                // Compat: DealView/Deal ainda pode ter companyId legado
                clientCompanyId: deal.clientCompanyId ?? deal.companyId,
                ownerId: deal.ownerId,
                owner: deal.owner || { name: 'Unknown', avatar: '' },
                items: deal.items || [],
                tags: deal.tags || [],
                // Rastreabilidade (ajuda também a prevenir duplicidade no futuro)
                customFields: {
                  originDealId: deal.id,
                  originBoardId: board.id,
                  originAutomation: 'NEXT_BOARD',
                },
                updatedAt: new Date().toISOString(),
                isWon: false,
                isLost: false,
                probability: 0,
              });

              if (!copyError) {
                await activitiesService.create({
                  dealId,
                  dealTitle: deal.title,
                  type: 'STATUS_CHANGE',
                  title: `Enviado para ${targetBoard.name}`,
                  description: `Automação: Ao ganhar neste board, criou carta em "${targetBoard.name}"`,
                  date: new Date().toISOString(),
                  completed: true,
                  user: { name: 'Sistema', avatar: '' },
                } as Omit<Activity, 'id' | 'createdAt'>);
              }
            }
          } catch (err) {
            console.error('[Automation] Failed to move to next board:', err);
          }
        })();
      }

      return { dealId, newStatus: targetStageId, isWon: confirmed?.isWon ?? isWon, isLost: confirmed?.isLost ?? isLost, confirmed };
    },

    // Optimistic update: update UI instantly before server responds
    onMutate: async ({ dealId, targetStageId, deal, explicitWin, explicitLost, explicitReopen, board, lossCategory, lossReason }) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: queryKeys.deals.all });

      // Snapshot previous state
      const previousDeals = queryClient.getQueryData<DealView[]>(DEALS_VIEW_KEY);
      const previousDetail = queryClient.getQueryData<Deal>(queryKeys.deals.detail(dealId));

      // Determine new status
      const { isWon, isLost, closedAt } = resolveBoardMoveOutcome({ board, deal, targetStageId, explicitWin, explicitLost, explicitReopen });
      const boardUpdate = board.id !== deal.boardId ? { boardId: board.id } : {};
      const stageDateUpdate = board.id !== deal.boardId || targetStageId !== deal.status
        ? { lastStageChangeDate: new Date().toISOString() }
        : {};

      const lossUpdates = isLost ? {
        ...(lossCategory && { lossCategory }), ...(lossReason && { lossReason }),
        closedAt,
      } : { lossCategory: undefined, lossReason: undefined, closedAt };

      // Optimistically update APENAS DEALS_VIEW_KEY (única fonte de verdade)
      queryClient.setQueryData<DealView[]>(DEALS_VIEW_KEY, (old) => {
        if (!old) return old;

        return old.map(d => {
          if (d.id === dealId) {
            const newDeal = {
              ...d,
              ...boardUpdate,
              status: targetStageId,
              ...stageDateUpdate,
              isWon: isWon ?? d.isWon,
              isLost: isLost ?? d.isLost,
              ...lossUpdates,
              updatedAt: new Date().toISOString(),
            };
            return newDeal;
          }
          return d;
        });
      });

      // Também atualizar o detail cache se existir
      queryClient.setQueryData<Deal>(queryKeys.deals.detail(dealId), (old) => {
        if (!old) return old;
        return {
          ...old,
          ...boardUpdate,
          status: targetStageId,
          ...stageDateUpdate,
          isWon: isWon ?? old.isWon,
          isLost: isLost ?? old.isLost,
          ...lossUpdates,
          updatedAt: new Date().toISOString(),
        };
      });

      return { previousDeals, previousDetail };
    },

    onSuccess: (result, variables) => {
      if (!result.confirmed) return;
      // Dates and final outcome come from the transactional database result.
      // Don't overwrite a subsequent move or unrelated fields edited meanwhile.
      const fields = ['isWon', 'isLost', 'closedAt', 'qualifiedAt', 'qualificationDateSource', 'lastStageChangeDate'] as const;
      const confirmed = Object.fromEntries(fields.filter(key => key in result.confirmed!).map(key => [key, result.confirmed![key]]));
      const apply = <T extends Deal>(old: T): T => old.boardId === variables.board.id && old.status === variables.targetStageId
        ? { ...old, ...confirmed } : old;
      queryClient.setQueryData<DealView[]>(DEALS_VIEW_KEY, old => old?.map(row => row.id === result.dealId ? apply(row) : row));
      queryClient.setQueryData<Deal>(queryKeys.deals.detail(result.dealId), old => old ? apply(old) : old);
    },

    // Rollback on error
    onError: (_err, variables, context) => {
      if (context?.previousDeals) {
        queryClient.setQueryData(DEALS_VIEW_KEY, context.previousDeals);
      }
      if (context?.previousDetail) {
        queryClient.setQueryData(queryKeys.deals.detail(variables.dealId), context.previousDetail);
      }
    },

    // Only refetch deals on success (not contacts, not activities)
    // NOTE: We DON'T invalidate here to avoid race condition with Realtime.
    // The Realtime UPDATE event will handle synchronization.
    // Invalidating here causes the deal to "jump back" because:
    // 1. Optimistic update moves deal visually
    // 2. Server confirms update
    // 3. onSettled invalidates → refetch (may get stale data if timing is off)
    // 4. Realtime UPDATE arrives → invalidates again → refetch (may overwrite with old data)
    // By skipping invalidation here, we let Realtime handle sync naturally.
    onSettled: () => {
      // Let Realtime handle synchronization - it will invalidate when the UPDATE event arrives
    },
  });
};

/**
 * Hook React `useMoveDealSimple` que encapsula uma lógica reutilizável.
 *
 * @param {Board | null} board - Parâmetro `board`.
 * @param {{ id: string; name: string; }[] | undefined} lifecycleStages - Parâmetro `lifecycleStages`.
 * @returns {{ moveDeal: (deal: Deal | DealView, targetStageId: string, lossReason?: string | undefined, explicitWin?: boolean | undefined, explicitLost?: boolean | undefined) => Promise<...>; isMoving: boolean; error: Error | null; }} Retorna um valor do tipo `{ moveDeal: (deal: Deal | DealView, targetStageId: string, lossReason?: string | undefined, explicitWin?: boolean | undefined, explicitLost?: boolean | undefined) => Promise<...>; isMoving: boolean; error: Error | null; }`.
 */
export const useMoveDealSimple = (
  board: Board | null,
  lifecycleStages?: { id: string; name: string }[]
) => {
  const moveDealMutation = useMoveDeal();

  const moveDeal = async (
    deal: Deal | DealView,
    targetStageId: string,
    lossReason?: string,
    explicitWin?: boolean,
    explicitLost?: boolean,
    lossCategory?: 'qualified' | 'disqualified'
  ) => {
    if (!board) {
      console.error('[useMoveDealSimple] No board provided');
      return;
    }

    return moveDealMutation.mutateAsync({
      dealId: deal.id,
      targetStageId,
      lossReason,
      lossCategory,
      deal,
      board,
      lifecycleStages,
      explicitWin,
      explicitLost,
    });
  };

  return {
    moveDeal,
    isMoving: moveDealMutation.isPending,
    error: moveDealMutation.error,
  };
};
