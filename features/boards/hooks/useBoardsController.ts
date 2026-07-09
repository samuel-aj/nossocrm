import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { DealView, Board, CustomFieldDefinition } from '@/types';
import {
  useBoards,
  useDefaultBoard,
  useCreateBoard,
  useUpdateBoard,
  useDeleteBoard,
  useDeleteBoardWithMove,
  useCanDeleteBoard,
} from '@/lib/query/hooks/useBoardsQuery';
import {
  useDealsByBoard,
} from '@/lib/query/hooks/useDealsQuery';
import { useMoveDeal } from '@/lib/query/hooks/useMoveDeal';
import { useOrgPreferences } from '@/lib/query/hooks/useOrgPreferences';
import { usePersistedState } from '@/hooks/usePersistedState';
import { useRealtimeSyncKanban } from '@/lib/realtime/useRealtimeSync';
import { useToast } from '@/context/ToastContext';
import { useAuth } from '@/context/AuthContext';
import { useCRM } from '@/context/CRMContext';
import { useAI } from '@/context/AIContext';

/**
 * Função pública `isDealRotting` do projeto.
 *
 * @param {DealView} deal - Parâmetro `deal`.
 * @returns {boolean} Retorna um valor do tipo `boolean`.
 */
export const isDealRotting = (deal: DealView) => {
  const dateToCheck = deal.lastStageChangeDate || deal.updatedAt;
  const diff = new Date().getTime() - new Date(dateToCheck).getTime();
  const days = diff / (1000 * 3600 * 24);
  return days > 10;
};

/**
 * Função pública `getActivityStatus` do projeto.
 *
 * @param {DealView} deal - Parâmetro `deal`.
 * @returns {"yellow" | "red" | "green" | "gray"} Retorna um valor do tipo `"yellow" | "red" | "green" | "gray"`.
 */
export const getActivityStatus = (deal: DealView) => {
  if (!deal.nextActivity) return 'yellow';
  if (deal.nextActivity.isOverdue) return 'red';
  const activityDate = new Date(deal.nextActivity.date);
  const today = new Date();
  if (activityDate.toDateString() === today.toDateString()) return 'green';
  return 'gray';
};

/**
 * Hook React `useBoardsController` que encapsula uma lógica reutilizável.
 * @returns {{ boards: Board[]; boardsLoading: boolean; boardsFetched: boolean; activeBoard: Board | null; activeBoardId: string | null; handleSelectBoard: (boardId: string) => void; ... 45 more ...; handleLossReasonClose: () => void; }} Retorna um valor do tipo `{ boards: Board[]; boardsLoading: boolean; boardsFetched: boolean; activeBoard: Board | null; activeBoardId: string | null; handleSelectBoard: (boardId: string) => void; ... 45 more ...; handleLossReasonClose: () => void; }`.
 */
export const useBoardsController = () => {
  // Toast for feedback
  const { addToast } = useToast();
  const { profile, organizationId } = useAuth();
  const searchParams = useSearchParams();
  const router = useRouter();

  // AI Context
  const { setContext, clearContext } = useAI();

  // TanStack Query hooks
  const {
    data: boards = [],
    isLoading: boardsLoading,
    isFetched: boardsFetched,
    isFetching: boardsFetching,
    dataUpdatedAt: boardsUpdatedAt,
  } = useBoards();
  const { data: defaultBoard } = useDefaultBoard();
  const createBoardMutation = useCreateBoard();
  const updateBoardMutation = useUpdateBoard();
  const deleteBoardMutation = useDeleteBoard();
  const deleteBoardWithMoveMutation = useDeleteBoardWithMove();

  // Active board state (persisted)
  const [activeBoardId, setActiveBoardId] = usePersistedState<string | null>(
    'crm_active_board_id',
    null
  );

  // Set active board: prefer persisted choice → defaultBoard → primeiro board carregado.
  // FIX: antes só selecionava se `defaultBoard` estivesse carregado, deixando
  // `activeBoardId` null quando a org não tinha nenhum board marcado como default
  // (caso comum). Com isso o PipelineView renderizava o empty state ("Crie seu
  // primeiro Board") mesmo havendo boards. Agora também fazemos fallback para
  // boards[0] quando defaultBoard está ausente.
  useEffect(() => {
    if (!activeBoardId) {
      if (defaultBoard?.id) {
        setActiveBoardId(defaultBoard.id);
      } else if (boards.length > 0) {
        setActiveBoardId(boards[0].id);
      }
      return;
    }

    // Se o activeBoardId não existe mais nos boards carregados, limpa e usa default/primeiro
    if (activeBoardId && boards.length > 0) {
      const boardExists = boards.some(b => b.id === activeBoardId);
      if (!boardExists) {
        const newActiveId = defaultBoard?.id || boards[0]?.id || null;
        setActiveBoardId(newActiveId);
      }
    }
  }, [activeBoardId, defaultBoard, boards, setActiveBoardId]);

  // Get active board - SEMPRE sincronizado com activeBoardId válido
  const activeBoard = useMemo(() => {
    const found = boards.find(b => b.id === activeBoardId);
    // Se não encontrou, retorna o default (mas o useEffect acima vai corrigir o ID)
    return found || defaultBoard || null;
  }, [boards, activeBoardId, defaultBoard]);

  // ID efetivo - garante que é sempre do board que está sendo exibido
  const effectiveActiveBoardId = activeBoard?.id || null;

  // Deals for active board
  // Perf-first: use the persisted activeBoardId to start fetching deals immediately on hard refresh,
  // without waiting for boards list to resolve `activeBoard`.
  // Safety: if the ID is stale (board deleted), the boards effect below will correct activeBoardId
  // and we'll naturally refetch deals for the corrected board.
  const dealsBoardId = activeBoardId || '';
  const { data: deals = [], isLoading: dealsLoading } = useDealsByBoard(dealsBoardId);
  const moveDealMutation = useMoveDeal();

  // Filter State (declared before AI context useEffect that uses them)
  const [searchTerm, setSearchTerm] = useState('');
  // 'all' = todos | 'mine' = meus (profile.id) | 'none' = sem responsável | <userId> = um responsável específico
  const [ownerFilter, setOwnerFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<'open' | 'won' | 'lost' | 'all'>('open');
  const [dateRange, setDateRange] = useState({ start: '', end: '' });
  // Filtro por campo personalizado / UTM (ex.: utm_source, utm_campaign): { chave, valor }.
  // Filtro por campo personalizado/UTM (builder de condições): cada condição é
  // campo + operador (contém / igual / vazio / preenchido) + valor, combinadas
  // com E (todas) ou OU (qualquer).
  const [customFieldConditions, setCustomFieldConditions] = useState<
    Array<{ id: string; field: string; operator: 'contains' | 'equals' | 'empty' | 'not_empty'; value: string }>
  >([]);
  const [customFieldLogic, setCustomFieldLogic] = useState<'AND' | 'OR'>('AND');
  // Filtro por TAG (select com as tags cadastradas em Configurações). '' = todas.
  const [tagFilter, setTagFilter] = useState('');

  // Track last context signature to avoid unnecessary setContext calls
  const lastContextSignatureRef = useRef<string | null>(null);

  // Set AI Context for Board (FULL CONTEXT)
  useEffect(() => {
    // Performance: noisy logging and object allocation isn't useful in production.
    if (process.env.NODE_ENV !== 'production') {
      console.log('[BoardsController] useEffect running:', {
        hasActiveBoard: !!activeBoard,
        activeBoardId: activeBoard?.id,
        activeBoardName: activeBoard?.name,
        dealsCount: deals.length,
        isTempId: activeBoard?.id?.startsWith('temp-'),
      });
    }

    // Guard: don't set context for temp boards (they'll be replaced soon)
    if (!activeBoard || activeBoard.id.startsWith('temp-')) {
      return;
    }

    // Performance: avoid O(S*N) by indexing stages once and scanning deals once.
    const stageIdToLabel = new Map<string, string>();
    const dealsPerStage: Record<string, number> = {};
    for (const stage of activeBoard.stages) {
      stageIdToLabel.set(stage.id, stage.label);
      dealsPerStage[stage.label] = 0;
    }

    let pipelineValue = 0;
    let stagnantDeals = 0;
    let overdueDeals = 0;

    for (const d of deals) {
      pipelineValue += d.value ?? 0;
      if (isDealRotting(d)) stagnantDeals += 1;
      if (d.nextActivity?.isOverdue) overdueDeals += 1;

      const label = stageIdToLabel.get(d.status);
      if (label) dealsPerStage[label] = (dealsPerStage[label] ?? 0) + 1;
    }

    // Performance: avoid `find` for won/lost labels.
    const wonStageLabel = activeBoard.wonStageId ? stageIdToLabel.get(activeBoard.wonStageId) : undefined;
    const lostStageLabel = activeBoard.lostStageId ? stageIdToLabel.get(activeBoard.lostStageId) : undefined;

    // Compute signature BEFORE calling setContext to avoid unnecessary calls
    // This matches the signature logic in AIContext.tsx
    const contextSignature = [
      activeBoard.id,
      statusFilter,
      ownerFilter,
      searchTerm || '',
      dateRange.start || '',
      dateRange.end || '',
      String(deals.length),
      String(pipelineValue),
      String(stagnantDeals),
      String(overdueDeals),
    ].join('|');

    // Guard: only call setContext if signature actually changed
    if (lastContextSignatureRef.current === contextSignature) {
      return;
    }

    lastContextSignatureRef.current = contextSignature;

    if (process.env.NODE_ENV !== 'production') {
      console.log('[BoardsController] 🎯 Setting AI Context for board:', activeBoard.id, activeBoard.name);
    }

    setContext({
      view: { type: 'kanban', name: activeBoard.name, url: `/boards/${activeBoard.id}` },
      activeObject: {
        type: 'board',
        id: activeBoard.id,
        name: activeBoard.name,
        metadata: {
          // Basic Info - Include boardId explicitly for tool usage
          boardId: activeBoard.id, // <-- Explicit for AI to use in tool calls
          description: activeBoard.description,
          goal: activeBoard.goal,
          columns: activeBoard.stages.map(s => s.label).join(', '),

          // Full stage info for AI to use in tool calls
          stages: activeBoard.stages.map(s => ({
            id: s.id,
            name: s.label,
          })),

          // Metrics
          dealCount: deals.length,
          pipelineValue,
          dealsPerStage,
          stagnantDeals,
          overdueDeals,

          // Board Config
          wonStage: wonStageLabel,
          lostStage: lostStageLabel,
          linkedLifecycleStage: activeBoard.linkedLifecycleStage,

          // AI Strategy
          agentPersona: activeBoard.agentPersona,
          entryTrigger: activeBoard.entryTrigger,
          automationSuggestions: activeBoard.automationSuggestions,
        }
      },
      // Active Filters
      filters: {
        status: statusFilter,
        owner: ownerFilter,
        search: searchTerm || undefined,
        dateRange: (dateRange.start || dateRange.end) ? dateRange : undefined,
      }
    });
    // Note: Removed setContext from dependencies - it has internal guards to prevent loops
    // Note: Removed clearContext cleanup to prevent infinite loop with AIContext default setter
  }, [activeBoard, deals, statusFilter, ownerFilter, searchTerm, dateRange]);

  // Get lifecycle stages from CRM context for automations
  const { lifecycleStages, customFieldDefinitions: orgFieldDefs, deleteDeal, updateDeal, availableTags, contacts } = useCRM();
  // Etapa "Inativos" (opcional por organização — Configurações)
  const { inactiveLeadsEnabled } = useOrgPreferences();
  // Contatos com status INATIVO: com a etapa Inativos ligada, os leads desses
  // contatos vão automaticamente pra coluna Inativos.
  const inactiveContactIds = useMemo(
    () => new Set(contacts.filter(c => c.status === 'INACTIVE').map(c => c.id)),
    [contacts]
  );

  // Enable realtime sync for Kanban
  useRealtimeSyncKanban();

  // Custom field definitions (TODO: migrate to query)
  const customFieldDefinitions: CustomFieldDefinition[] = [];

  //View State
  const [viewMode, setViewMode] = useState<'kanban' | 'list'>('kanban');

  const [isCreateBoardModalOpen, setIsCreateBoardModalOpen] = useState(false);
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [editingBoard, setEditingBoard] = useState<Board | null>(null);
  const [boardCreateOverlay, setBoardCreateOverlay] = useState<{
    title: string;
    subtitle?: string;
  } | null>(null);
  const [boardToDelete, setBoardToDelete] = useState<{
    id: string;
    name: string;
    dealCount: number;
    targetBoardId?: string;
  } | null>(null);



  // Initialize filters from URL
  useEffect(() => {
    if (!searchParams) return;
    const viewParam = searchParams.get('view');
    if (viewParam === 'list' || viewParam === 'kanban') {
      setViewMode(viewParam);
    }

    const statusParam = searchParams.get('status');
    if (statusParam === 'open' || statusParam === 'won' || statusParam === 'lost' || statusParam === 'all') {
      setStatusFilter(statusParam);
    }
  }, [searchParams]);

  // Interaction State
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [selectedDealId, setSelectedDealId] = useState<string | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [openActivityMenuId, setOpenActivityMenuId] = useState<string | null>(null);
  // When the user picks Ligar/Email/Reunião in the card status-icon dropdown,
  // we route them into the deal modal on the Activities tab with the type
  // pre-selected — no activity is created automatically.
  const [scheduleHint, setScheduleHint] = useState<{
    type: 'CALL' | 'MEETING' | 'EMAIL';
  } | null>(null);

  // Loss Reason Modal State
  const [lossReasonModal, setLossReasonModal] = useState<{
    isOpen: boolean;
    dealId: string;
    dealTitle: string;
    stageId: string;
  } | null>(null);

  // Bidirectional URL <-> state sync for the open-deal modal.
  // Reloading the page inside a lead should land the user back on the same
  // card. We DON'T clear ?deal=xxx on mount (so reload preserves it), and we
  // push ?deal=xxx to the URL whenever the user opens/closes a card.
  const dealUrlInitDoneRef = useRef(false);

  // Mount: adopt ?deal= from URL into state (once).
  useEffect(() => {
    if (dealUrlInitDoneRef.current) return;
    if (!searchParams) return;
    dealUrlInitDoneRef.current = true;
    const dealIdFromUrl = searchParams.get('deal');
    if (dealIdFromUrl) {
      setSelectedDealId(dealIdFromUrl);
    }
  }, [searchParams]);

  // Post-init: mirror selectedDealId into the URL so reload preserves it.
  useEffect(() => {
    if (!dealUrlInitDoneRef.current) return;
    if (!router || !searchParams) return;
    const urlValue = searchParams.get('deal') ?? null;
    if ((selectedDealId ?? null) === urlValue) return;
    const params = new URLSearchParams(searchParams.toString());
    if (selectedDealId) {
      params.set('deal', selectedDealId);
    } else {
      params.delete('deal');
    }
    const qs = params.toString();
    router.replace(qs ? `?${qs}` : '?', { scroll: false });
  }, [selectedDealId, router, searchParams]);

  // Fallback for drag issues
  const lastMouseDownDealId = React.useRef<string | null>(null);
  const setLastMouseDownDealId = (id: string | null) => {
    lastMouseDownDealId.current = id;
  };

  // Combined loading state
  // Avoid full-page "blink": dealsLoading can briefly flip to true when switching
  // from temp board id -> real board id. Keep the page rendered and let deals load in-place.
  // Also avoid the "empty state flash" on hard refresh: hold the loader until the FIRST successful
  // boards fetch happened (dataUpdatedAt>0). This is more robust than relying solely on `isFetched`,
  // which can be true via cache/hydration even when the live fetch hasn't run yet.
  const hasEverLoadedBoards = boardsUpdatedAt > 0;
  const isLoading = (boardsLoading || boardsFetching || !hasEverLoadedBoards) && boards.length === 0;

  useEffect(() => {
    const handleClickOutside = () => setOpenActivityMenuId(null);
    if (openActivityMenuId) {
      document.addEventListener('click', handleClickOutside);
    }
    return () => document.removeEventListener('click', handleClickOutside);
  }, [openActivityMenuId]);

  // Opções do filtro por campo. O TIPO do controle segue a DEFINIÇÃO do campo
  // no CRM (Configurações → Campos personalizados): type select/multiselect ->
  // SELECT com as opções configuradas; demais tipos -> texto. UTMs e campos
  // sem definição são sempre texto. Ignora metadados internos (inbound_).
  const customFieldOptions = useMemo(() => {
    // valores observados nos leads: fallback de opções p/ selects sem options
    const byKey = new Map<string, Set<string>>();
    for (const d of deals) {
      const cf = d.customFields;
      if (!cf || typeof cf !== 'object') continue;
      for (const k of Object.keys(cf)) {
        if (k.startsWith('inbound_')) continue;
        const raw = (cf as Record<string, unknown>)[k];
        if (raw === null || raw === undefined) continue;
        const value = (Array.isArray(raw) ? raw.join(', ') : String(raw)).trim();
        if (!value) continue;
        let set = byKey.get(k);
        if (!set) {
          set = new Set();
          byKey.set(k, set);
        }
        if (value.length <= 80 && set.size < 30) set.add(value);
      }
    }
    const defByKey = new Map(orgFieldDefs.map((f) => [f.key, f]));
    return Array.from(byKey.entries())
      .map(([key, observed]) => {
        const def = defByKey.get(key);
        const isSelect = !key.startsWith('utm_') && (def?.type === 'select' || def?.type === 'multiselect');
        const options = isSelect
          ? (def?.options?.length ? def.options : Array.from(observed).sort((a, b) => a.localeCompare(b)))
          : [];
        return {
          key,
          label: def?.label || key,
          kind: (isSelect ? 'select' : 'text') as 'select' | 'text',
          options,
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [deals, orgFieldDefs]);

  // Opções do filtro de TAG: tags cadastradas (Configurações → Tags) + tags já
  // usadas nos leads (inclui as criadas por dentro do card), dedup case-insensitive.
  const tagOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const t of availableTags || []) {
      const k = String(t).toLowerCase();
      if (!seen.has(k)) seen.set(k, String(t));
    }
    for (const d of deals) {
      for (const t of d.tags || []) {
        const k = String(t).toLowerCase();
        if (!seen.has(k)) seen.set(k, String(t));
      }
    }
    return Array.from(seen.values()).sort((a, b) => a.localeCompare(b));
  }, [availableTags, deals]);

  // Filtering Logic
  const filteredDeals = useMemo(() => {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 30);

    // Condições completas: vazio/preenchido não precisam de valor; contém/igual sim.
    const activeCfConditions = customFieldConditions.filter(
      (c) => c.field && (c.operator === 'empty' || c.operator === 'not_empty' || c.value.trim() !== '')
    );
    const tagTerm = tagFilter.trim().toLowerCase();

    return deals.filter(l => {
      // Com a etapa Inativos LIGADA: leads guardados (inactive_at) e leads de
      // contato INATIVO saem do funil normal — ficam na coluna Inativos
      // (visível no filtro "Todos"). Com a etapa desligada, nada some.
      if (
        inactiveLeadsEnabled &&
        (l.inactiveAt || (l.contactId && inactiveContactIds.has(l.contactId)))
      ) {
        return false;
      }

      const matchesSearch =
        (l.title || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (l.companyName || '').toLowerCase().includes(searchTerm.toLowerCase());

      const matchesOwner =
        ownerFilter === 'all'
          ? true
          : ownerFilter === 'mine'
            ? l.ownerId === profile?.id
            : ownerFilter === 'none'
              ? !l.ownerId
              : l.ownerId === ownerFilter;

      // Filtro por campo/UTM (condições): avalia cada condição no custom field
      // do lead e combina com E (todas) ou OU (qualquer).
      let matchesCustomField = true;
      if (activeCfConditions.length > 0) {
        const cf = l.customFields;
        const evalCondition = (c: { field: string; operator: string; value: string }) => {
          const raw = cf && typeof cf === 'object' ? (cf as Record<string, unknown>)[c.field] : undefined;
          const str = raw === null || raw === undefined
            ? ''
            : (Array.isArray(raw) ? raw.join(', ') : String(raw)).trim();
          const has = str !== '';
          const term = c.value.trim().toLowerCase();
          switch (c.operator) {
            case 'empty':
              return !has;
            case 'not_empty':
              return has;
            case 'equals':
              return has && str.toLowerCase() === term;
            default: // contains
              return has && str.toLowerCase().includes(term);
          }
        };
        matchesCustomField = customFieldLogic === 'AND'
          ? activeCfConditions.every(evalCondition)
          : activeCfConditions.some(evalCondition);
      }

      let matchesDate = true;
      if (dateRange.start) {
        matchesDate = matchesDate && new Date(l.createdAt) >= new Date(dateRange.start);
      }
      if (dateRange.end) {
        const endDate = new Date(dateRange.end);
        endDate.setHours(23, 59, 59, 999);
        matchesDate = matchesDate && new Date(l.createdAt) <= endDate;
      }

      // Status Filter Logic
      let matchesStatus = true;
      if (statusFilter === 'open') {
        matchesStatus = !l.isWon && !l.isLost;
      } else if (statusFilter === 'won') {
        matchesStatus = l.isWon;
      } else if (statusFilter === 'lost') {
        matchesStatus = l.isLost;
      }

      let matchesRecent = true;
      if (statusFilter === 'open' || statusFilter === 'all') {
        if (l.isWon || l.isLost) {
          const lastUpdate = new Date(l.updatedAt);
          if (lastUpdate < cutoffDate) {
            matchesRecent = false;
          }
        }
      }

      // Filtro por TAG selecionada (case-insensitive, match exato da tag)
      const matchesTag = !tagTerm || (l.tags || []).some((t: string) => String(t).toLowerCase() === tagTerm);

      return matchesSearch && matchesOwner && matchesCustomField && matchesTag && matchesDate && matchesStatus && matchesRecent;
    }).map(deal => {
      // Enrich owner info if it matches current user
      if (deal.ownerId === profile?.id || deal.ownerId === (profile as any)?.user_id) { // Fallback for some profile types
        return {
          ...deal,
          owner: {
            name: profile?.nickname || profile?.first_name || 'Eu',
            avatar: profile?.avatar_url || ''
          }
        };
      }
      return deal;
    });
  }, [deals, searchTerm, ownerFilter, customFieldConditions, customFieldLogic, tagFilter, dateRange, statusFilter, profile, inactiveLeadsEnabled, inactiveContactIds]);

  // ==== Etapa "Inativos" ====
  // Leads guardados (inactive_at setado), mais antigos primeiro — o countdown
  // de devolução (30d) é derivado do inactiveAt na própria coluna.
  const inactiveDeals = useMemo(() => {
    if (!inactiveLeadsEnabled) return [] as typeof deals;
    const term = searchTerm.toLowerCase();
    return deals
      // guardados manualmente (inactive_at) OU contato com status INATIVO
      .filter(d => d.inactiveAt || (d.contactId && inactiveContactIds.has(d.contactId)))
      .filter(d =>
        !term ||
        (d.title || '').toLowerCase().includes(term) ||
        (d.companyName || '').toLowerCase().includes(term)
      )
      // guardados com prazo primeiro (mais antigos no topo); contato-inativo no fim
      .sort((a, b) => {
        const ta = a.inactiveAt ? new Date(a.inactiveAt).getTime() : Number.POSITIVE_INFINITY;
        const tb = b.inactiveAt ? new Date(b.inactiveAt).getTime() : Number.POSITIVE_INFINITY;
        return ta - tb;
      });
  }, [deals, inactiveLeadsEnabled, searchTerm, inactiveContactIds]);

  const markDealInactive = (dealId: string) => {
    const deal = deals.find(d => d.id === dealId);
    if (!deal) return;
    if (deal.id.startsWith('temp-')) {
      addToast('Aguarde o negócio salvar (1s) e tente novamente.', 'info');
      return;
    }
    if (deal.inactiveAt) return; // já está em Inativos
    updateDeal(dealId, { inactiveAt: new Date().toISOString() });
    addToast('Lead guardado em Inativos. Será devolvido automaticamente em 30 dias.', 'success');
  };

  const restoreDealFromInactive = (dealId: string) => {
    const deal = deals.find(d => d.id === dealId);
    if (!deal || !deal.inactiveAt) return;
    updateDeal(dealId, { inactiveAt: null });
    addToast('Lead devolvido pro funil.', 'success');
  };

  // ==== Seleção em massa de leads ====
  // Modo explícito: liga pelo menu ⋮ ("Selecionar vários"); só então os
  // checkboxes aparecem nos cards/etapas. Sair do modo limpa a seleção.
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedDealIds, setSelectedDealIds] = useState<string[]>([]);
  const enterSelectionMode = () => setSelectionMode(true);
  const exitSelectionMode = () => {
    setSelectionMode(false);
    setSelectedDealIds([]);
  };
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  // Etapa de PERDA escolhida numa ação em massa: pede o motivo UMA vez p/ todos.
  const [bulkLossStageId, setBulkLossStageId] = useState<string | null>(null);

  const toggleDealSelection = (dealId: string) => {
    setSelectedDealIds(prev => (prev.includes(dealId) ? prev.filter(id => id !== dealId) : [...prev, dealId]));
  };

  const clearDealSelection = () => setSelectedDealIds([]);

  // Seleciona/deseleciona TODOS os leads visíveis de uma etapa.
  const toggleStageSelection = (stageId: string) => {
    const stageDealIds = filteredDeals
      .filter(d => d.status === stageId && !d.id.startsWith('temp-'))
      .map(d => d.id);
    if (stageDealIds.length === 0) return;
    setSelectedDealIds(prev => {
      const set = new Set(prev);
      const allSelected = stageDealIds.every(id => set.has(id));
      if (allSelected) stageDealIds.forEach(id => set.delete(id));
      else stageDealIds.forEach(id => set.add(id));
      return Array.from(set);
    });
  };

  // Mover todos os selecionados p/ uma etapa. Etapa de perda SEM motivo →
  // guarda a etapa e a UI abre o modal de motivo (uma vez p/ todos).
  const bulkMoveToStage = (stageId: string, lossReason?: string) => {
    if (!activeBoard) return;
    const targetStage = activeBoard.stages.find(s => s.id === stageId);
    if (targetStage?.linkedLifecycleStage === 'OTHER' && !lossReason) {
      setBulkLossStageId(stageId);
      return;
    }
    let moved = 0;
    for (const dealId of selectedDealIds) {
      const deal = deals.find(d => d.id === dealId);
      if (!deal || deal.id.startsWith('temp-')) continue;
      moveDealMutation.mutate({
        dealId,
        targetStageId: stageId,
        ...(lossReason ? { lossReason } : {}),
        deal,
        board: activeBoard,
        lifecycleStages,
      });
      moved++;
    }
    addToast(`${moved} negócio(s) movidos de etapa.`, 'success');
    setBulkLossStageId(null);
    clearDealSelection();
  };

  // Adicionar/remover uma tag em todos os selecionados.
  const bulkEditTags = (mode: 'add' | 'remove', tag: string) => {
    const t = tag.trim();
    if (!t) return;
    let changed = 0;
    for (const dealId of selectedDealIds) {
      const deal = deals.find(d => d.id === dealId);
      if (!deal || deal.id.startsWith('temp-')) continue;
      const current = deal.tags || [];
      const has = current.some(x => x.toLowerCase() === t.toLowerCase());
      if (mode === 'add' && !has) {
        updateDeal(dealId, { tags: [...current, t] });
        changed++;
      } else if (mode === 'remove' && has) {
        updateDeal(dealId, { tags: current.filter(x => x.toLowerCase() !== t.toLowerCase()) });
        changed++;
      }
    }
    addToast(
      mode === 'add'
        ? `Tag "${t}" adicionada em ${changed} negócio(s).`
        : `Tag "${t}" removida de ${changed} negócio(s).`,
      'success'
    );
    clearDealSelection();
  };

  // Definir um campo personalizado em todos os selecionados (valor vazio limpa).
  const bulkSetCustomField = (key: string, value: string) => {
    if (!key) return;
    let changed = 0;
    for (const dealId of selectedDealIds) {
      const deal = deals.find(d => d.id === dealId);
      if (!deal || deal.id.startsWith('temp-')) continue;
      const next = { ...(deal.customFields || {}) } as Record<string, unknown>;
      if (value.trim() === '') delete next[key];
      else next[key] = value;
      updateDeal(dealId, { customFields: next });
      changed++;
    }
    addToast(`Campo "${key}" atualizado em ${changed} negócio(s).`, 'success');
    clearDealSelection();
  };

  const confirmBulkDelete = async () => {
    let removed = 0;
    for (const dealId of selectedDealIds) {
      if (dealId.startsWith('temp-')) continue;
      try {
        await deleteDeal(dealId);
        removed++;
      } catch {
        // segue nos demais; o toast final reflete o total efetivado
      }
    }
    addToast(`${removed} negócio(s) excluídos.`, 'success');
    setBulkDeleteOpen(false);
    clearDealSelection();
  };

  // Drag & Drop Handlers
  const handleDragStart = (e: React.DragEvent, id: string, title: string) => {
    setDraggingId(id);
    e.dataTransfer.setData('dealId', id);
    // Fallback when optimistic temp id gets replaced mid-drag (avoid logging title).
    e.dataTransfer.setData('dealTitle', title || '');
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  /**
   * Always fires when the drag session ends — regardless of whether a drop
   * landed on a valid target. Without this, aborting a drag outside any stage
   * leaves `draggingId` set and the source card stuck tilted/translucent until
   * the user drags it again.
   */
  const handleDragEnd = () => {
    setDraggingId(null);
  };

  const handleDrop = (e: React.DragEvent, stageId: string) => {
    e.preventDefault();
    const dealId = e.dataTransfer.getData('dealId') || lastMouseDownDealId.current;
    const dealTitle = e.dataTransfer.getData('dealTitle') || '';
    if (dealId && activeBoard) {
      let deal = deals.find(d => d.id === dealId);
      // If the optimistic temp deal ID was replaced by a refetch during drag, try resolving by title.
      if (!deal && dealTitle) {
        const candidates = deals.filter(d => (d.title || '') === dealTitle);
        if (candidates.length === 1) {
          deal = candidates[0];
        } else {
          if (candidates.length > 1) {
            addToast('Não foi possível mover: existem múltiplos negócios com o mesmo título. Aguarde salvar e tente novamente.', 'info');
          }
        }
      }
      if (!deal) {
        setDraggingId(null);
        return;
      }

      // Guard: never send temp-* ids to the backend. This happens when user drags immediately after creating a deal.
      if (deal.id.startsWith('temp-')) {
        addToast('Aguarde o negócio salvar para mover (1s) e tente novamente.', 'info');
        setDraggingId(null);
        return;
      }

      // Saindo de "Inativos": soltar numa etapa devolve o lead pro funil.
      if (deal.inactiveAt) {
        updateDeal(deal.id, { inactiveAt: null });
      }

      // Find the target stage to check if it's a won/lost stage
      const targetStage = activeBoard.stages.find(s => s.id === stageId);

      // Check linkedLifecycleStage to determine won/lost status
      if (targetStage?.linkedLifecycleStage === 'OTHER') {
        // Dropping into LOST stage - open modal to ask for reason
        setLossReasonModal({
          isOpen: true,
          dealId,
          dealTitle: deal.title,
          stageId,
        });
      } else {
        // Use unified moveDeal for all other cases (WON or regular stages)
        moveDealMutation.mutate({
          dealId,
          targetStageId: stageId,
          deal,
          board: activeBoard,
          lifecycleStages,
        });
      }
    }
    setDraggingId(null);
  };

  // Handler for loss reason modal confirmation
  const handleLossReasonConfirm = (reason: string) => {
    if (lossReasonModal && activeBoard) {
      const deal = deals.find(d => d.id === lossReasonModal.dealId);
      if (deal) {
        moveDealMutation.mutate({
          dealId: lossReasonModal.dealId,
          targetStageId: lossReasonModal.stageId,
          lossReason: reason,
          deal,
          board: activeBoard,
          lifecycleStages,
        });
      }
      setLossReasonModal(null);
    }
  };

  const handleLossReasonClose = () => {
    // User cancelled - don't move the deal
    setLossReasonModal(null);
  };

  // Zona flutuante "Excluir" (drag estilo Kommo): soltar o card na zona abre
  // uma confirmação antes de excluir de verdade (ação destrutiva).
  const [deleteDealModal, setDeleteDealModal] = useState<{ dealId: string; dealTitle: string } | null>(null);

  const handleDropDelete = (dealId: string) => {
    const deal = deals.find(d => d.id === dealId);
    if (!deal) return;
    if (deal.id.startsWith('temp-')) {
      addToast('Aguarde o negócio salvar para excluir (1s) e tente novamente.', 'info');
      return;
    }
    setDeleteDealModal({ dealId, dealTitle: deal.title });
  };

  const handleDeleteDealConfirm = async () => {
    if (!deleteDealModal) return;
    try {
      await deleteDeal(deleteDealModal.dealId);
      addToast('Negócio excluído.', 'success');
    } catch {
      addToast('Falha ao excluir o negócio.', 'error');
    }
    setDeleteDealModal(null);
  };

  const handleDeleteDealClose = () => setDeleteDealModal(null);

  /**
   * Keyboard-accessible handler to move a deal to a new stage.
   * This is the accessibility alternative to drag-and-drop.
   */
  const handleMoveDealToStage = (dealId: string, newStageId: string) => {
    if (!activeBoard) return;

    const deal = deals.find(d => d.id === dealId);
    if (!deal) {
      return;
    }
    if (deal.id.startsWith('temp-')) {
      addToast('Aguarde o negócio salvar para mover (1s) e tente novamente.', 'info');
      return;
    }

    // Mudar de etapa também devolve o lead caso esteja em "Inativos".
    if (deal.inactiveAt) {
      updateDeal(deal.id, { inactiveAt: null });
    }

    // Find the target stage to check if it's a lost stage
    const targetStage = activeBoard.stages.find(s => s.id === newStageId);

    // Check linkedLifecycleStage to determine if this is a loss stage
    if (targetStage?.linkedLifecycleStage === 'OTHER') {
      // Opening a lost stage - need to ask for reason via modal
      setLossReasonModal({
        isOpen: true,
        dealId,
        dealTitle: deal.title,
        stageId: newStageId,
      });
    } else {
      // Regular move or WON stage
      moveDealMutation.mutate({
        dealId,
        targetStageId: newStageId,
        deal,
        board: activeBoard,
        lifecycleStages,
      });
    }
  };

  /**
   * Opens the deal modal on the Activities tab with the inline creation form
   * expanded and the chosen type pre-selected. The user fills date/time/notes
   * and confirms — no activity is persisted before confirmation.
   */
  const handleQuickAddActivity = (
    dealId: string,
    type: 'CALL' | 'MEETING' | 'EMAIL',
    _dealTitle: string
  ) => {
    setOpenActivityMenuId(null);
    setScheduleHint({ type });
    setSelectedDealId(dealId);
  };

  // Board Management Handlers
  const handleSelectBoard = (boardId: string) => {
    setActiveBoardId(boardId);
  };

  const makeTempId = () => {
    try {
      if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
        return `temp-${crypto.randomUUID()}`;
      }
    } catch {
      // ignore
    }
    return `temp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  };

  const handleCreateBoard = async (boardData: Omit<Board, 'id' | 'createdAt'>, order?: number) => {
    const previousActiveBoardId = activeBoard?.id || activeBoardId || null;
    const tempId = makeTempId();
    // Make the board feel instant: select the optimistic temp board immediately.
    setActiveBoardId(tempId);
    setBoardCreateOverlay({
      title: 'Criando board…',
      subtitle: boardData?.name ? `— ${boardData.name}` : undefined,
    });

    createBoardMutation.mutate({ board: boardData, order, clientTempId: tempId }, {
      onSuccess: newBoard => {
        try {
          sessionStorage.removeItem('createBoardDraft.v1');
        } catch {
          // noop
        }
        if (newBoard) {
          setActiveBoardId(newBoard.id);
        }
        setBoardCreateOverlay(null);
        setIsCreateBoardModalOpen(false);
        setIsWizardOpen(false);
      },
      onError: (error) => {
        console.error('[handleCreateBoard] Error:', error);
        addToast(error.message || 'Erro ao criar board', 'error');
        setBoardCreateOverlay(null);
        // Restore previous selection if create fails.
        if (previousActiveBoardId) {
          setActiveBoardId(previousActiveBoardId);
        }
        // Re-open modal so user can retry (draft is restored from sessionStorage)
        setIsCreateBoardModalOpen(true);
      },
    });
  };

  /**
   * Async variant used for flows that must preserve order (ex.: importing a Journey JSON).
   * Uses mutateAsync to allow sequential creation without race conditions.
   */
  const createBoardAsync = async (boardData: Omit<Board, 'id' | 'createdAt'>, order?: number) => {
    const previousActiveBoardId = activeBoard?.id || activeBoardId || null;
    try {
      // Mirror the "instant" UX of handleCreateBoard (optimistic temp selection) for async flows too.
      const tempId = makeTempId();
      setActiveBoardId(tempId);
      const newBoard = await createBoardMutation.mutateAsync({ board: boardData, order, clientTempId: tempId });
      setActiveBoardId(newBoard.id);
      return newBoard;
    } catch (error) {
      const err = error as Error;
      console.error('[createBoardAsync] Error:', err);
      addToast(err.message || 'Erro ao criar board', 'error');
      // If we failed after selecting a temp board, try to restore selection.
      if (previousActiveBoardId) setActiveBoardId(previousActiveBoardId);
      throw err;
    }
  };

  /**
   * Async variant used for flows that must update boards after creation
   * (ex.: installing an official Journey and linking boards via nextBoardId).
   */
  const updateBoardAsync = async (id: string, updates: Partial<Board>) => {
    try {
      await updateBoardMutation.mutateAsync({ id, updates });
    } catch (error) {
      const err = error as Error;
      console.error('[updateBoardAsync] Error:', err);
      addToast(err.message || 'Erro ao atualizar board', 'error');
      throw err;
    }
  };

  const handleEditBoard = (board: Board) => {
    setEditingBoard(board);
    setIsCreateBoardModalOpen(true);
  };

  const handleUpdateBoard = (boardData: Omit<Board, 'id' | 'createdAt'>) => {
    if (editingBoard) {
      updateBoardMutation.mutate(
        {
          id: editingBoard.id,
          updates: {
            name: boardData.name,
            description: boardData.description,
            nextBoardId: boardData.nextBoardId,
            linkedLifecycleStage: boardData.linkedLifecycleStage,
            wonStageId: boardData.wonStageId,
            lostStageId: boardData.lostStageId,
            stages: boardData.stages,
          },
        },
        {
          onSuccess: () => {
            setEditingBoard(null);
            setIsCreateBoardModalOpen(false);
          },
        }
      );
    }
  };

  const handleDeleteBoard = async (boardId: string) => {
    const board = boards.find(b => b.id === boardId);
    if (!board) return;

    // Verifica quantos deals tem
    const result = await import('@/lib/supabase/boards').then(m =>
      m.boardsService.canDelete(boardId)
    );

    setBoardToDelete({
      id: boardId,
      name: board.name,
      dealCount: result.dealCount ?? 0
    });
  };

  const confirmDeleteBoard = async () => {
    if (!boardToDelete) return;

    const { targetBoardId } = boardToDelete;

    // Caso 1: Usuário quer deletar os deals junto
    if (targetBoardId === '__DELETE__') {
      try {
        // Deleta todos os deals do board primeiro
        const { dealsService } = await import('@/lib/supabase/deals');
        const { error: deleteDealsError } = await dealsService.deleteByBoardId(boardToDelete.id);

        if (deleteDealsError) {
          addToast('Erro ao excluir negócios: ' + deleteDealsError.message, 'error');
          return;
        }

        // Agora deleta o board
        deleteBoardMutation.mutate(boardToDelete.id, {
          onSuccess: () => {
            addToast(`Board "${boardToDelete.name}" e seus negócios foram excluídos`, 'success');
            if (boardToDelete.id === activeBoardId && defaultBoard && defaultBoard.id !== boardToDelete.id) {
              setActiveBoardId(defaultBoard.id);
            }
            setBoardToDelete(null);
          },
          onError: (error: Error) => {
            addToast(error.message || 'Erro ao excluir board', 'error');
            setBoardToDelete(null);
          },
        });
      } catch (e) {
        addToast('Erro inesperado ao excluir', 'error');
        setBoardToDelete(null);
      }
      return;
    }

    // Caso 2: Mover deals pra outro board
    if (boardToDelete.dealCount > 0 && targetBoardId) {
      deleteBoardWithMoveMutation.mutate(
        { boardId: boardToDelete.id, targetBoardId },
        {
          onSuccess: () => {
            addToast(`Board "${boardToDelete.name}" excluído! Negócios movidos com sucesso.`, 'success');
            if (boardToDelete.id === activeBoardId) {
              setActiveBoardId(targetBoardId);
            }
            setBoardToDelete(null);
          },
          onError: (error: Error) => {
            addToast(error.message || 'Erro ao excluir board', 'error');
            setBoardToDelete(null);
          },
        }
      );
      return;
    }

    // Caso 3: Board sem deals - delete normal
    deleteBoardMutation.mutate(boardToDelete.id, {
      onSuccess: () => {
        addToast(`Board "${boardToDelete.name}" excluído com sucesso`, 'success');
        if (boardToDelete.id === activeBoardId && defaultBoard) {
          setActiveBoardId(defaultBoard.id);
        }
        setBoardToDelete(null);
      },
      onError: (error: Error) => {
        addToast(error.message || 'Erro ao excluir board', 'error');
        setBoardToDelete(null);
      },
    });
  };

  const setTargetBoardForDelete = (targetBoardId: string) => {
    if (boardToDelete) {
      setBoardToDelete({ ...boardToDelete, targetBoardId });
    }
  };

  // Boards disponíveis para mover deals (exclui o board sendo deletado)
  const availableBoardsForMove = useMemo(() => {
    if (!boardToDelete) return [];
    return boards.filter(b => b.id !== boardToDelete.id);
  }, [boards, boardToDelete]);

  return {
    // Boards
    boards,
    boardsLoading, // Specific loading state for boards
    boardsFetched, // True after first successful fetch
    activeBoard,
    activeBoardId, // Persisted selection (best for perf-first refresh)
    effectiveActiveBoardId, // Actually resolved board id (null until boards arrive)
    handleSelectBoard,
    handleCreateBoard,
    createBoardAsync,
    updateBoardAsync,
    handleEditBoard,
    handleUpdateBoard,
    handleDeleteBoard,
    confirmDeleteBoard,
    boardToDelete,
    setBoardToDelete,
    setTargetBoardForDelete,
    availableBoardsForMove,
    isCreateBoardModalOpen,
    setIsCreateBoardModalOpen,
    isWizardOpen,
    setIsWizardOpen,
    editingBoard,
    setEditingBoard,
    // View
    viewMode,
    setViewMode,
    searchTerm,
    setSearchTerm,
    ownerFilter,
    setOwnerFilter,
    customFieldConditions,
    setCustomFieldConditions,
    customFieldLogic,
    setCustomFieldLogic,
    customFieldOptions,
    tagFilter,
    setTagFilter,
    tagOptions,
    statusFilter,
    setStatusFilter,
    dateRange,
    setDateRange,

    draggingId,
    selectedDealId,
    setSelectedDealId,
    isCreateModalOpen,
    setIsCreateModalOpen,
    openActivityMenuId,
    setOpenActivityMenuId,
    filteredDeals,
    customFieldDefinitions,
    isLoading,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    handleDrop,
    handleMoveDealToStage,
    handleQuickAddActivity,
    setLastMouseDownDealId,
    // Quick-schedule hint → consumed by DealDetailModal to pre-open the form
    scheduleHint,
    clearScheduleHint: () => setScheduleHint(null),
    // Loss Reason Modal
    lossReasonModal,
    handleLossReasonConfirm,
    handleLossReasonClose,
    deleteDealModal,
    handleDropDelete,
    handleDeleteDealConfirm,
    handleDeleteDealClose,
    // Etapa Inativos
    inactiveLeadsEnabled,
    inactiveDeals,
    markDealInactive,
    restoreDealFromInactive,
    // Seleção em massa
    selectionMode,
    enterSelectionMode,
    exitSelectionMode,
    selectedDealIds,
    toggleDealSelection,
    clearDealSelection,
    toggleStageSelection,
    bulkMoveToStage,
    bulkEditTags,
    bulkSetCustomField,
    bulkDeleteOpen,
    setBulkDeleteOpen,
    confirmBulkDelete,
    bulkLossStageId,
    setBulkLossStageId,
    // UX: global overlay while creating board (start-from-zero flow)
    boardCreateOverlay,
  };
};

// @deprecated - Use useBoardsController
export const usePipelineController = useBoardsController;
