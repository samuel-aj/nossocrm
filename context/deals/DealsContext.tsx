import React, {
  createContext,
  useContext,
  useMemo,
  useCallback,
  ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Deal, DealView, DealItem, Company, Contact, Board } from '@/types';
import { dealsService } from '@/lib/supabase';
import { useAuth } from '../AuthContext';
import { queryKeys, DEALS_VIEW_KEY } from '@/lib/query';
import { useDeals as useTanStackDealsQuery } from '@/lib/query/hooks/useDealsQuery';

interface DealsContextType {
  // Raw data (agora vem direto do TanStack Query)
  rawDeals: Deal[];
  loading: boolean;
  error: string | null;

  // CRUD Operations
  addDeal: (deal: Omit<Deal, 'id' | 'createdAt'>) => Promise<Deal | null>;
  updateDeal: (id: string, updates: Partial<Deal>) => Promise<void>;
  updateDealStatus: (id: string, newStatus: string, lossReason?: string) => Promise<void>;
  deleteDeal: (id: string) => Promise<void>;

  // Items
  addItemToDeal: (dealId: string, item: Omit<DealItem, 'id'>) => Promise<DealItem | null>;
  /** Preço/quantidade de um item já adicionado: mexe só no snapshot daquele lead */
  updateItemInDeal: (dealId: string, itemId: string, updates: { price?: number; quantity?: number }) => Promise<void>;
  removeItemFromDeal: (dealId: string, itemId: string) => Promise<void>;

  // Refresh
  refresh: () => Promise<void>;
}

const DealsContext = createContext<DealsContextType | undefined>(undefined);

/**
 * Componente React `DealsProvider`.
 *
 * @param {{ children: ReactNode; }} { children } - ParÃ¢metro `{ children }`.
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export const DealsProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { profile } = useAuth();
  const queryClient = useQueryClient();

  // ============================================
  // TanStack Query como fonte Ãºnica de verdade
  // ============================================
  const {
    data: rawDeals = [],
    isLoading: loading,
    error: queryError,
  } = useTanStackDealsQuery();

  // Converte erro do TanStack Query para string
  const error = queryError ? (queryError as Error).message : null;

  // Refresh = invalidar cache do TanStack Query
  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.deals.all });
  }, [queryClient]);

  // ============================================
  // CRUD Operations - Usam service + invalidam cache
  // ============================================
  const addDeal = useCallback(
    async (deal: Omit<Deal, 'id' | 'createdAt'>): Promise<Deal | null> => {
      if (!profile) {
        console.error('UsuÃ¡rio nÃ£o autenticado');
        return null;
      }
      const { data, error: addError } = await dealsService.create(deal);

      if (addError) {
        console.error('Erro ao criar deal:', addError.message);
        return null;
      }

      // NÃƒO invalidar deals aqui! O CRMContext jÃ¡ fez insert otimista e o Realtime
      // tambÃ©m adiciona ao cache. invalidateQueries causaria um refetch que poderia
      // sobrescrever o cache otimista com dados desatualizados (eventual consistency).
      // Apenas dashboard stats pode ser invalidado (nÃ£o afeta deals cache)
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.stats });

      return data;
    },
    [profile, queryClient]
  );

  const updateDeal = useCallback(async (id: string, updates: Partial<Deal>) => {
    const optimisticTimestamp = new Date().toISOString();

    // Optimistic update - usa DEALS_VIEW_KEY como fonte unica para listas de deals.
    queryClient.setQueryData<DealView[]>(DEALS_VIEW_KEY, (old = []) =>
      old.map((deal) =>
        deal.id === id ? { ...deal, ...updates, updatedAt: optimisticTimestamp } : deal
      )
    );

    queryClient.setQueryData<Deal>(queryKeys.deals.detail(id), (old) =>
      old ? { ...old, ...updates, updatedAt: optimisticTimestamp } : old
    );

    const { error: updateError } = await dealsService.update(id, updates);

    if (updateError) {
      console.error('Erro ao atualizar deal:', updateError.message);
      // Rollback: invalida para refetch em caso de erro
      await queryClient.invalidateQueries({ queryKey: queryKeys.deals.all });
      return;
    }

    // Sucesso: Realtime vai sincronizar. NÃ£o precisa de invalidateQueries.
  }, [queryClient]);

  const updateDealStatus = useCallback(
    async (id: string, newStatus: string, lossReason?: string) => {
      const updates: Partial<Deal> = {
        status: newStatus as Deal['status'],
        lastStageChangeDate: new Date().toISOString(),
        ...(lossReason && { lossReason }),
        ...(newStatus === 'WON' && { closedAt: new Date().toISOString(), isWon: true }),
        ...(newStatus === 'LOST' && { closedAt: new Date().toISOString(), isLost: true }),
      };

      await updateDeal(id, updates);
    },
    [updateDeal]
  );

  const deleteDeal = useCallback(async (id: string) => {
    // Optimistic update - remove da UI imediatamente
    queryClient.setQueryData<DealView[]>(DEALS_VIEW_KEY, (old = []) =>
      old.filter(deal => deal.id !== id)
    );

    const { error: deleteError } = await dealsService.delete(id);

    if (deleteError) {
      console.error('Erro ao deletar deal:', deleteError.message);
      // Rollback: invalida para refetch em caso de erro
      await queryClient.invalidateQueries({ queryKey: queryKeys.deals.all });
      return;
    }

    // Sucesso: atualiza stats do dashboard
    await queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.stats });
  }, [queryClient]);

  // ============================================
  // Items Operations
  // ============================================
  const addItemToDeal = useCallback(
    async (dealId: string, item: Omit<DealItem, 'id'>): Promise<DealItem | null> => {
      // Optimistic insert: UI atualiza instantaneamente.
      // Cache é a verdade; Realtime sincroniza entre abas (sem invalidateQueries).
      const tempId = `temp-item-${Date.now()}`;
      const optimisticItem: DealItem = { ...item, id: tempId };

      const previousLists = queryClient.getQueryData<Deal[]>(queryKeys.deals.lists());
      const previousView = queryClient.getQueryData<DealView[]>(DEALS_VIEW_KEY);
      const previousDetail = queryClient.getQueryData<Deal>(queryKeys.deals.detail(dealId));

      const withItem = <T extends Deal>(d: T): T => {
        const nextItems = [...(d.items || []), optimisticItem];
        const nextValue = nextItems.reduce((sum, i) => sum + i.price * i.quantity, 0);
        return { ...d, items: nextItems, value: nextValue } as T;
      };

      queryClient.setQueryData<Deal[]>(queryKeys.deals.lists(), (old) =>
        old?.map((d) => (d.id === dealId ? withItem(d) : d))
      );
      queryClient.setQueryData<DealView[]>(DEALS_VIEW_KEY, (old) =>
        old?.map((d) => (d.id === dealId ? withItem(d) : d))
      );
      queryClient.setQueryData<Deal>(queryKeys.deals.detail(dealId), (old) =>
        old ? withItem(old) : old
      );

      const { data, error: addError } = await dealsService.addItem(dealId, item);

      if (addError || !data) {
        console.error('Erro ao adicionar item:', addError?.message);
        // Rollback
        queryClient.setQueryData(queryKeys.deals.lists(), previousLists);
        queryClient.setQueryData(DEALS_VIEW_KEY, previousView);
        queryClient.setQueryData(queryKeys.deals.detail(dealId), previousDetail);
        return null;
      }

      // Troca o item temp pelo real (id do servidor).
      const swapTemp = <T extends Deal>(d: T): T => {
        const nextItems = (d.items || []).map((i) => (i.id === tempId ? data : i));
        const nextValue = nextItems.reduce((sum, i) => sum + i.price * i.quantity, 0);
        return { ...d, items: nextItems, value: nextValue } as T;
      };

      queryClient.setQueryData<Deal[]>(queryKeys.deals.lists(), (old) =>
        old?.map((d) => (d.id === dealId ? swapTemp(d) : d))
      );
      queryClient.setQueryData<DealView[]>(DEALS_VIEW_KEY, (old) =>
        old?.map((d) => (d.id === dealId ? swapTemp(d) : d))
      );
      queryClient.setQueryData<Deal>(queryKeys.deals.detail(dealId), (old) =>
        old ? swapTemp(old) : old
      );

      return data;
    },
    [queryClient]
  );

  const updateItemInDeal = useCallback(
    async (dealId: string, itemId: string, updates: { price?: number; quantity?: number }) => {
      // Optimistic update: UI atualiza instantaneamente; cache é a verdade.
      const previousLists = queryClient.getQueryData<Deal[]>(queryKeys.deals.lists());
      const previousView = queryClient.getQueryData<DealView[]>(DEALS_VIEW_KEY);
      const previousDetail = queryClient.getQueryData<Deal>(queryKeys.deals.detail(dealId));

      const withUpdate = <T extends Deal>(d: T): T => {
        if (d.id !== dealId) return d;
        const nextItems = (d.items || []).map((i) => (i.id === itemId ? { ...i, ...updates } : i));
        const nextValue = nextItems.reduce((sum, i) => sum + i.price * i.quantity, 0);
        return { ...d, items: nextItems, value: nextValue } as T;
      };

      queryClient.setQueryData<Deal[]>(queryKeys.deals.lists(), (old) => old?.map(withUpdate));
      queryClient.setQueryData<DealView[]>(DEALS_VIEW_KEY, (old) => old?.map(withUpdate));
      queryClient.setQueryData<Deal>(queryKeys.deals.detail(dealId), (old) =>
        old ? withUpdate(old) : old
      );

      const { error: updateError } = await dealsService.updateItem(dealId, itemId, updates);

      if (updateError) {
        console.error('Erro ao alterar item:', updateError.message);
        // Rollback
        queryClient.setQueryData(queryKeys.deals.lists(), previousLists);
        queryClient.setQueryData(DEALS_VIEW_KEY, previousView);
        queryClient.setQueryData(queryKeys.deals.detail(dealId), previousDetail);
      }
      // Sucesso: Realtime UPDATE echo confirma o que o cache já mostra.
    },
    [queryClient]
  );

  const removeItemFromDeal = useCallback(async (dealId: string, itemId: string) => {
    // Optimistic remove: UI atualiza instantaneamente.
    const previousLists = queryClient.getQueryData<Deal[]>(queryKeys.deals.lists());
    const previousView = queryClient.getQueryData<DealView[]>(DEALS_VIEW_KEY);
    const previousDetail = queryClient.getQueryData<Deal>(queryKeys.deals.detail(dealId));

    const withoutItem = <T extends Deal>(d: T): T => {
      if (d.id !== dealId) return d;
      const nextItems = (d.items || []).filter((i) => i.id !== itemId);
      const nextValue = nextItems.reduce((sum, i) => sum + i.price * i.quantity, 0);
      return { ...d, items: nextItems, value: nextValue } as T;
    };

    queryClient.setQueryData<Deal[]>(queryKeys.deals.lists(), (old) => old?.map(withoutItem));
    queryClient.setQueryData<DealView[]>(DEALS_VIEW_KEY, (old) => old?.map(withoutItem));
    queryClient.setQueryData<Deal>(queryKeys.deals.detail(dealId), (old) =>
      old ? withoutItem(old) : old
    );

    const { error: removeError } = await dealsService.removeItem(dealId, itemId);

    if (removeError) {
      console.error('Erro ao remover item:', removeError.message);
      // Rollback
      queryClient.setQueryData(queryKeys.deals.lists(), previousLists);
      queryClient.setQueryData(DEALS_VIEW_KEY, previousView);
      queryClient.setQueryData(queryKeys.deals.detail(dealId), previousDetail);
    }
    // Sucesso: Realtime DELETE echo é no-op (item já removido do cache).
  }, [queryClient]);

  const value = useMemo(
    () => ({
      rawDeals,
      loading,
      error,
      addDeal,
      updateDeal,
      updateDealStatus,
      deleteDeal,
      addItemToDeal,
      updateItemInDeal,
      removeItemFromDeal,
      refresh,
    }),
    [
      rawDeals,
      loading,
      error,
      addDeal,
      updateDeal,
      updateDealStatus,
      deleteDeal,
      addItemToDeal,
      updateItemInDeal,
      removeItemFromDeal,
      refresh,
    ]
  );

  return <DealsContext.Provider value={value}>{children}</DealsContext.Provider>;
};

/**
 * Hook React `useDeals` que encapsula uma lÃ³gica reutilizÃ¡vel.
 * @returns {DealsContextType} Retorna um valor do tipo `DealsContextType`.
 */
export const useDeals = () => {
  const context = useContext(DealsContext);
  if (context === undefined) {
    throw new Error('useDeals must be used within a DealsProvider');
  }
  return context;
};

// Hook para deals com view projection (desnormalizado)
/**
 * Hook React `useDealsView` que encapsula uma lÃ³gica reutilizÃ¡vel.
 *
 * @param {Record<string, Organization>} companyMap - ParÃ¢metro `companyMap`.
 * @param {Record<string, Contact>} contactMap - ParÃ¢metro `contactMap`.
 * @param {Board[]} boards - ParÃ¢metro `boards`.
 * @returns {DealView[]} Retorna um valor do tipo `DealView[]`.
 */
export const useDealsView = (
  companyMap: Record<string, Company>,
  contactMap: Record<string, Contact>,
  boards: Board[] = []
): DealView[] => {
  const { rawDeals } = useDeals();

  return useMemo(() => {
    return rawDeals.map(deal => {
      // Find the stage label from the board stages
      const board = boards.find(b => b.id === deal.boardId);
      const stage = board?.stages?.find(s => s.id === deal.status);

      return {
        ...deal,
        companyName: deal.companyId ? companyMap[deal.companyId]?.name : undefined,
        clientCompanyName: (deal.clientCompanyId || deal.companyId)
          ? companyMap[(deal.clientCompanyId || deal.companyId) as string]?.name
          : undefined,
        contactName: deal.contactId ? (contactMap[deal.contactId]?.name || 'Sem Contato') : 'Sem Contato',
        contactEmail: deal.contactId ? (contactMap[deal.contactId]?.email || '') : '',
        contactPhone: deal.contactId ? (contactMap[deal.contactId]?.phone || '') : '',
        stageLabel: stage?.label || 'Desconhecido',
      };
    });
  }, [rawDeals, companyMap, contactMap, boards]);
};
