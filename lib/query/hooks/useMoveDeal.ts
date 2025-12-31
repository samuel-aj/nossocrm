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
import { queryKeys } from '../queryKeys';
import { dealsService } from '@/lib/supabase';
import { boardsService } from '@/lib/supabase/boards'; // Added
import { activitiesService } from '@/lib/supabase/activities';
import { contactsService } from '@/lib/supabase/contacts';
import type { Deal, DealView, Board, Activity } from '@/types';

interface MoveDealParams {
  dealId: string;
  targetStageId: string;
  lossReason?: string;
  // Context needed for automations
  deal: Deal | DealView;
  board: Board;
  lifecycleStages?: { id: string; name: string }[];
  explicitWin?: boolean;
  explicitLost?: boolean;
}

interface MoveDealResult {
  dealId: string;
  newStatus: string;
  isWon?: boolean;
  isLost?: boolean;
}

// Context type for optimistic updates
interface MoveDealContext {
  previousState: [readonly unknown[], Deal[] | DealView[] | undefined][];
}

/**
 * Hook React `useMoveDeal` que encapsula uma lógica reutilizável.
 * @returns {UseMutationResult<MoveDealResult, Error, MoveDealParams, MoveDealContext>} Retorna um valor do tipo `UseMutationResult<MoveDealResult, Error, MoveDealParams, MoveDealContext>`.
 */
export const useMoveDeal = () => {
  const queryClient = useQueryClient();

  return useMutation<MoveDealResult, Error, MoveDealParams, MoveDealContext>({
    mutationFn: async ({ dealId, targetStageId, lossReason, deal, board, lifecycleStages, explicitWin, explicitLost }) => {
      const t0 = Date.now();
      // #region agent log
      if (process.env.NODE_ENV !== 'production') {
        fetch('http://127.0.0.1:7242/ingest/d70f541c-09d7-4128-9745-93f15f184017',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'deal-move-first-time',hypothesisId:'M4',location:'lib/query/hooks/useMoveDeal.ts:mutationFn',message:'useMoveDeal mutationFn start',data:{dealId8:(dealId||'').slice(0,8)||null,isTempDealId:!!dealId&&dealId.startsWith('temp-'),targetStageId8:(targetStageId||'').slice(0,8)||null,boardId8:(board?.id||'').slice(0,8)||null,dealStatus8:((deal as any)?.status||'').slice(0,8)||null},timestamp:Date.now()})}).catch(()=>{});
      }
      // #endregion
      const targetStage = board.stages.find(s => s.id === targetStageId);

      // Determine isWon/isLost based on params OR linkedLifecycleStage
      let isWon: boolean | undefined;
      let isLost: boolean | undefined;
      let closedAt: string | null | undefined;

      if (explicitWin) {
        isWon = true;
        isLost = false;
        closedAt = new Date().toISOString();
      } else if (explicitLost) {
        isLost = true;
        isWon = false;
        closedAt = new Date().toISOString();
      } else if (
        // Prefer explicit won/lost stages when configured on the board.
        // Fallback to lifecycle hints ONLY when the board doesn't define won/lost IDs.
        (
          board.wonStageId
            ? targetStageId === board.wonStageId
            : (board.linkedLifecycleStage !== 'CUSTOMER' && targetStage?.linkedLifecycleStage === 'CUSTOMER')
        )
      ) {
        isWon = true;
        isLost = false;
        closedAt = new Date().toISOString();
      } else if (
        (board.lostStageId ? targetStageId === board.lostStageId : targetStage?.linkedLifecycleStage === 'OTHER')
      ) {
        isLost = true;
        isWon = false;
        closedAt = new Date().toISOString();
      } else {
        // Moving to a regular stage - reopen if was closed
        if (deal.isWon || deal.isLost) {
          isWon = false;
          isLost = false;
          closedAt = null;
        }
      }

      // Build updates object
      const updates: Partial<Deal> = {
        status: targetStageId,
        lastStageChangeDate: new Date().toISOString(),
        ...(lossReason && { lossReason }),
        ...(isWon !== undefined && { isWon }),
        ...(isLost !== undefined && { isLost }),
        ...(closedAt !== undefined && { closedAt: closedAt as string }),
      };

      // 1. Update the deal
      const { error: dealError } = await dealsService.update(dealId, updates);
      if (dealError) {
        // #region agent log
        if (process.env.NODE_ENV !== 'production') {
          fetch('http://127.0.0.1:7242/ingest/d70f541c-09d7-4128-9745-93f15f184017',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'deal-move-first-time',hypothesisId:'M5',location:'lib/query/hooks/useMoveDeal.ts:mutationFn',message:'dealsService.update failed',data:{dealId8:(dealId||'').slice(0,8)||null,isTempDealId:!!dealId&&dealId.startsWith('temp-'),errMsg:(dealError.message||'').split('\n')[0].slice(0,120),ms:Date.now()-t0},timestamp:Date.now()})}).catch(()=>{});
        }
        // #endregion
        throw dealError;
      }
      // #region agent log
      if (process.env.NODE_ENV !== 'production') {
        fetch('http://127.0.0.1:7242/ingest/d70f541c-09d7-4128-9745-93f15f184017',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'deal-move-first-time',hypothesisId:'M6',location:'lib/query/hooks/useMoveDeal.ts:mutationFn',message:'dealsService.update ok',data:{dealId8:(dealId||'').slice(0,8)||null,ms:Date.now()-t0},timestamp:Date.now()})}).catch(()=>{});
      }
      // #endregion

      // 2. Create activity "Moveu para X" (fire and forget - don't block UI)
      const stageLabel = targetStage?.label || targetStageId;
      activitiesService.create({
        dealId,
        dealTitle: deal.title,
        type: 'STATUS_CHANGE',
        title: `Moveu para ${stageLabel}`,
        description: lossReason ? `Motivo da perda: ${lossReason}` : undefined,
        date: new Date().toISOString(),
        completed: true,
        user: { name: 'Sistema', avatar: '' },
      } as Omit<Activity, 'id' | 'createdAt'>).catch(console.error);

      // 3. LinkedStage: Update contact stage when moving to linked column
      if (targetStage?.linkedLifecycleStage && deal.contactId) {
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
      const isSuccessStage =
        isWon ||
        targetStage?.linkedLifecycleStage === 'MQL' ||
        targetStage?.linkedLifecycleStage === 'SALES_QUALIFIED';

      if (isSuccessStage && board.nextBoardId) {
        (async () => {
          try {
            const targetBoard = await boardsService.get(board.nextBoardId!);
            if (targetBoard && targetBoard.stages.length > 0) {
              const entryStageId = targetBoard.stages[0].id;

              const { error: copyError } = await dealsService.create({
                title: deal.title,
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

      return { dealId, newStatus: targetStageId, isWon, isLost };
    },

    // Optimistic update: update UI instantly before server responds
    onMutate: async ({ dealId, targetStageId, deal, explicitWin, explicitLost, board }) => {
      // #region agent log
      if (process.env.NODE_ENV !== 'production') {
        fetch('http://127.0.0.1:7242/ingest/d70f541c-09d7-4128-9745-93f15f184017',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'deal-move-first-time',hypothesisId:'M7',location:'lib/query/hooks/useMoveDeal.ts:onMutate',message:'useMoveDeal onMutate (optimistic)',data:{dealId8:(dealId||'').slice(0,8)||null,isTempDealId:!!dealId&&dealId.startsWith('temp-'),targetStageId8:(targetStageId||'').slice(0,8)||null,fromStageId8:((deal as any)?.status||'').slice(0,8)||null,boardId8:(board?.id||'').slice(0,8)||null},timestamp:Date.now()})}).catch(()=>{});
      }
      // #endregion
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: queryKeys.deals.all });

      // Snapshot previous state
      const previousState: MoveDealContext['previousState'] = [];
      const queriesData = queryClient.getQueriesData<Deal[] | DealView[]>({ queryKey: queryKeys.deals.all });
      queriesData.forEach(([key, data]) => {
        previousState.push([key, data]);
      });

      // Determine new status
      const targetStage = board.stages.find(s => s.id === targetStageId);
      const isWon =
        explicitWin
        || (
          board.wonStageId
            ? targetStageId === board.wonStageId
            : (board.linkedLifecycleStage !== 'CUSTOMER' && targetStage?.linkedLifecycleStage === 'CUSTOMER')
        );
      const isLost =
        explicitLost
        || (board.lostStageId ? targetStageId === board.lostStageId : targetStage?.linkedLifecycleStage === 'OTHER');

      // Optimistically update the cache
      queryClient.setQueriesData<Deal[] | DealView[]>(
        { queryKey: queryKeys.deals.all },
        (old) => {
          if (!old) return old;
          return old.map(d => {
            if (d.id === dealId) {
              return {
                ...d,
                status: targetStageId,
                lastStageChangeDate: new Date().toISOString(),
                isWon: isWon ?? d.isWon,
                isLost: isLost ?? d.isLost,
              };
            }
            return d;
          });
        }
      );

      return { previousState };
    },

    // Rollback on error
    onError: (_err, _variables, context) => {
      if (context?.previousState) {
        context.previousState.forEach(([key, data]) => {
          queryClient.setQueryData(key, data);
        });
      }
    },

    // Only refetch deals on success (not contacts, not activities)
    onSettled: () => {
      // Single refetch to sync with server - Realtime will handle the rest
      queryClient.invalidateQueries({ queryKey: queryKeys.deals.all });
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
    explicitLost?: boolean
  ) => {
    if (!board) {
      console.error('[useMoveDealSimple] No board provided');
      return;
    }

    return moveDealMutation.mutateAsync({
      dealId: deal.id,
      targetStageId,
      lossReason,
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
