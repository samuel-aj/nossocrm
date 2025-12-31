/**
 * TanStack Query hooks for Deals - Supabase Edition
 *
 * Features:
 * - Real Supabase API calls
 * - Optimistic updates for instant UI feedback
 * - Automatic cache invalidation
 * - Ready for Realtime integration
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../index';
import { dealsService, contactsService, companiesService, boardStagesService } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import type { Deal, DealView, DealItem } from '@/types';

// ============ QUERY HOOKS ============

export interface DealsFilters {
  boardId?: string;
  /** Stage id (UUID) do board_stages */
  status?: string;
  search?: string;
  minValue?: number;
  maxValue?: number;
}

/**
 * Hook to fetch all deals with optional filters
 * Waits for auth to be ready before fetching to ensure RLS works correctly
 */
export const useDeals = (filters?: DealsFilters) => {
  const { user, loading: authLoading } = useAuth();

  return useQuery({
    queryKey: filters
      ? queryKeys.deals.list(filters as Record<string, unknown>)
      : queryKeys.deals.lists(),
    queryFn: async () => {
      const { data, error } = await dealsService.getAll();
      if (error) throw error;

      let deals = data || [];

      // Apply client-side filters
      if (filters) {
        deals = deals.filter(deal => {
          if (filters.boardId && deal.boardId !== filters.boardId) return false;
          if (filters.status && deal.status !== filters.status) return false;
          if (filters.minValue && deal.value < filters.minValue) return false;
          if (filters.maxValue && deal.value > filters.maxValue) return false;
          if (filters.search) {
            const search = filters.search.toLowerCase();
            if (!(deal.title || '').toLowerCase().includes(search)) return false;
          }
          return true;
        });
      }

      return deals;
    },
    staleTime: 2 * 60 * 1000, // 2 minutes
    enabled: !authLoading && !!user, // Only fetch when auth is ready
  });
};

/**
 * Hook to fetch all deals with enriched company/contact data (DealView)
 * Waits for auth to be ready before fetching to ensure RLS works correctly
 */
export const useDealsView = (filters?: DealsFilters) => {
  const { user, loading: authLoading } = useAuth();

  return useQuery<DealView[]>({
    queryKey: filters
      ? [...queryKeys.deals.list(filters as Record<string, unknown>), 'view']
      : [...queryKeys.deals.lists(), 'view'],
    queryFn: async () => {
      // Fetch all data in parallel (including stages for stageLabel)
      const [dealsResult, contactsResult, companiesResult, stagesResult] = await Promise.all([
        dealsService.getAll(),
        contactsService.getAll(),
        companiesService.getAll(),
        boardStagesService.getAll(),
      ]);

      if (dealsResult.error) throw dealsResult.error;

      const deals = dealsResult.data || [];
      const contacts = contactsResult.data || [];
      const companies = companiesResult.data || [];
      const stages = stagesResult.data || [];

      // Create lookup maps
      const contactMap = new Map(contacts.map(c => [c.id, c]));
      const companyMap = new Map(companies.map(c => [c.id, c]));
      const stageMap = new Map(stages.map(s => [s.id, s.label || s.name]));

      // Enrich deals with company/contact names and stageLabel
      let enrichedDeals: DealView[] = deals.map(deal => {
        const contact = contactMap.get(deal.contactId);
        const company = deal.clientCompanyId ? companyMap.get(deal.clientCompanyId) : undefined;
        return {
          ...deal,
          companyName: company?.name || 'Sem empresa',
          contactName: contact?.name || 'Sem contato',
          contactEmail: contact?.email || '',
          stageLabel: stageMap.get(deal.status) || 'Estágio não identificado',
        };
      });

      // Apply client-side filters
      if (filters) {
        enrichedDeals = enrichedDeals.filter(deal => {
          if (filters.boardId && deal.boardId !== filters.boardId) return false;
          if (filters.status && deal.status !== filters.status) return false;
          if (filters.minValue && deal.value < filters.minValue) return false;
          if (filters.maxValue && deal.value > filters.maxValue) return false;
          if (filters.search) {
            const search = filters.search.toLowerCase();
            if (
              !(deal.title || '').toLowerCase().includes(search) &&
              !(deal.companyName || '').toLowerCase().includes(search)
            )
              return false;
          }
          return true;
        });
      }

      return enrichedDeals;
    },
    staleTime: 2 * 60 * 1000, // 2 minutes
    enabled: !authLoading && !!user, // Only fetch when auth is ready
  });
};

/**
 * Hook to fetch a single deal by ID
 */
export const useDeal = (id: string | undefined) => {
  const { user, loading: authLoading } = useAuth();
  return useQuery({
    queryKey: queryKeys.deals.detail(id || ''),
    queryFn: async () => {
      if (!id) return null;
      const { data, error } = await dealsService.getById(id);
      if (error) throw error;
      return data;
    },
    enabled: !authLoading && !!user && !!id,
  });
};

/**
 * Hook to fetch deals by board (for Kanban view) - Returns DealView[]
 */
export const useDealsByBoard = (boardId: string) => {
  const { user, loading: authLoading } = useAuth();
  return useQuery<DealView[]>({
    queryKey: queryKeys.deals.list({ boardId }),
    queryFn: async () => {
      const t0 = Date.now();
      // #region agent log
      if (process.env.NODE_ENV !== 'production') {
        fetch('http://127.0.0.1:7242/ingest/d70f541c-09d7-4128-9745-93f15f184017',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'ux-lag-board-deal',hypothesisId:'D8',location:'lib/query/hooks/useDealsQuery.ts:useDealsByBoard:queryFn',message:'Fetching dealsByBoard',data:{boardId8:(boardId||'').slice(0,8)||null,authReady:!authLoading&&!!user},timestamp:Date.now()})}).catch(()=>{});
      }
      // #endregion
      // Guard: should never happen due to 'enabled', but safety first
      if (!boardId) return [];
      // If we're on an optimistic temp board, don't hit the backend.
      if (boardId.startsWith('temp-')) {
        // #region agent log
        if (process.env.NODE_ENV !== 'production') {
          fetch('http://127.0.0.1:7242/ingest/d70f541c-09d7-4128-9745-93f15f184017',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'ux-lag-board-deal',hypothesisId:'D9',location:'lib/query/hooks/useDealsQuery.ts:useDealsByBoard:queryFn',message:'Skipping dealsByBoard fetch for temp board id',data:{boardId8:(boardId||'').slice(0,8)||null},timestamp:Date.now()})}).catch(()=>{});
        }
        // #endregion
        return [];
      }
      // Fetch all data in parallel (including stages for stageLabel)
      const [dealsResult, contactsResult, companiesResult, stagesResult] = await Promise.all([
        dealsService.getAll(),
        contactsService.getAll(),
        companiesService.getAll(),
        boardStagesService.getByBoardId(boardId),
      ]);

      if (dealsResult.error) throw dealsResult.error;

      const deals = (dealsResult.data || []).filter(d => d.boardId === boardId);
      const contacts = contactsResult.data || [];
      const companies = companiesResult.data || [];
      const stages = stagesResult.data || [];

      // Create lookup maps
      const contactMap = new Map(contacts.map(c => [c.id, c]));
      const companyMap = new Map(companies.map(c => [c.id, c]));
      const stageMap = new Map(stages.map(s => [s.id, s.label || s.name]));

      // Enrich deals with company/contact names and stageLabel
      const enrichedDeals: DealView[] = deals.map(deal => {
        const contact = contactMap.get(deal.contactId);
        const company = deal.clientCompanyId ? companyMap.get(deal.clientCompanyId) : undefined;
        return {
          ...deal,
          companyName: company?.name || 'Sem empresa',
          contactName: contact?.name || 'Sem contato',
          contactEmail: contact?.email || '',
          stageLabel: stageMap.get(deal.status) || 'Estágio não identificado',
        };
      });

      // #region agent log
      if (process.env.NODE_ENV !== 'production') {
        fetch('http://127.0.0.1:7242/ingest/d70f541c-09d7-4128-9745-93f15f184017',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'ux-lag-board-deal',hypothesisId:'D8',location:'lib/query/hooks/useDealsQuery.ts:useDealsByBoard:queryFn',message:'Fetched dealsByBoard',data:{boardId8:(boardId||'').slice(0,8)||null,count:enrichedDeals.length,ms:Date.now()-t0},timestamp:Date.now()})}).catch(()=>{});
      }
      // #endregion
      return enrichedDeals;
    },
    staleTime: 1 * 60 * 1000, // 1 minute for kanban (more interactive)
    enabled: !authLoading && !!user && !!boardId && !boardId.startsWith('temp-'),
  });
};

// ============ MUTATION HOOKS ============

// Input type for creating a deal (without auto-generated fields)
// isWon and isLost are optional and default to false
export type CreateDealInput = Omit<Deal, 'id' | 'createdAt' | 'updatedAt' | 'isWon' | 'isLost'> & {
  isWon?: boolean;
  isLost?: boolean;
};

/**
 * Hook to create a new deal
 */
export const useCreateDeal = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (deal: CreateDealInput) => {
      // organization_id will be auto-set by trigger on server
      const fullDeal = {
        ...deal,
        isWon: deal.isWon ?? false,
        isLost: deal.isLost ?? false,
        updatedAt: new Date().toISOString(),
      };

      // Passa null ao invés de '' - o trigger vai preencher automaticamente
      const { data, error } = await dealsService.create(fullDeal);

      if (error) throw error;
      return data!;
    },
    onMutate: async newDeal => {
      await queryClient.cancelQueries({ queryKey: queryKeys.deals.all });

      const previousDeals = queryClient.getQueryData<Deal[]>(queryKeys.deals.lists());

      // Optimistic update with temp ID
      const tempDeal: Deal = {
        ...newDeal,
        id: `temp-${Date.now()}`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isWon: newDeal.isWon ?? false,
        isLost: newDeal.isLost ?? false,
      } as Deal;

      queryClient.setQueryData<Deal[]>(queryKeys.deals.lists(), (old = []) => [tempDeal, ...old]);

      return { previousDeals };
    },
    onError: (_error, _newDeal, context) => {
      if (context?.previousDeals) {
        queryClient.setQueryData(queryKeys.deals.lists(), context.previousDeals);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.deals.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.stats });
    },
  });
};

/**
 * Hook to update a deal
 */
export const useUpdateDeal = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<Deal> }) => {
      const { error } = await dealsService.update(id, updates);
      if (error) throw error;
      return { id, updates };
    },
    onMutate: async ({ id, updates }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.deals.all });

      const previousDeals = queryClient.getQueryData<Deal[]>(queryKeys.deals.lists());

      queryClient.setQueryData<Deal[]>(queryKeys.deals.lists(), (old = []) =>
        old.map(deal =>
          deal.id === id ? { ...deal, ...updates, updatedAt: new Date().toISOString() } : deal
        )
      );

      // Also update detail cache
      queryClient.setQueryData<Deal>(queryKeys.deals.detail(id), old =>
        old ? { ...old, ...updates, updatedAt: new Date().toISOString() } : old
      );

      return { previousDeals };
    },
    onError: (_error, _variables, context) => {
      if (context?.previousDeals) {
        queryClient.setQueryData(queryKeys.deals.lists(), context.previousDeals);
      }
    },
    onSettled: (_data, _error, { id }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.deals.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.deals.detail(id) });
    },
  });
};

/**
 * Hook to update deal status (for drag & drop in Kanban)
 * Optimized for instant UI feedback
 * 
 * When moving a deal:
 * - If dropping into CUSTOMER stage: marks as won
 * - If dropping into OTHER stage: marks as lost
 * - If dropping into regular stage: reopens the deal if it was won/lost
 */
export const useUpdateDealStatus = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      status,
      lossReason,
      isWon,
      isLost,
    }: {
      id: string;
      status: string;
      lossReason?: string;
      isWon?: boolean;
      isLost?: boolean;
    }) => {
      const updates: Partial<Deal> = {
        status,
        lastStageChangeDate: new Date().toISOString(),
        ...(lossReason && { lossReason }),
      };

      // Update won/lost status if provided
      if (isWon !== undefined) {
        updates.isWon = isWon;
        if (isWon) updates.closedAt = new Date().toISOString();
      }
      if (isLost !== undefined) {
        updates.isLost = isLost;
        if (isLost) updates.closedAt = new Date().toISOString();
      }
      // Clear closedAt if reopening
      if (isWon === false && isLost === false) {
        updates.closedAt = null as unknown as string;
      }

      const { error } = await dealsService.update(id, updates);
      if (error) throw error;
      return { id, status, lossReason, isWon, isLost };
    },
    onMutate: async ({ id, status, lossReason, isWon, isLost }) => {
      // Cancel all deals queries to prevent race conditions
      await queryClient.cancelQueries({ queryKey: queryKeys.deals.all });

      // Store previous state for ALL deal queries (including by-board queries)
      const previousState = queryClient.getQueriesData<Deal[] | DealView[]>({
        queryKey: queryKeys.deals.lists()
      });

      // Optimistic update for ALL deal list queries (including Kanban's useDealsByBoard)
      queryClient.setQueriesData<Deal[] | DealView[]>(
        { queryKey: queryKeys.deals.lists() },
        (old = []) =>
          old.map(deal =>
            deal.id === id
              ? {
                ...deal,
                status,
                lastStageChangeDate: new Date().toISOString(),
                ...(lossReason && { lossReason }),
                ...(isWon !== undefined && { isWon }),
                ...(isLost !== undefined && { isLost }),
              }
              : deal
          )
      );

      return { previousState };
    },
    onError: (_error, _variables, context) => {
      // Restore ALL previous states on error
      if (context?.previousState) {
        context.previousState.forEach(([queryKey, data]) => {
          queryClient.setQueryData(queryKey, data);
        });
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.deals.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.stats });
    },
  });
};

/**
 * Hook to delete a deal
 */
export const useDeleteDeal = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await dealsService.delete(id);
      if (error) throw error;
      return id;
    },
    onMutate: async id => {
      await queryClient.cancelQueries({ queryKey: queryKeys.deals.all });

      const previousDeals = queryClient.getQueryData<Deal[]>(queryKeys.deals.lists());

      queryClient.setQueryData<Deal[]>(queryKeys.deals.lists(), (old = []) =>
        old.filter(deal => deal.id !== id)
      );

      return { previousDeals };
    },
    onError: (_error, _id, context) => {
      if (context?.previousDeals) {
        queryClient.setQueryData(queryKeys.deals.lists(), context.previousDeals);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.deals.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.stats });
    },
  });
};

// ============ DEAL ITEMS MUTATIONS ============

/**
 * Hook to add an item to a deal
 */
export const useAddDealItem = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ dealId, item }: { dealId: string; item: Omit<DealItem, 'id'> }) => {
      const { data, error } = await dealsService.addItem(dealId, item);
      if (error) throw error;
      return { dealId, item: data! };
    },
    onSettled: (_data, _error, { dealId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.deals.detail(dealId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.deals.lists() });
    },
  });
};

/**
 * Hook to remove an item from a deal
 */
export const useRemoveDealItem = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ dealId, itemId }: { dealId: string; itemId: string }) => {
      const { error } = await dealsService.removeItem(dealId, itemId);
      if (error) throw error;
      return { dealId, itemId };
    },
    onSettled: (_data, _error, { dealId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.deals.detail(dealId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.deals.lists() });
    },
  });
};

// ============ UTILITY HOOKS ============

/**
 * Hook to invalidate all deals queries (useful after bulk operations)
 */
export const useInvalidateDeals = () => {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: queryKeys.deals.all });
};

/**
 * Hook to prefetch a deal (for hover previews)
 */
export const usePrefetchDeal = () => {
  const queryClient = useQueryClient();
  return async (id: string) => {
    await queryClient.prefetchQuery({
      queryKey: queryKeys.deals.detail(id),
      queryFn: async () => {
        const { data, error } = await dealsService.getById(id);
        if (error) throw error;
        return data;
      },
      staleTime: 5 * 60 * 1000,
    });
  };
};
