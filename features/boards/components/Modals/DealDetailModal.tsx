import { useMyActionPermissions } from '@/lib/permissions/useMyActionPermissions';
import React, { useState, useRef, useEffect, useId, useMemo, useCallback } from 'react';
import { useCRM } from '@/context/CRMContext';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import ConfirmModal from '@/components/ConfirmModal';
import { LossDetailsBanner } from '@/features/deals/LossDetailsBanner';
import { useDeal, useOrgUsers, useOrgMembers } from '@/lib/query/hooks';
import { FocusTrap, useFocusReturn } from '@/lib/a11y';
import { Activity, CustomFieldDefinition } from '@/types';

import { useResponsiveMode } from '@/hooks/useResponsiveMode';
import { DealSheet } from '../DealSheet';
import { DealWhatsAppChat, type ComposerMode } from '@/features/whatsapp/DealWhatsAppChat';
import { useQueryClient } from '@tanstack/react-query';
import { DealStageControl } from '@/features/deals/lead/DealStageControl';
import { FollowupStatus } from '@/features/deals/lead/FollowupStatus';
import { useLeadTimelineEntries } from '@/features/deals/lead/LeadTimeline';
import { PendingActivitiesStrip } from '@/features/deals/lead/PendingActivitiesStrip';
import {
  ActivityComposer,
  EMPTY_ACTIVITY_DRAFT,
  NoteComposer,
  draftFromActivity,
  type ActivityDraft,
} from '@/features/deals/lead/LeadComposers';
import { dealHistoryKey, useDealHistory } from '@/features/deals/lead/useDealHistory';
import {
  analyzeLead,
  generateEmailDraft,
  generateObjectionResponse,
} from '@/lib/ai/tasksClient';
import {
  BrainCircuit,
  Mail,
  Phone,
  Check,
  X,
  Trash2,
  Pencil,
  Building2,
  User,
  UserPlus,
  FolderOpen,
  Package,
  Sword,
  Bot,
  Tag as TagIcon,
  Maximize2,
  Minimize2,
  Copy,
  ExternalLink,
  ChevronDown,
  Archive,
  Undo2,
} from 'lucide-react';
import { formatPriorityPtBr } from '@/lib/utils/priority';

interface DealDetailModalProps {
  dealId: string | null;
  isOpen: boolean;
  onClose: () => void;
  /**
   * When provided, opens the modal directly on the Activities tab with the
   * inline quick-activity form expanded and the type pre-selected. Consumed
   * once on open and cleared by the parent after it takes effect.
   */
  scheduleHint?: { type: 'CALL' | 'MEETING' | 'EMAIL' } | null;
  /** Called when the schedule hint has been consumed, so the parent can clear it. */
  onScheduleHintConsumed?: () => void;
}

const QUICK_ACTIVITY_TITLE_BY_TYPE: Record<'CALL' | 'MEETING' | 'EMAIL', string> = {
  CALL: 'Ligar para Cliente',
  MEETING: 'Reunião de Acompanhamento',
  EMAIL: 'Enviar Email de Follow-up',
};

// Performance: reuse date formatter instance.
const PT_BR_DATETIME_FORMATTER = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

/** Cores determinísticas pros marcadores de tag (hash do nome → paleta fixa). */
const TAG_MARKER_STYLES = [
  { dot: 'bg-rose-500', chip: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/30' },
  { dot: 'bg-amber-500', chip: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30' },
  { dot: 'bg-emerald-500', chip: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/30' },
  { dot: 'bg-sky-500', chip: 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-500/10 dark:text-sky-300 dark:border-sky-500/30' },
  { dot: 'bg-violet-500', chip: 'bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-500/10 dark:text-violet-300 dark:border-violet-500/30' },
  { dot: 'bg-fuchsia-500', chip: 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200 dark:bg-fuchsia-500/10 dark:text-fuchsia-300 dark:border-fuchsia-500/30' },
  { dot: 'bg-teal-500', chip: 'bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-500/10 dark:text-teal-300 dark:border-teal-500/30' },
  { dot: 'bg-orange-500', chip: 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-500/10 dark:text-orange-300 dark:border-orange-500/30' },
];

function tagMarkerStyle(tag: string) {
  let h = 0;
  for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) >>> 0;
  return TAG_MARKER_STYLES[h % TAG_MARKER_STYLES.length];
}

/**
 * Componente React `DealDetailModal`.
 *
 * @param {DealDetailModalProps} { dealId, isOpen, onClose } - Parâmetro `{ dealId, isOpen, onClose }`.
 * @returns {Element | null} Retorna um valor do tipo `Element | null`.
 */
export const DealDetailModal: React.FC<DealDetailModalProps> = ({
  dealId,
  isOpen,
  onClose,
  scheduleHint = null,
  onScheduleHintConsumed,
}) => {
  // Accessibility: Unique ID for ARIA labelling
  const headingId = useId();

  // Accessibility: Return focus to trigger element when modal closes
  useFocusReturn({ enabled: isOpen });

  const { mode } = useResponsiveMode();
  const isMobile = mode === 'mobile';

  const {
    deals,
    contacts,
    updateDeal: updateDealRaw,
    updateContact: updateContactRaw,
    deleteDeal,
    activities,
    addActivity,
    updateActivity,
    deleteActivity,
    toggleActivityCompletion,
    isActivityPending,
    products,
    addItemToDeal,
    updateItemInDeal,
    removeItemFromDeal,
    customFieldDefinitions,
    activeBoard,
    boards,
    availableTags,
    addTag,
    sidebarCollapsed,
    setSidebarCollapsed,
  } = useCRM();
  const { profile } = useAuth();
  const { addToast } = useToast();
  const { isAdmin: canAssignOwner } = useOrgUsers();
  // Nomes p/ exibir/atribuir responsável: acessível a todo membro e inclui
  // super_admins (o organization_id deles muda ao trocar de org ativa)
  const { data: orgMembers = [] } = useOrgMembers();

  // Card aberto = menu lateral RECOLHIDO por padrão (foco total no lead).
  // O usuário ainda pode expandir pelo botão do menu; ao fechar o card,
  // o estado anterior é restaurado. A transição anima dos dois lados
  // (largura do menu no Layout + left do overlay aqui embaixo).
  const sidebarCollapsedRef = useRef(sidebarCollapsed);
  useEffect(() => {
    sidebarCollapsedRef.current = sidebarCollapsed;
  }, [sidebarCollapsed]);
  useEffect(() => {
    if (!isOpen) return;
    const wasCollapsed = sidebarCollapsedRef.current;
    setSidebarCollapsed(true);
    return () => {
      if (!wasCollapsed) setSidebarCollapsed(false);
    };
  }, [isOpen, setSidebarCollapsed]);

  // Performance: avoid repeated `find(...)` on large arrays.
  const dealsById = useMemo(() => new Map(deals.map((d) => [d.id, d])), [deals]);
  const contactsById = useMemo(() => new Map(contacts.map((c) => [c.id, c])), [contacts]);
  const boardsById = useMemo(() => new Map(boards.map((b) => [b.id, b])), [boards]);
  const productsById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const dealFromCache = dealId ? dealsById.get(dealId) : undefined;
  // Fallback fetch: when a deal id lands in the modal (deep link, brand-new
  // card from Realtime, or optimistic temp→real swap race) but the DealView
  // cache hasn't caught up yet, fetch it directly so the modal still opens
  // instead of silently returning null. The query is disabled when the cache
  // already has the deal to avoid redundant requests.
  const shouldFetch = !!dealId && !!isOpen && !dealFromCache;
  const { data: fetchedDeal, isLoading: fetchingDeal, isError: fetchDealError, isSuccess: fetchDealSuccess, refetch: refetchDeal } = useDeal(shouldFetch ? dealId : undefined);
  const deal = dealFromCache ?? (fetchedDeal as unknown as typeof dealFromCache | undefined);
  const permissions = useMyActionPermissions(deal?.boardId);
  const queryClient = useQueryClient();
  const historyQuery = useDealHistory(deal?.id, isOpen);
  const refreshHistory = () => {
    if (deal?.id) void queryClient.invalidateQueries({ queryKey: dealHistoryKey(deal.id) });
  };
  const updateDeal: typeof updateDealRaw = async (id, updates) => {
    const moving = updates.status !== undefined || updates.boardId !== undefined;
    if (moving ? !permissions.deals.move : !permissions.deals.edit) {
      addToast('Sem permissão para esta ação', 'error'); return;
    }
    await updateDealRaw(id, updates);
    refreshHistory();
  };
  const updateContact: typeof updateContactRaw = async (id, updates) => {
    if (!permissions.deals.edit) { addToast('Sem permissão para editar', 'error'); return; }
    return updateContactRaw(id, updates);
  };
  const contact = deal ? (contactsById.get(deal.contactId) ?? null) : null;

  // Determine the correct board for this deal
  const dealBoard = deal ? (boardsById.get(deal.boardId) ?? activeBoard) : activeBoard;

  // Use unified TanStack Query hook for moving deals

  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [isEditingValue, setIsEditingValue] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editValue, setEditValue] = useState('');

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isDrafting, setIsDrafting] = useState(false);
  const [aiResult, setAiResult] = useState<{ suggestion: string; score: number } | null>(null);
  const [emailDraft, setEmailDraft] = useState<string | null>(null);
  // Compositor da coluna da conversa: modo atual e rascunho de cada modo
  const [composerMode, setComposerMode] = useState<ComposerMode>('message');
  const [noteDraft, setNoteDraft] = useState('');
  const [activityDraft, setActivityDraft] = useState<ActivityDraft>(EMPTY_ACTIVITY_DRAFT);
  const [deleteNoteId, setDeleteNoteId] = useState<string | null>(null);
  // Nota/atividade salva aqui: a conversa desce até ela
  const [ownSaveKey, setOwnSaveKey] = useState(0);
  const [aiOpen, setAiOpen] = useState(false);
  const [productsOpen, setProductsOpen] = useState(false);
  // Celular: uma coluna por vez (dados do lead ou conversa)
  const [mobilePane, setMobilePane] = useState<'data' | 'chat'>('chat');
  const [descriptionDraft, setDescriptionDraft] = useState('');
  const descriptionTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [utmsOpen, setUtmsOpen] = useState(false);
  const [ownerMenuOpen, setOwnerMenuOpen] = useState(false);
  // Grupos de campos personalizados abertos (sanfona por grupo, estilo UTMs)
  const [openFieldGroups, setOpenFieldGroups] = useState<Record<string, boolean>>({});

  // Abrir uma atividade (faixa de pendentes ou linha do tempo): vai para o
  // compositor em modo Atividade, pronta para editar, remarcar ou concluir.
  const openActivityInComposer = useCallback((a: Activity) => {
    setActivityDraft(draftFromActivity(a));
    setComposerMode('activity');
    setMobilePane('chat');
  }, []);

  const [objection, setObjection] = useState('');
  const [objectionResponses, setObjectionResponses] = useState<string[]>([]);
  const [isGeneratingObjections, setIsGeneratingObjections] = useState(false);

  const [selectedProductId, setSelectedProductId] = useState('');
  const [productQuantity, setProductQuantity] = useState(1);
  // Preço DESTE lead: preenchido com o padrão do produto ao selecionar e
  // editável antes de adicionar. O cadastro em Configurações não muda.
  const [productPrice, setProductPrice] = useState('');
  // Edição inline do preço de um item já adicionado (id do item ou null)
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingItemPrice, setEditingItemPrice] = useState('');
  const [showCustomItem, setShowCustomItem] = useState(false);
  const [customItemName, setCustomItemName] = useState('');
  const [customItemPrice, setCustomItemPrice] = useState<string>('0');
  const [customItemQuantity, setCustomItemQuantity] = useState(1);

  const [deleteId, setDeleteId] = useState<string | null>(null);

  // Toda mudança relevante do lead vira uma entrada na Timeline, com autor.
  const autorAtual =
    profile?.nickname ||
    profile?.display_name ||
    profile?.name ||
    profile?.first_name ||
    (profile?.email || '').split('@')[0] ||
    'Usuário';
  const logAlteracao = (titulo: string, descricao?: string) => {
    if (!deal) return;
    // Histórico novo ligado: o banco já registra a alteração, com autor e
    // valor anterior e novo. O registro antigo só vale sem ele.
    if (historyQuery.data?.available) return;
    void addActivity({
      dealId: deal.id,
      dealTitle: deal.title,
      type: 'STATUS_CHANGE',
      title: titulo,
      description: descricao,
      date: new Date().toISOString(),
      completed: true,
      user: { name: autorAtual, avatar: profile?.avatar_url || '' },
    } as Parameters<typeof addActivity>[0]);
  };

  // Edição INLINE de campos personalizados: clicar no valor edita na hora
  // (um campo por vez). Enter/clicar fora salva; Esc cancela.
  const [editingFieldKey, setEditingFieldKey] = useState<string | null>(null);
  const [editingFieldValue, setEditingFieldValue] = useState('');

  const [tagQuery, setTagQuery] = useState('');
  // Criação de tag nova (exceção): só aparece ao escolher "Criar nova tag…"
  // no select — o campo padrão é SELEÇÃO, não escrita.
  const [tagCreating, setTagCreating] = useState(false);
  const [tagMenuOpen, setTagMenuOpen] = useState(false);
  // Padrão: abre em tela cheia; o botão no topo alterna pro modo pequeno.
  const [viewMode, setViewMode] = useState<'modal' | 'fullscreen'>('fullscreen');

  const normalizeTag = (value: string) => value.trim().replace(/\s+/g, ' ');
  const tagsLower = useMemo(() => new Set((deal?.tags || []).map(t => t.toLowerCase())), [deal?.tags]);
  const availableTagsLower = useMemo(() => new Set((availableTags || []).map(t => t.toLowerCase())), [availableTags]);

  // Campos personalizados: desagrupados (lista direta, como sempre) +
  // grupos (cada um vira uma sanfona colapsável no card). Grupos marcados
  // como ocultos nas configurações DESTE board não aparecem no card.
  const boardHiddenGroups = dealBoard?.hiddenFieldGroups;
  const { ungroupedFieldDefs, groupedFieldDefs } = useMemo(() => {
    const hidden = new Set((boardHiddenGroups || []).map(g => g.trim()));
    const ungrouped: CustomFieldDefinition[] = [];
    const groups = new Map<string, CustomFieldDefinition[]>();
    for (const f of customFieldDefinitions) {
      const g = (f.groupName ?? '').trim();
      if (g) {
        if (hidden.has(g)) continue;
        if (!groups.has(g)) groups.set(g, []);
        groups.get(g)!.push(f);
      } else {
        ungrouped.push(f);
      }
    }
    return {
      ungroupedFieldDefs: ungrouped,
      groupedFieldDefs: Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0], 'pt-BR')),
    };
  }, [customFieldDefinitions, boardHiddenGroups]);

  // Helper functions removed as they are now handled by ActivityRow component

  // Reset state when deal changes or modal opens
  useEffect(() => {
    if (isOpen && deal) {
      setEditTitle(deal.title);
      setEditValue(deal.value.toString());
      setViewMode('fullscreen'); // toda abertura começa em tela cheia
      setAiResult(null);
      setEmailDraft(null);
      setObjectionResponses([]);
      setObjection('');
      setComposerMode('message');
      setAiOpen(false);
      setMobilePane('chat');
      setProductsOpen((deal.items || []).length > 0);
      setIsEditingTitle(false);
      setIsEditingValue(false);
      setEditingFieldKey(null);
      setTagQuery('');
      setTagCreating(false);
      // Sanfonas de grupos: grupo com ALGUM campo preenchido começa aberto;
      // grupo com todos os campos vazios começa fechado. (Depois o usuário
      // pode abrir/fechar à vontade — isso é só o estado inicial do card.)
      const initialOpenGroups: Record<string, boolean> = {};
      for (const f of customFieldDefinitions) {
        const g = (f.groupName ?? '').trim();
        if (!g || initialOpenGroups[g]) continue;
        if (!isEmptyCustomFieldValue(f.type, deal.customFields?.[f.key])) {
          initialOpenGroups[g] = true;
        }
      }
      setOpenFieldGroups(initialOpenGroups);
      setNoteDraft('');
      setActivityDraft(EMPTY_ACTIVITY_DRAFT);
      setDeleteNoteId(null);
      setDescriptionDraft(deal.description ?? '');
    }
  }, [isOpen, dealId]); // Depend on dealId to reset when switching deals

  // Keep descriptionDraft in sync with the canonical deal.description whenever
  // the server value changes (cross-tab Realtime, another API write). We skip
  // the sync while the textarea is focused so we don't clobber the user's
  // in-flight typing; onBlur handler persists the draft normally.
  useEffect(() => {
    if (!isOpen || !deal) return;
    const el = descriptionTextareaRef.current;
    if (el && typeof document !== 'undefined' && document.activeElement === el) return;
    const incoming = deal.description ?? '';
    setDescriptionDraft((cur) => (cur === incoming ? cur : incoming));
  }, [isOpen, deal?.description]);

  // Auto-grow the description textarea so the full text is always visible
  // (no inner scroll). Re-runs when the draft changes, on open, and on tab switch.
  useEffect(() => {
    const el = descriptionTextareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [descriptionDraft, isOpen, mobilePane]);

  // Apply schedule hint (coming from the Kanban status icon) after the
  // base reset effect above, so the user lands directly on the activities
  // tab with the form open and the type pre-selected. The parent clears
  // the hint via `onScheduleHintConsumed` so it only fires once per intent.
  useEffect(() => {
    if (!isOpen || !deal || !scheduleHint) return;
    setActivityDraft({
      ...EMPTY_ACTIVITY_DRAFT,
      type: scheduleHint.type,
      title: QUICK_ACTIVITY_TITLE_BY_TYPE[scheduleHint.type],
    });
    setComposerMode('activity');
    setMobilePane('chat');
    onScheduleHintConsumed?.();
  }, [isOpen, dealId, scheduleHint]);

  // UX: preselect board's default product when opening the Products tab (non-invasive).
  useEffect(() => {
    if (!isOpen) return;
    if (!productsOpen) return;
    const defaultId = dealBoard?.defaultProductId;
    if (!defaultId) return;
    if (selectedProductId) return;
    // Only suggest if product exists & is active.
    const p = productsById.get(defaultId);
    if (!p || p.active === false) return;
    setSelectedProductId(defaultId);
    setProductQuantity(1);
    setProductPrice(precoParaCampo(p.price));
  }, [productsOpen, dealBoard?.defaultProductId, isOpen, productsById, selectedProductId]);

  // Pre-compute stage label once for tool prompts (avoid repeated stage lookup).
  const stageLabel = useMemo(() => {
    if (!dealBoard) return undefined;
    const stage = dealBoard.stages.find((s) => s.id === deal?.status);
    return stage?.label;
  }, [deal?.status, dealBoard]);

  // Filter & sort: open activities first (sorted by date desc), then completed ones below.
  const dealActivities = useMemo(() => {
    if (!deal) return [] as Activity[];
    const filtered = activities.filter((a) => a.dealId === deal.id);
    return filtered.sort((a, b) => {
      // Open (not completed) first
      if (a.completed !== b.completed) return a.completed ? 1 : -1;
      // Within each group, newest first
      return new Date(b.date).getTime() - new Date(a.date).getTime();
    });
  }, [activities, deal]);


  const memberNameById = useMemo(() => {
    const m = new Map(orgMembers.map(u => [u.id, u.name]));
    return (id: string) => m.get(id) ?? null;
  }, [orgMembers]);
  const saveNoteEdit = useCallback(
    async (id: string, text: string) => {
      await updateActivity(id, { description: text });
      if (deal?.id) void queryClient.invalidateQueries({ queryKey: dealHistoryKey(deal.id) });
    },
    [updateActivity, queryClient, deal?.id]
  );
  const askDeleteNote = useCallback((id: string) => setDeleteNoteId(id), []);
  const toggleActivity = useCallback((a: Activity) => void toggleActivityCompletion(a.id), [toggleActivityCompletion]);
  const timelineEntries = useLeadTimelineEntries({
    deal: deal ?? ({ createdAt: '' } as never),
    activities: dealActivities,
    history: historyQuery.data,
    boards,
    memberName: memberNameById,
    customFields: customFieldDefinitions,
    canEdit: permissions.deals.edit,
    onSaveNote: saveNoteEdit,
    onDeleteNote: askDeleteNote,
    onOpenActivity: openActivityInComposer,
    onToggleActivity: toggleActivity,
  });

  if (!isOpen) return null;

  // isOpen but the deal hasn't hydrated yet (cache race or deep-link to a
  // deal not yet in the current list). Show a minimal loading shell instead
  // of silently returning null — prevents the "URL changed but nothing
  // opens, needs F5" UX regression. `useDeal(shouldFetch)` above populates
  // `deal` as soon as the server responds or Realtime fills the cache.
  if (!deal) {
    const unavailable = fetchDealError || (fetchDealSuccess && !fetchingDeal);
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
        role="dialog"
        aria-modal="true"
        aria-busy={!unavailable}
        onClick={onClose}
      >
        <div
          className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl p-8 flex flex-col items-center gap-3"
          onClick={(e) => e.stopPropagation()}
        >
          {unavailable ? <>
            <p className="text-sm text-slate-500 dark:text-slate-400" role="alert">Não foi possível abrir este lead. Ele pode ter sido removido ou seu acesso pode ter mudado.</p>
            <button type="button" onClick={() => { void refetchDeal(); }} className="text-sm font-medium text-primary-600 dark:text-primary-400">Tentar novamente</button>
          </> : <>
            <div className="h-8 w-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-slate-500 dark:text-slate-400">Carregando lead…</p>
          </>}
          <button type="button" onClick={onClose} className="text-sm font-medium text-slate-600 dark:text-slate-300">Fechar</button>
        </div>
      </div>
    );
  }

  const addDealTag = (raw: string) => {
    const next = normalizeTag(raw);
    if (!next) return;
    if (tagsLower.has(next.toLowerCase())) return;

    const current = deal.tags || [];
    const nextTags = [...current, next];
    logAlteracao(`${autorAtual} adicionou a etiqueta "${next}"`);
    updateDeal(deal.id, { tags: nextTags });

    // Keep global tag list in sync via CRMContext
    if (!availableTagsLower.has(next.toLowerCase())) {
      addTag(next);
    }

    setTagQuery('');
  };

  const removeDealTag = (tag: string) => {
    const current = deal.tags || [];
    const nextTags = current.filter(t => t !== tag);
    logAlteracao(`${autorAtual} removeu a etiqueta "${tag}"`);
    updateDeal(deal.id, { tags: nextTags });
  };

  // Tags disponíveis pra SELECIONAR (todas da org, menos as já no lead).
  const selectableTags = (availableTags || [])
    .filter(t => !tagsLower.has(t.toLowerCase()))
    .sort((a, b) => a.localeCompare(b));

  const handleAnalyzeDeal = async () => {
    setIsAnalyzing(true);
    try {
      // Performance: stageLabel memoized above.
      const result = await analyzeLead(deal, stageLabel);
      setAiResult({ suggestion: result.suggestion, score: result.probabilityScore });
      updateDeal(deal.id, { aiSummary: result.suggestion, probability: result.probabilityScore });
    } catch (error: any) {
      console.error('[DealDetailModal] analyzeLead failed:', error);
      addToast(
        error?.message || 'Falha ao analisar deal com IA. Verifique Configurações → Inteligência Artificial.',
        'warning'
      );
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleDraftEmail = async () => {
    setIsDrafting(true);
    try {
      // Performance: stageLabel memoized above.
      const draft = await generateEmailDraft(deal, stageLabel);
      setEmailDraft(draft);
    } catch (error: any) {
      console.error('[DealDetailModal] generateEmailDraft failed:', error);
      addToast(
        error?.message || 'Falha ao gerar e-mail com IA. Verifique Configurações → Inteligência Artificial.',
        'warning'
      );
    } finally {
      setIsDrafting(false);
    }
  };


  const handleObjection = async () => {
    if (!objection.trim()) return;
    setIsGeneratingObjections(true);
    try {
      const responses = await generateObjectionResponse(deal, objection);
      setObjectionResponses(responses);
    } catch (error: any) {
      console.error('[DealDetailModal] generateObjectionResponse failed:', error);
      addToast(
        error?.message || 'Falha ao gerar respostas. Verifique Configurações → Inteligência Artificial.',
        'warning'
      );
    } finally {
      setIsGeneratingObjections(false);
    }
  };

  // Nota interna: fica só no CRM (nunca vai para o WhatsApp)
  const saveNote = async (text: string) => {
    if (!permissions.deals.edit) throw new Error('Sem permissão para editar este lead');
    const created = await addActivity({
      dealId: deal.id,
      dealTitle: deal.title,
      type: 'NOTE',
      title: 'Nota interna',
      description: text,
      date: new Date().toISOString(),
      user: { name: autorAtual, avatar: profile?.avatar_url || '' },
      completed: true,
    } as Parameters<typeof addActivity>[0]);
    if (!created) throw new Error('Não foi possível salvar a nota. O texto continua aqui.');
    setOwnSaveKey(k => k + 1);
    refreshHistory();
  };

  const submitActivity = async (d: ActivityDraft) => {
    if (!permissions.deals.edit) throw new Error('Sem permissão para editar este lead');
    const dateTime = new Date(`${d.date}T${d.time}`).toISOString();
    if (d.editingId) {
      await updateActivity(d.editingId, {
        type: d.type,
        title: d.title.trim(),
        description: d.description.trim() || undefined,
        date: dateTime,
      });
      addToast('Atividade atualizada', 'success');
    } else {
      const created = await addActivity({
        dealId: deal.id,
        dealTitle: deal.title,
        type: d.type,
        title: d.title.trim(),
        description: d.description.trim() || undefined,
        date: dateTime,
        user: { name: autorAtual, avatar: profile?.avatar_url || '' },
        // começa pendente; só a pessoa conclui
        completed: false,
      } as Parameters<typeof addActivity>[0]);
      if (!created) throw new Error('Não foi possível criar a atividade. Os dados continuam aqui.');
      setOwnSaveKey(k => k + 1);
      addToast('Atividade criada', 'success');
    }
    setActivityDraft(EMPTY_ACTIVITY_DRAFT);
    refreshHistory();
  };

  const handleAddProduct = () => {
    if (!selectedProductId) return;
    // Performance: O(1) lookup instead of scanning all products.
    const product = productsById.get(selectedProductId);
    if (!product) return;

    // Preço DESTE lead: o digitado (se válido) ou o padrão do catálogo.
    // O produto em Configurações continua com o preço original.
    const preco = productPrice.trim() === '' ? product.price : parsePreco(productPrice);
    if (preco === null) {
      addToast('Preço inválido.', 'warning');
      return;
    }

    addItemToDeal(deal.id, {
      productId: product.id,
      name: product.name,
      price: preco,
      quantity: productQuantity,
    });

    setSelectedProductId('');
    setProductQuantity(1);
    setProductPrice('');
  };

  /** Salva o preço editado inline de um item já adicionado (só neste lead). */
  const salvarPrecoItem = (itemId: string) => {
    const preco = parsePreco(editingItemPrice);
    if (preco === null) {
      addToast('Preço inválido.', 'warning');
      return;
    }
    updateItemInDeal(deal.id, itemId, { price: preco });
    setEditingItemId(null);
    setEditingItemPrice('');
  };

  const handleAddCustomItem = () => {
    const name = customItemName.trim();
    const price = Number(customItemPrice);
    const qty = Number(customItemQuantity);
    if (!name) {
      addToast('Digite o nome do item.', 'warning');
      return;
    }
    if (!Number.isFinite(price) || price < 0) {
      addToast('Preço inválido.', 'warning');
      return;
    }
    if (!Number.isFinite(qty) || qty < 1) {
      addToast('Quantidade inválida.', 'warning');
      return;
    }

    // "Produto depende do cliente": item livre, sem product_id.
    addItemToDeal(deal.id, {
      productId: '', // deal_items.product_id é opcional no schema; sanitizeUUID('') => null
      name,
      price,
      quantity: qty,
    });

    setCustomItemName('');
    setCustomItemPrice('0');
    setCustomItemQuantity(1);
    setShowCustomItem(false);
  };

  const confirmDeleteDeal = () => {
    if (deleteId && permissions.deals.delete) {
      deleteDeal(deleteId);
      addToast('Negócio excluído com sucesso', 'success');
      setDeleteId(null);
      onClose();
    }
  };

  const saveTitle = () => {
    if (editTitle) {
      if (editTitle !== deal.title) {
        logAlteracao(`${autorAtual} renomeou o lead para "${editTitle}"`, `Antes: "${deal.title}"`);
      }
      updateDeal(deal.id, { title: editTitle });
      setIsEditingTitle(false);
    }
  };

  const fmtBRL = (v: number) => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
  const saveValue = () => {
    const novo = Number(editValue);
    if (editValue !== '' && Number.isFinite(novo) && novo >= 0) {
      if (novo !== deal.value) {
        logAlteracao(`${autorAtual} alterou o valor do lead de ${fmtBRL(deal.value)} para ${fmtBRL(novo)}`);
      }
      updateDeal(deal.id, { value: novo });
    }
    setIsEditingValue(false);
  };

  const isEmptyCustomFieldValue = (
    fieldType: string,
    value: unknown
  ) => {
    if (value === undefined || value === null) return true;
    if (fieldType === 'number' || fieldType === 'currency') return value === '' || Number.isNaN(Number(value));
    if (fieldType === 'multiselect') return !Array.isArray(value) || value.length === 0;
    return String(value).trim() === '';
  };

  /** "4500,50" ou "4500.50" -> 4500.5; null quando não é um preço válido. */
  const parsePreco = (raw: string): number | null => {
    const limpo = raw.trim().replace(/[R$\s]/g, '').replace(/\.(?=\d{3}(?:\D|$))/g, '').replace(',', '.');
    if (!limpo) return null;
    const n = Number(limpo);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };

  /** Número -> texto do campo de preço (vírgula como separador decimal). */
  const precoParaCampo = (v: number) =>
    Number(v || 0).toLocaleString('pt-BR', { useGrouping: false, maximumFractionDigits: 2 });

  const getCustomFieldDisplayValue = (
    fieldType: string,
    value: unknown
  ) => {
    if (isEmptyCustomFieldValue(fieldType, value)) return null;
    if (fieldType === 'currency') {
      return Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    }
    if (fieldType === 'date' && typeof value === 'string') {
      const d = new Date(value + 'T00:00:00');
      return isNaN(d.getTime()) ? value : d.toLocaleDateString('pt-BR');
    }
    if (fieldType === 'multiselect' && Array.isArray(value)) {
      return value.join(', ');
    }
    return String(value);
  };

  // Abre o editor inline do campo clicado, com o valor atual como rascunho.
  const openFieldEditor = (field: CustomFieldDefinition) => {
    if (field.type === 'multiselect') {
      // multiselect salva direto a cada checkbox — não usa rascunho de texto
      setEditingFieldKey(field.key);
      return;
    }
    const current = deal.customFields?.[field.key];
    setEditingFieldValue(current == null ? '' : String(current));
    setEditingFieldKey(field.key);
  };

  const closeFieldEditor = () => setEditingFieldKey(null);

  // Salva UM campo. Retorna false se o valor for inválido (mantém o editor aberto).
  const commitFieldEdit = (field: CustomFieldDefinition, raw: string): boolean => {
    let nextValue: unknown;

    if (field.type === 'number' || field.type === 'currency') {
      const normalized = raw.trim().replace(',', '.');
      if (normalized === '') {
        nextValue = null;
      } else {
        const parsed = Number(normalized);
        if (!Number.isFinite(parsed)) {
          addToast(`Valor numérico inválido em "${field.label}".`, 'warning');
          return false;
        }
        nextValue = parsed;
      }
    } else if (field.type === 'date' || field.type === 'select') {
      nextValue = raw.trim() === '' ? null : raw.trim();
    } else {
      nextValue = raw.trim() === '' ? null : raw;
    }

    const current = deal.customFields?.[field.key] ?? null;
    if (current !== (nextValue ?? null)) {
      logAlteracao(
        nextValue === null || nextValue === ''
          ? `${autorAtual} limpou o campo ${field.label}`
          : `${autorAtual} alterou ${field.label} para "${String(nextValue)}"`
      );
      updateDeal(deal.id, { customFields: { ...(deal.customFields || {}), [field.key]: nextValue } });
    }
    return true;
  };

  const commitAndCloseFieldEditor = (field: CustomFieldDefinition, raw: string) => {
    if (commitFieldEdit(field, raw)) setEditingFieldKey(null);
  };

  // Abre o picker nativo (calendário do input date, dropdown do select) quando
  // o navegador suporta showPicker; nos demais o elemento fica focado e abre
  // com o próximo clique/espaço.
  const tryOpenNativePicker = (el: HTMLInputElement | HTMLSelectElement) => {
    try {
      (el as { showPicker?: () => void }).showPicker?.();
    } catch {
      // Some browsers can throw when picker is not allowed in current interaction context.
    }
  };

  // dealActivities memoized above.

  // Handle escape key to close modal (não fecha se um campo inline está em edição)
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.target as Element | null)?.closest?.('[data-esc-local]')) return;
    if (e.key === 'Escape' && !isEditingTitle && !isEditingValue && !editingFieldKey) {
      onClose();
    }
  };

  // RESPONSÁVEL: chip de perfil (clica pra trocar; só admin). Desktop: no topo
  // da conversa, à direita; celular: nos dados do lead.
  const renderOwner = (align: 'left' | 'right') =>
    (canAssignOwner || deal.ownerId) ? (() => {
                  const dealOwner = orgMembers.find(u => u.id === deal.ownerId) ?? null;
                  const initials = (name: string) =>
                    name.split(/\s+/).slice(0, 2).map(p => p[0]?.toUpperCase() ?? '').join('') || '?';
                  return (
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => canAssignOwner && setOwnerMenuOpen(o => !o)}
                        disabled={!canAssignOwner}
                        className={`group flex items-center gap-2 pl-1 pr-2.5 py-1 rounded-full border shadow-sm transition-all duration-200 ${
                          canAssignOwner
                            ? 'cursor-pointer border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 hover:border-primary-400 dark:hover:border-primary-500/60 hover:shadow'
                            : 'cursor-default border-slate-200 dark:border-white/10 bg-white dark:bg-white/5'
                        }`}
                        title={
                          dealOwner
                            ? `Responsável: ${dealOwner.name}`
                            : deal.ownerId
                              ? 'Responsável não encontrado (usuário removido da organização)'
                              : 'Definir responsável'
                        }
                        aria-label="Responsável pelo lead"
                      >
                        <span
                          className={`flex items-center justify-center h-7 w-7 rounded-full shrink-0 ${
                            deal.ownerId
                              ? 'bg-gradient-to-br from-primary-500 to-primary-600 text-white font-bold text-[10px]'
                              : 'border-2 border-dashed border-amber-400/70 dark:border-amber-500/50 text-amber-500'
                          }`}
                        >
                          {dealOwner ? initials(dealOwner.name) : deal.ownerId ? <User size={13} /> : <UserPlus size={13} />}
                        </span>
                        <span className="flex flex-col items-start justify-center gap-0.5 leading-none text-left">
                          <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 leading-none">
                            Responsável
                          </span>
                          {dealOwner || deal.ownerId ? (
                            <span className="text-xs font-semibold text-slate-800 dark:text-white truncate max-w-[110px] leading-none">
                              {dealOwner ? dealOwner.name : 'Usuário removido'}
                            </span>
                          ) : (
                            <span className="text-xs font-semibold text-amber-600 dark:text-amber-400 truncate max-w-[110px] leading-none">
                              Sem responsável
                            </span>
                          )}
                        </span>
                        {canAssignOwner && (
                          <ChevronDown
                            size={13}
                            className={`text-slate-400 group-hover:text-primary-500 transition-transform duration-200 ${ownerMenuOpen ? 'rotate-180' : ''}`}
                          />
                        )}
                      </button>
                      {ownerMenuOpen && (
                        <>
                          <div className="fixed inset-0 z-40" onClick={() => setOwnerMenuOpen(false)} aria-hidden="true" />
                          <div className={`absolute ${align === 'right' ? 'right-0' : 'left-0'} top-11 z-50 w-60 max-h-72 overflow-y-auto scrollbar-custom bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700 p-1.5 animate-in fade-in slide-in-from-top-2 duration-150`}>
                            <p className="px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-400">Responsável</p>
                            <button
                              type="button"
                              onClick={() => {
                                if (deal.ownerId) {
                                  const antigo = orgMembers.find(m => m.id === deal.ownerId)?.name;
                                  logAlteracao(`${autorAtual} removeu ${antigo ? `${antigo} de responsável` : 'o responsável'} do lead`);
                                }
                                updateDeal(deal.id, { ownerId: '' });
                                setOwnerMenuOpen(false);
                              }}
                              className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm text-left hover:bg-slate-100 dark:hover:bg-white/10 ${
                                !deal.ownerId ? 'bg-primary-500/10 text-primary-600 dark:text-primary-300' : 'text-slate-600 dark:text-slate-300'
                              }`}
                            >
                              <span className="h-7 w-7 rounded-full border-2 border-dashed border-slate-300 dark:border-slate-600 text-slate-400 flex items-center justify-center shrink-0">
                                <UserPlus size={13} />
                              </span>
                              <span className="truncate">Sem responsável</span>
                              {!deal.ownerId && <Check size={14} className="ml-auto shrink-0" />}
                            </button>
                            {/* atribuíveis: só vendedores e admins DA organização —
                                super_admins (agência) ficam de fora das opções,
                                mas o nome deles ainda resolve no chip se já forem donos */}
                            {orgMembers
                              .filter(u => u.member)
                              .map(u => (
                                <button
                                  key={u.id}
                                  type="button"
                                  onClick={() => {
                                    if (deal.ownerId !== u.id) logAlteracao(`${autorAtual} definiu ${u.name} como responsável`);
                                    updateDeal(deal.id, { ownerId: u.id });
                                    setOwnerMenuOpen(false);
                                  }}
                                  className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm text-left hover:bg-slate-100 dark:hover:bg-white/10 ${
                                    deal.ownerId === u.id ? 'bg-primary-500/10 text-primary-600 dark:text-primary-300' : 'text-slate-700 dark:text-slate-200'
                                  }`}
                                >
                                  <span className="h-7 w-7 rounded-full bg-gradient-to-br from-primary-500 to-primary-600 text-white text-[10px] font-bold flex items-center justify-center shrink-0">
                                    {initials(u.name)}
                                  </span>
                                  <span className="truncate">
                                    {u.name}
                                    {u.role === 'admin' ? ' (admin)' : ''}
                                  </span>
                                  {deal.ownerId === u.id && <Check size={14} className="ml-auto shrink-0" />}
                                </button>
                              ))}
                          </div>
                        </>
                      )}
                    </div>
                  );
                })() : null;

  const inner = (
    <>
    <div
      className={
        isMobile
          ? 'bg-white dark:bg-dark-card border border-slate-200 dark:border-white/10 w-full h-[100dvh] flex flex-col overflow-hidden pb-[var(--app-safe-area-bottom,0px)] animate-in slide-in-from-bottom-8 fade-in duration-300 ease-out'
          : viewMode === 'fullscreen'
            ? 'bg-white dark:bg-dark-card border border-slate-200 dark:border-white/10 rounded-none w-full max-w-full h-full flex flex-col overflow-hidden animate-in fade-in zoom-in-95 slide-in-from-bottom-2 duration-300 ease-out transition-all'
            : 'bg-white dark:bg-dark-card border border-slate-200 dark:border-white/10 rounded-2xl shadow-2xl w-full max-w-6xl h-[88vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 slide-in-from-bottom-2 duration-300 ease-out transition-all'
      }
    >
      {/* Celular: alterna entre os dados do lead e a conversa */}
      {isMobile && (
        <div role="tablist" aria-label="Seção do lead" className="shrink-0 flex items-center gap-1 border-b border-slate-200 dark:border-white/10 px-2 py-1.5">
          {([['data', 'Dados do lead'], ['chat', 'Conversa']] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={mobilePane === id}
              onClick={() => setMobilePane(id)}
              className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-bold ${mobilePane === id ? 'bg-primary-100 text-primary-700 dark:bg-primary-500/15 dark:text-primary-300' : 'text-slate-500 dark:text-slate-400'}`}
            >
              {label}
            </button>
          ))}
          <button type="button" onClick={onClose} className="shrink-0 p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-white" aria-label="Fechar lead">
            <X size={20} />
          </button>
        </div>
      )}

      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* ESQUERDA: dados e controles do negócio */}
        <aside
          aria-label="Dados do lead"
          className={`${isMobile ? (mobilePane === 'data' ? 'flex w-full' : 'hidden') : 'flex w-[380px] xl:w-[420px] shrink-0 border-r border-slate-200 dark:border-white/10'} flex-col min-h-0 bg-white dark:bg-dark-card`}
        >
          <div className="shrink-0 px-4 pt-4 pb-3 space-y-3 border-b border-slate-100 dark:border-white/5">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                  {isEditingTitle ? (
                    <div className="flex gap-2 mb-1">
                      <input readOnly={!permissions.deals.edit}
                        autoFocus
                        type="text"
                        className="text-xl font-bold text-slate-900 dark:text-white bg-white dark:bg-black/20 border border-slate-300 dark:border-slate-600 rounded px-2 py-1 w-full outline-none focus:ring-2 focus:ring-primary-500"
                        value={editTitle}
                        onChange={e => setEditTitle(e.target.value)}
                        onBlur={saveTitle}
                        onKeyDown={e => e.key === 'Enter' && saveTitle()}
                      />
                      <button onClick={saveTitle} className="text-green-500 hover:text-green-400">
                        <Check size={24} />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2
                        id={headingId}
                        onClick={() => {
                          setEditTitle(deal.title);
                          setIsEditingTitle(true);
                        }}
                        className="w-full text-xl font-bold text-slate-900 dark:text-white font-display leading-tight cursor-pointer hover:text-primary-600 dark:hover:text-primary-400 flex items-center gap-2 group transition-colors"
                        title="Clique para editar"
                      >
                        {deal.title}
                        <Pencil size={16} className="opacity-0 group-hover:opacity-50 max-md:opacity-50 text-slate-400" />
                      </h2>

                      {/* TAGS como MARCADORES junto do nome (cor por tag; × no hover) */}
                      {(deal.tags || []).map((tag) => {
                        const style = tagMarkerStyle(tag);
                        return (
                          <span
                            key={tag}
                            className={`group inline-flex items-center gap-1.5 pl-2 pr-1 py-0.5 rounded-md border text-[11px] font-semibold ${style.chip}`}
                          >
                            <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${style.dot}`} aria-hidden="true" />
                            {tag}
                            <button
                              type="button"
                              onClick={() => removeDealTag(tag)}
                              className="opacity-0 group-hover:opacity-70 max-md:opacity-70 hover:!opacity-100 transition-opacity"
                              aria-label={`Remover tag ${tag}`}
                              title="Remover tag"
                            >
                              <X size={11} />
                            </button>
                          </span>
                        );
                      })}

                      {/* + Tag: popover de SELEÇÃO (criar nova é exceção; oficial em Configurações) */}
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => {
                            setTagMenuOpen(o => !o);
                            setTagCreating(false);
                            setTagQuery('');
                          }}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-dashed border-slate-300 dark:border-slate-600 text-[11px] font-semibold text-slate-400 hover:text-primary-600 hover:border-primary-400 dark:hover:text-primary-400 dark:hover:border-primary-500/60 transition-colors"
                          title="Adicionar tag"
                          aria-label="Adicionar tag"
                        >
                          <TagIcon size={11} /> Tag
                        </button>
                        {tagMenuOpen && (
                          <>
                            <div className="fixed inset-0 z-40" onClick={() => setTagMenuOpen(false)} aria-hidden="true" />
                            <div className="absolute left-0 top-7 z-50 w-60 bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700 p-1.5 animate-in fade-in slide-in-from-top-2 duration-150">
                              {tagCreating ? (
                                <div className="flex gap-1.5 p-1">
                                  <input readOnly={!permissions.deals.edit}
                                    type="text"
                                    autoFocus
                                    value={tagQuery}
                                    onChange={(e) => setTagQuery(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Escape') {
                                        setTagCreating(false);
                                        setTagQuery('');
                                      }
                                      if (e.key === 'Enter' && normalizeTag(tagQuery)) {
                                        e.preventDefault();
                                        addDealTag(tagQuery);
                                        setTagCreating(false);
                                        setTagMenuOpen(false);
                                      }
                                    }}
                                    placeholder="Nome da nova tag..."
                                    className="min-w-0 flex-1 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-primary-500 dark:text-white"
                                    aria-label="Nome da nova tag"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => {
                                      addDealTag(tagQuery);
                                      setTagCreating(false);
                                      setTagMenuOpen(false);
                                    }}
                                    disabled={!normalizeTag(tagQuery)}
                                    className="shrink-0 px-2.5 py-1.5 rounded-lg bg-primary-600 hover:bg-primary-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold transition-colors"
                                  >
                                    Criar
                                  </button>
                                </div>
                              ) : (
                                <>
                                  <div className="max-h-52 overflow-y-auto scrollbar-custom">
                                    {selectableTags.length === 0 && (
                                      <p className="px-2.5 py-2 text-xs text-slate-400 italic">
                                        Todas as tags da organização já estão no lead.
                                      </p>
                                    )}
                                    {selectableTags.map((t) => {
                                      const style = tagMarkerStyle(t);
                                      return (
                                        <button
                                          key={t}
                                          type="button"
                                          onClick={() => {
                                            addDealTag(t);
                                            setTagMenuOpen(false);
                                          }}
                                          className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-left text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10"
                                        >
                                          <span className={`h-2 w-2 rounded-full shrink-0 ${style.dot}`} aria-hidden="true" />
                                          <span className="truncate">{t}</span>
                                        </button>
                                      );
                                    })}
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setTagCreating(true);
                                      setTagQuery('');
                                    }}
                                    className="w-full mt-1 border-t border-slate-100 dark:border-white/10 pt-1.5 px-2.5 pb-1 text-left text-xs font-semibold text-primary-600 dark:text-primary-400 hover:underline"
                                  >
                                    ➕ Criar nova tag…
                                  </button>
                                </>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  )}
              </div>
              <div className="shrink-0 flex items-center gap-1">
                {!isMobile && (
                  <button
                    type="button"
                    onClick={() => setViewMode(v => (v === 'modal' ? 'fullscreen' : 'modal'))}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-primary-600 dark:hover:text-primary-400 hover:bg-slate-100 dark:hover:bg-white/10 transition-colors"
                    title={viewMode === 'modal' ? 'Tela cheia' : 'Modo janela'}
                    aria-label={viewMode === 'modal' ? 'Tela cheia' : 'Modo janela'}
                  >
                    {viewMode === 'modal' ? <Maximize2 size={16} /> : <Minimize2 size={16} />}
                  </button>
                )}
                <button
                  type="button"
                  disabled={!permissions.deals.delete}
                  onClick={() => setDeleteId(deal.id)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  title="Excluir negócio"
                  aria-label="Excluir negócio"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>

            {/* Etapa (compacta) e valor na mesma linha */}
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1 max-w-[260px]">
                {dealBoard && <DealStageControl deal={deal} size="sm" />}
              </div>
                {/* Valor: editar TROCA só a linha do número por um input da MESMA
                    altura (borda embaixo, sem caixa) — nada de empurrar o layout.
                    Enter/clicar fora salva; Esc cancela. */}
                <div className="shrink-0 flex flex-col items-end">
                  {isEditingValue ? (
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-lg font-mono font-bold text-primary-600 dark:text-primary-400">R$</span>
                      <input readOnly={!permissions.deals.edit}
                        autoFocus
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step="0.01"
                        className="text-lg font-mono font-bold leading-normal text-primary-600 dark:text-primary-400 bg-transparent border-0 border-b-2 border-primary-400 focus:border-primary-500 w-32 p-0 outline-none focus:ring-0 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                        value={editValue}
                        onChange={e => setEditValue(e.target.value)}
                        onBlur={saveValue}
                        onKeyDown={e => {
                          if (e.key === 'Enter') saveValue();
                          if (e.key === 'Escape') setIsEditingValue(false);
                        }}
                      />
                    </div>
                  ) : (
                    <p
                      onClick={() => {
                        setEditValue(deal.value.toString());
                        setIsEditingValue(true);
                      }}
                      className="text-lg text-primary-600 dark:text-primary-400 font-mono font-bold cursor-pointer hover:underline decoration-dashed underline-offset-4"
                      title="Clique para editar valor"
                    >
                      R$ {deal.value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </p>
                  )}
                </div>
            </div>
            {isMobile && renderOwner('left')}
            {dealBoard ? null : (
              <p className="rounded-lg border border-slate-200/60 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-300">
                Funil não encontrado para este negócio. Mover de etapa fica indisponível.
              </p>
            )}

            <LossDetailsBanner key={deal.id} deal={deal} canEdit={permissions.deals.edit} />
            {deal.status && <FollowupStatus dealId={deal.id} stageId={deal.status} />}
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden scrollbar-custom px-4 py-4 space-y-4">
                {/* Banner Inativos: quanto tempo falta pro lead sair (devolução automática) */}
                {deal.inactiveAt && (() => {
                  const daysLeft = Math.max(
                    0,
                    30 - Math.floor((Date.now() - new Date(deal.inactiveAt).getTime()) / 86_400_000)
                  );
                  const returnDate = new Date(new Date(deal.inactiveAt).getTime() + 30 * 86_400_000);
                  return (
                    <div className="rounded-xl border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-900/20 p-3">
                      <p className="text-xs font-bold text-amber-800 dark:text-amber-300 uppercase flex items-center gap-1.5 mb-1">
                        <Archive size={13} aria-hidden="true" /> Em Inativos
                      </p>
                      <p className="text-sm text-amber-800 dark:text-amber-200">
                        {daysLeft > 0 ? (
                          <>
                            Devolução automática ao funil em{' '}
                            <span className="font-bold">{daysLeft} dia{daysLeft === 1 ? '' : 's'}</span>{' '}
                            ({returnDate.toLocaleDateString('pt-BR')}).
                          </>
                        ) : (
                          'Devolução automática ao funil hoje.'
                        )}
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          updateDeal(deal.id, { inactiveAt: null });
                          // Reativa o contato junto — senão o lead volta pros Inativos.
                          if (contact?.status === 'INACTIVE') {
                            updateContact(contact.id, { status: 'ACTIVE' });
                          }
                          addToast('Lead devolvido pro funil.', 'success');
                        }}
                        className="mt-2 inline-flex items-center gap-1.5 text-xs font-bold text-amber-800 dark:text-amber-300 hover:underline"
                      >
                        <Undo2 size={12} aria-hidden="true" /> Devolver agora
                      </button>
                    </div>
                  );
                })()}
                {!deal.inactiveAt && contact?.status === 'INACTIVE' && (
                  <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-slate-100 dark:bg-white/5 p-3">
                    <p className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase flex items-center gap-1.5 mb-1">
                      <Archive size={13} aria-hidden="true" /> Em Inativos
                    </p>
                    <p className="text-sm text-slate-600 dark:text-slate-300">
                      O contato está com status <span className="font-bold">INATIVO</span>. Reative o
                      contato para o lead voltar ao funil.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        updateContact(contact.id, { status: 'ACTIVE' });
                        addToast('Contato reativado. Lead devolvido pro funil.', 'success');
                      }}
                      className="mt-2 inline-flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-200 hover:underline"
                    >
                      <Undo2 size={12} aria-hidden="true" /> Reativar contato e devolver
                    </button>
                  </div>
                )}
            {/* Descrição (editável, salva ao sair do campo) */}
            <div>
              <h3 className="mb-2 text-xs font-bold text-slate-400 uppercase">Descrição</h3>
              <textarea
                readOnly={!permissions.deals.edit}
                ref={descriptionTextareaRef}
                aria-label="Descrição do lead"
                className="w-full rounded-lg border border-transparent hover:border-slate-200 focus:border-primary-300 dark:hover:border-white/10 bg-transparent px-2 py-1.5 -mx-2 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 outline-none resize-none overflow-hidden min-h-[64px] focus:ring-2 focus:ring-primary-500/20"
                placeholder="Adicione uma descrição..."
                value={descriptionDraft}
                onChange={e => setDescriptionDraft(e.target.value)}
                onBlur={() => {
                  const next = descriptionDraft;
                  if (next !== (deal.description ?? '')) {
                    logAlteracao(
                      `${autorAtual} atualizou a descrição do lead`,
                      next ? (next.length > 120 ? `${next.slice(0, 120)}…` : next) : 'Descrição removida'
                    );
                    updateDeal(deal.id, { description: next });
                  }
                }}
              />
            </div>

                {/* DYNAMIC CUSTOM FIELDS INPUTS (grupos ocultos pelo board já filtrados) */}
                {(ungroupedFieldDefs.length > 0 || groupedFieldDefs.length > 0) && (
                  <div className="pt-4 border-t border-slate-100 dark:border-white/5">
                    <h3 className="mb-3 text-xs font-bold text-slate-400 uppercase">
                      Campos Personalizados
                    </h3>
                    {(() => {
                      // Clicar no valor abre o editor inline daquele campo (um por vez).
                      // Enter/clicar fora salva; Esc cancela; select/data salvam ao escolher.
                      const renderFieldRow = (field: CustomFieldDefinition) => {
                        const isEditing = editingFieldKey === field.key;
                        return (
                        <div
                          key={field.id}
                          className="py-2.5 last:pb-0"
                        >
                          <div className="min-w-0 text-sm">
                            <span className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1" title={field.label}>
                              {field.label}
                            </span>

                            {isEditing ? (
                              <div className="w-full min-w-0">
                                {field.type === 'select' ? (
                                  <select
                                    ref={el => {
                                      // foca e já ABRE a lista de opções (showPicker onde suportado)
                                      if (el && !el.dataset.focused) {
                                        el.dataset.focused = '1';
                                        el.focus();
                                        tryOpenNativePicker(el);
                                      }
                                    }}
                                    value={editingFieldValue}
                                    onChange={e => commitAndCloseFieldEditor(field, e.target.value)}
                                    onBlur={closeFieldEditor}
                                    onKeyDown={e => { if (e.key === 'Escape') closeFieldEditor(); }}
                                    className="w-full min-w-0 bg-white dark:bg-black/20 border border-primary-400 dark:border-primary-500/60 rounded-lg px-2.5 py-1.5 text-sm dark:text-white ring-2 ring-primary-500/20 outline-none"
                                  >
                                    <option value="">Selecione...</option>
                                    {field.options?.map(opt => (
                                      <option key={opt} value={opt}>
                                        {opt}
                                      </option>
                                    ))}
                                  </select>
                                ) : field.type === 'multiselect' ? (
                                  <div
                                    tabIndex={-1}
                                    ref={el => {
                                      // foca o container UMA vez pra que clicar fora dispare blur
                                      if (el && !el.dataset.focused) {
                                        el.dataset.focused = '1';
                                        el.focus();
                                      }
                                    }}
                                    onBlur={e => {
                                      if (!e.currentTarget.contains(e.relatedTarget as Node)) closeFieldEditor();
                                    }}
                                    onKeyDown={e => { if (e.key === 'Escape') closeFieldEditor(); }}
                                    className="space-y-1 max-h-40 overflow-y-auto rounded-lg border border-primary-400 dark:border-primary-500/60 ring-2 ring-primary-500/20 bg-white dark:bg-black/20 p-1.5 outline-none"
                                  >
                                    {field.options?.map(opt => {
                                      const current: string[] = Array.isArray(deal.customFields?.[field.key])
                                        ? deal.customFields[field.key]
                                        : [];
                                      const isChecked = current.includes(opt);
                                      return (
                                        <label key={opt} className="flex items-center gap-2 cursor-pointer text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/5 px-2 py-1 rounded">
                                          <input readOnly={!permissions.deals.edit}
                                            type="checkbox"
                                            checked={isChecked}
                                            onChange={() => {
                                              const prev = Array.isArray(deal.customFields?.[field.key])
                                                ? [...deal.customFields[field.key]]
                                                : [];
                                              const next = isChecked
                                                ? prev.filter((v: string) => v !== opt)
                                                : [...prev, opt];
                                              updateDeal(deal.id, {
                                                customFields: { ...(deal.customFields || {}), [field.key]: next }
                                              });
                                            }}
                                            className="w-3.5 h-3.5 text-primary-600 rounded border-slate-300 focus:ring-primary-500"
                                          />
                                          {opt}
                                        </label>
                                      );
                                    })}
                                  </div>
                                ) : field.type === 'currency' ? (
                                  <div className="relative">
                                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-slate-400">R$</span>
                                    <input readOnly={!permissions.deals.edit}
                                      autoFocus
                                      type="text"
                                      inputMode="decimal"
                                      value={editingFieldValue}
                                      onChange={e => setEditingFieldValue(e.target.value)}
                                      onFocus={e => e.currentTarget.select()}
                                      onBlur={() => commitAndCloseFieldEditor(field, editingFieldValue)}
                                      onKeyDown={e => {
                                        if (e.key === 'Enter') commitAndCloseFieldEditor(field, editingFieldValue);
                                        if (e.key === 'Escape') closeFieldEditor();
                                      }}
                                      placeholder="0,00"
                                      className="w-full min-w-0 bg-white dark:bg-black/20 border border-primary-400 dark:border-primary-500/60 rounded-lg pl-8 pr-2.5 py-1.5 text-sm dark:text-white ring-2 ring-primary-500/20 outline-none"
                                    />
                                  </div>
                                ) : (
                                  <input readOnly={!permissions.deals.edit}
                                    type={field.type === 'date' ? 'date' : field.type}
                                    ref={el => {
                                      // foco (com seleção do texto) + abre o calendário direto na data
                                      if (el && !el.dataset.focused) {
                                        el.dataset.focused = '1';
                                        el.focus();
                                        if (field.type === 'date') tryOpenNativePicker(el);
                                        else el.select();
                                      }
                                    }}
                                    value={editingFieldValue}
                                    onChange={e => {
                                      if (field.type === 'date') {
                                        // escolher no calendário aplica e fecha na hora
                                        commitAndCloseFieldEditor(field, e.target.value);
                                      } else {
                                        setEditingFieldValue(e.target.value);
                                      }
                                    }}
                                    onBlur={() => commitAndCloseFieldEditor(field, editingFieldValue)}
                                    onKeyDown={e => {
                                      if (e.key === 'Enter') commitAndCloseFieldEditor(field, editingFieldValue);
                                      if (e.key === 'Escape') closeFieldEditor();
                                    }}
                                    className="w-full min-w-0 bg-white dark:bg-black/20 border border-primary-400 dark:border-primary-500/60 rounded-lg px-2.5 py-1.5 text-sm dark:text-white ring-2 ring-primary-500/20 outline-none"
                                  />
                                )}
                              </div>
                            ) : (() => {
                              const value = deal.customFields?.[field.key];
                              const displayValue = getCustomFieldDisplayValue(field.type, value);
                              return (
                                <button
                                  type="button"
                                  onClick={() => openFieldEditor(field)}
                                  title={displayValue ? `${displayValue}` : 'Clique para editar'}
                                  className="group/field w-full min-w-0 flex items-start justify-between gap-2 text-left -mx-2 px-2 py-1 rounded-lg hover:bg-slate-100/80 dark:hover:bg-white/10 transition-colors"
                                >
                                  {displayValue ? (
                                    <span className="min-w-0 line-clamp-3 break-words text-sm text-slate-900 dark:text-white">
                                      {displayValue}
                                    </span>
                                  ) : (
                                    <span className="text-sm italic text-slate-500 dark:text-slate-400">
                                      Campo vazio
                                    </span>
                                  )}
                                  <Pencil size={12} className="shrink-0 mt-1 text-slate-400 opacity-0 group-hover/field:opacity-100 max-md:opacity-100 transition-opacity" />
                                </button>
                              );
                            })()}
                          </div>
                        </div>
                        );
                      };

                      return (
                        <>
                          {/* Campos desagrupados: lista direta, como sempre */}
                          {ungroupedFieldDefs.length > 0 && (
                            <div className="divide-y divide-slate-100 dark:divide-white/5">
                              {ungroupedFieldDefs.map(renderFieldRow)}
                            </div>
                          )}

                          {/* Grupos: sanfona colapsável (abre/fecha igual às UTMs). */}
                          {groupedFieldDefs.map(([groupName, fields]) => {
                            const open = !!openFieldGroups[groupName];
                            return (
                              // cabeçalho CENTRALIZADO entre as divisórias: 16px acima
                              // (pt-4) e 16px abaixo (mt-4 do próximo bloco) — simétrico
                              <div
                                key={groupName}
                                className="mt-4 pt-4 border-t border-slate-100 dark:border-white/5"
                              >
                                <button
                                  type="button"
                                  onClick={() =>
                                    setOpenFieldGroups(prev => ({ ...prev, [groupName]: !prev[groupName] }))
                                  }
                                  aria-expanded={open}
                                  className="w-full flex items-center justify-between text-xs font-bold text-slate-400 uppercase hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
                                >
                                  <span className="flex items-center gap-2 min-w-0">
                                    <FolderOpen size={14} className="shrink-0" />
                                    <span className="truncate">{groupName}</span>
                                    <span className="font-normal normal-case shrink-0">({fields.length})</span>
                                  </span>
                                  <ChevronDown
                                    size={14}
                                    className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
                                  />
                                </button>
                                {open && (
                                  <div className="mt-2 divide-y divide-slate-100 dark:divide-white/5">
                                    {fields.map(renderFieldRow)}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </>
                      );
                    })()}
                  </div>
                )}
                {/* UTMs — padrão em todos os cards, colapsável (fica escondido até abrir) */}
                <div className="pt-4 border-t border-slate-100 dark:border-white/5">
                  <button
                    type="button"
                    onClick={() => setUtmsOpen((o) => !o)}
                    aria-expanded={utmsOpen}
                    className="w-full flex items-center justify-between text-xs font-bold text-slate-400 uppercase hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
                  >
                    <span className="flex items-center gap-2"><TagIcon size={14} /> UTMs</span>
                    <ChevronDown size={14} className={`transition-transform ${utmsOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {utmsOpen && (
                    <div className="mt-2 space-y-2">
                      {([
                        ['utm_source', 'Source'],
                        ['utm_medium', 'Medium'],
                        ['utm_campaign', 'Campaign'],
                        ['utm_content', 'Content'],
                        ['utm_term', 'Term'],
                      ] as const).map(([key, label]) => {
                        const raw = deal.customFields?.[key];
                        const value = raw !== undefined && raw !== null && String(raw).trim() !== '' ? String(raw) : null;
                        return (
                          <div key={key} className="flex justify-between gap-2 text-sm">
                            <span className="text-slate-500 shrink-0">{label}</span>
                            {value ? (
                              <span className="min-w-0 text-right text-slate-900 dark:text-white truncate" title={value}>
                                {value}
                              </span>
                            ) : (
                              <span className="text-slate-400 italic">—</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

            {/* Produtos (seção da coluna de dados) */}
            <div className="pt-4 border-t border-slate-100 dark:border-white/5">
              <button
                type="button"
                onClick={() => setProductsOpen(o => !o)}
                aria-expanded={productsOpen}
                className="w-full flex items-center justify-between text-xs font-bold text-slate-400 uppercase hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
              >
                <span className="flex items-center gap-2">
                  <Package size={14} /> Produtos
                  <span className="font-normal normal-case">({(deal.items || []).length})</span>
                </span>
                <ChevronDown size={14} className={`transition-transform ${productsOpen ? 'rotate-180' : ''}`} />
              </button>
              {productsOpen && (
                <div className="mt-3 space-y-3">
                  {(deal.items || []).length === 0 ? (
                    <p className="text-xs italic text-slate-500">Nenhum produto. O valor do negócio é manual.</p>
                  ) : (
                    <ul className="divide-y divide-slate-100 dark:divide-white/5 rounded-lg border border-slate-200 dark:border-white/10">
                      {(deal.items || []).map(item => (
                        <li key={item.id} className="flex items-center gap-2 px-2.5 py-2 text-sm">
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium text-slate-900 dark:text-white">{item.name}</span>
                            <span className="text-[11px] text-slate-500 dark:text-slate-400">
                              {item.quantity} ×{' '}
                              {editingItemId === item.id ? (
                                <input
                                  readOnly={!permissions.deals.edit}
                                  autoFocus
                                  inputMode="decimal"
                                  aria-label={`Preço de ${item.name} neste lead`}
                                  className="w-24 bg-white dark:bg-black/20 border border-primary-300 dark:border-primary-500/50 rounded px-1.5 py-0.5 text-xs outline-none focus:ring-2 focus:ring-primary-500 dark:text-white"
                                  value={editingItemPrice}
                                  onChange={e => setEditingItemPrice(e.target.value)}
                                  onKeyDown={e => {
                                    if (e.key === 'Enter') salvarPrecoItem(item.id);
                                    if (e.key === 'Escape') { setEditingItemId(null); setEditingItemPrice(''); }
                                  }}
                                  onBlur={() => salvarPrecoItem(item.id)}
                                />
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => { setEditingItemId(item.id); setEditingItemPrice(precoParaCampo(item.price)); }}
                                  title="Alterar o preço só neste lead"
                                  className="hover:text-primary-600 dark:hover:text-primary-400 underline decoration-dotted underline-offset-2"
                                >
                                  {fmtBRL(item.price)}
                                </button>
                              )}
                            </span>
                          </span>
                          <span className="shrink-0 text-sm font-bold text-slate-900 dark:text-white">{fmtBRL(item.price * item.quantity)}</span>
                          <button
                            type="button"
                            onClick={() => removeItemFromDeal(deal.id, item.id)}
                            disabled={!permissions.deals.edit}
                            className="shrink-0 text-slate-400 hover:text-red-500 transition-colors disabled:opacity-40"
                            aria-label={`Remover ${item.name}`}
                          >
                            <Trash2 size={14} />
                          </button>
                        </li>
                      ))}
                      <li className="flex items-center justify-between px-2.5 py-2 bg-slate-50 dark:bg-black/20 text-xs font-bold uppercase tracking-wide text-slate-500">
                        Total
                        <span className="text-sm normal-case text-primary-600 dark:text-primary-400">
                          {fmtBRL((deal.items || []).reduce((sum, i) => sum + i.price * i.quantity, 0))}
                        </span>
                      </li>
                    </ul>
                  )}
                  {permissions.deals.edit && (
                    <div className="space-y-2 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/20 p-2.5">
                      <select
                        aria-label="Produto ou serviço"
                        className="w-full bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary-500 dark:text-white"
                        value={selectedProductId}
                        onChange={e => {
                          const id = e.target.value;
                          setSelectedProductId(id);
                          const p = productsById.get(id);
                          setProductPrice(p ? precoParaCampo(p.price) : '');
                        }}
                      >
                        <option value="">Adicionar produto ou serviço...</option>
                        {products.map(p => (
                          <option key={p.id} value={p.id}>
                            {p.name} - {fmtBRL(p.price)}
                          </option>
                        ))}
                      </select>
                      {selectedProductId && (
                        <div className="flex gap-2">
                          <input
                            type="number"
                            min="1"
                            aria-label="Quantidade"
                            className="w-16 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary-500 dark:text-white"
                            value={productQuantity}
                            onChange={e => setProductQuantity(parseInt(e.target.value))}
                          />
                          <input
                            inputMode="decimal"
                            aria-label="Preço neste lead"
                            placeholder="Preço"
                            title="Preço só neste lead. O cadastro do produto em Configurações não muda."
                            className="min-w-0 flex-1 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary-500 dark:text-white"
                            value={productPrice}
                            onChange={e => setProductPrice(e.target.value)}
                          />
                          <button
                            type="button"
                            onClick={handleAddProduct}
                            className="shrink-0 bg-primary-600 hover:bg-primary-500 text-white px-3 py-1.5 rounded-lg text-xs font-bold"
                          >
                            Adicionar
                          </button>
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => setShowCustomItem(v => !v)}
                        className="text-[11px] font-bold text-primary-600 dark:text-primary-400 hover:underline"
                      >
                        {showCustomItem ? 'Fechar item personalizado' : 'Item personalizado (fora do catálogo)'}
                      </button>
                      {showCustomItem && (
                        <div className="space-y-2">
                          <input
                            value={customItemName}
                            onChange={e => setCustomItemName(e.target.value)}
                            placeholder="Nome do item"
                            aria-label="Nome do item"
                            className="w-full bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary-500 dark:text-white"
                          />
                          <div className="flex gap-2">
                            <input
                              value={customItemPrice}
                              onChange={e => setCustomItemPrice(e.target.value)}
                              inputMode="decimal"
                              aria-label="Preço"
                              className="min-w-0 flex-1 bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary-500 dark:text-white"
                            />
                            <input
                              type="number"
                              min={1}
                              value={customItemQuantity}
                              onChange={e => setCustomItemQuantity(parseInt(e.target.value))}
                              aria-label="Quantidade"
                              className="w-16 bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary-500 dark:text-white"
                            />
                            <button
                              type="button"
                              onClick={handleAddCustomItem}
                              className="shrink-0 bg-primary-600 hover:bg-primary-500 text-white px-3 py-1.5 rounded-lg text-xs font-bold"
                            >
                              Adicionar
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

                <div>
                  <h3 className="text-xs font-bold text-slate-400 uppercase mb-2 flex items-center gap-2">
                    <User size={14} /> Contato Principal
                  </h3>
                  {contact ? (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center text-xs font-bold flex-shrink-0">
                          {(contact.name || '?').charAt(0)}
                        </div>
                        <a
                          href={`/contacts?contactId=${contact.id}`}
                          className="text-sm font-medium text-primary-600 dark:text-primary-400 hover:underline truncate"
                          title="Abrir contato"
                        >
                          {contact.name}
                        </a>
                        <a
                          href={`/contacts?contactId=${contact.id}`}
                          className="text-slate-400 hover:text-primary-500 transition-colors flex-shrink-0"
                          title="Abrir contato"
                        >
                          <ExternalLink size={12} />
                        </a>
                      </div>
                      {contact.phone && (
                        <div className="flex items-center gap-2 ml-9">
                          <Phone size={13} className="text-slate-400 flex-shrink-0" />
                          <span className="text-sm text-slate-600 dark:text-slate-300 truncate">{contact.phone}</span>
                          <button
                            type="button"
                            onClick={() => { navigator.clipboard.writeText(contact.phone); addToast('Telefone copiado!', 'success'); }}
                            className="text-slate-400 hover:text-primary-500 transition-colors flex-shrink-0"
                            title="Copiar telefone"
                          >
                            <Copy size={13} />
                          </button>
                        </div>
                      )}
                      {contact.email && (
                        <div className="flex items-center gap-2 ml-9">
                          <Mail size={13} className="text-slate-400 flex-shrink-0" />
                          <span className="text-sm text-slate-600 dark:text-slate-300 truncate">{contact.email}</span>
                          <button
                            type="button"
                            onClick={() => { navigator.clipboard.writeText(contact.email); addToast('Email copiado!', 'success'); }}
                            className="text-slate-400 hover:text-primary-500 transition-colors flex-shrink-0"
                            title="Copiar email"
                          >
                            <Copy size={11} />
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-slate-500">Sem contato</p>
                  )}
                </div>
                <div>
                  <h3 className="text-xs font-bold text-slate-400 uppercase mb-2 flex items-center gap-2">
                    <Building2 size={14} /> Empresa (Conta)
                  </h3>
                  <p className="text-slate-900 dark:text-white font-medium">{deal.companyName}</p>
                </div>
                {/* Detalhes */}
                <div className="pt-4 border-t border-slate-100 dark:border-white/5">
                  <h3 className="text-xs font-bold text-slate-400 uppercase mb-2">Detalhes</h3>
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-500">Prioridade</span>
                      <span className="text-slate-900 dark:text-white">
                        {formatPriorityPtBr(deal.priority)}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-500">Criado em</span>
                      <span className="text-slate-900 dark:text-white">
                        {PT_BR_DATETIME_FORMATTER.format(new Date(deal.createdAt))}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-500">Probabilidade</span>
                      <span className="text-slate-900 dark:text-white">{deal.probability}%</span>
                    </div>
                  </div>
                </div>
          </div>
        </aside>

        {/* DIREITA: conversa + histórico unificado + compositor */}
        <section
          aria-label="Conversa e histórico do lead"
          className={`${isMobile ? (mobilePane === 'chat' ? 'flex' : 'hidden') : 'flex'} relative flex-1 min-w-0 min-h-0 flex-col bg-white dark:bg-dark-card`}
        >
          <DealWhatsAppChat
            contact={contact}
            templateContext={{
              'contato.email': contact?.email || '',
              'lead.titulo': deal.title,
              'lead.valor': Number(deal.value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
              'lead.etapa': dealBoard?.stages.find(s => s.id === deal.status)?.label || '',
              'responsavel.nome': orgMembers.find(u => u.id === deal.ownerId)?.name || '',
              'escritorio.nome': profile?.organization_name || '',
            }}
            timeline={{
              entries: timelineEntries,
              canWriteCrm: permissions.deals.edit,
              scrollToEndKey: ownSaveKey,
              composerMode,
              onComposerModeChange: setComposerMode,
              headerExtra: (
                <>
                {!isMobile && renderOwner('right')}
                <button
                  type="button"
                  onClick={() => setAiOpen(o => !o)}
                  aria-expanded={aiOpen}
                  className={`h-8 px-2 inline-flex items-center gap-1.5 rounded-lg text-xs font-bold transition-colors ${
                    aiOpen
                      ? 'bg-primary-100 text-primary-700 dark:bg-primary-500/20 dark:text-primary-300'
                      : 'text-slate-500 dark:text-slate-400 hover:text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-900/20'
                  }`}
                  title="Análise do negócio, rascunho de e-mail e respostas a objeções"
                >
                  <BrainCircuit size={14} /> <span className="max-lg:sr-only">IA Insights</span>
                </button>
                </>
              ),
              headerEnd: (
                <>
                {!isMobile && (
                  <button
                    type="button"
                    onClick={onClose}
                    className="h-8 w-8 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 transition-colors"
                    title="Fechar"
                    aria-label="Fechar lead"
                  >
                    <X size={18} />
                  </button>
                )}
                </>
              ),
              aboveComposer: (
                <PendingActivitiesStrip
                  activities={dealActivities}
                  onOpen={openActivityInComposer}
                  onComplete={a => void toggleActivityCompletion(a.id)}
                  canEdit={permissions.deals.edit}
                  isPending={isActivityPending}
                />
              ),
              noteComposer: (
                <NoteComposer value={noteDraft} onChange={setNoteDraft} onSave={saveNote} disabled={!permissions.deals.edit} />
              ),
              activityComposer: (
                <ActivityComposer
                  draft={activityDraft}
                  onChange={setActivityDraft}
                  onSubmit={submitActivity}
                  onCancelEdit={() => setActivityDraft(EMPTY_ACTIVITY_DRAFT)}
                  onComplete={async id => {
                    const a = dealActivities.find(x => x.id === id);
                    if (a && !a.completed) await toggleActivityCompletion(id);
                    setActivityDraft(EMPTY_ACTIVITY_DRAFT);
                    addToast('Atividade concluída', 'success');
                  }}
                  disabled={!permissions.deals.edit}
                />
              ),
            }}
          />
          {historyQuery.isError && (
            <p role="alert" className="absolute top-12 left-1/2 -translate-x-1/2 z-10 rounded-lg bg-red-50 dark:bg-red-900/30 px-3 py-1.5 text-xs text-red-600 dark:text-red-300 shadow">
              Não foi possível carregar o histórico de alterações.{' '}
              <button type="button" className="font-bold underline" onClick={() => void historyQuery.refetch()}>
                Tentar de novo
              </button>
            </p>
          )}

          {/* IA Insights: painel sobre a conversa (não perde a posição do chat) */}
          {aiOpen && (
            <div data-esc-local="" onKeyDown={e => { if (e.key === 'Escape') setAiOpen(false); }} className="absolute inset-y-0 right-0 z-20 w-full sm:w-[440px] max-w-full border-l border-slate-200 dark:border-white/10 bg-white dark:bg-dark-card shadow-2xl flex flex-col animate-in slide-in-from-right-4 fade-in duration-200">
              <div className="shrink-0 flex items-center justify-between px-4 py-2.5 border-b border-slate-200 dark:border-white/10">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <BrainCircuit size={16} className="text-primary-500" /> IA Insights
                </h3>
                <button type="button" onClick={() => setAiOpen(false)} className="p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white" aria-label="Fechar IA Insights">
                  <X size={16} />
                </button>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto scrollbar-custom p-4 space-y-6">
                    <div className="bg-linear-to-br from-primary-50 to-white dark:from-primary-900/10 dark:to-dark-card p-6 rounded-xl border border-primary-100 dark:border-primary-500/20">
                      <div className="flex items-center gap-3 mb-4">
                        <div className="p-2 bg-primary-100 dark:bg-primary-500/20 rounded-lg text-primary-600 dark:text-primary-400">
                          <BrainCircuit size={20} />
                        </div>
                        <div>
                          <h3 className="font-bold text-slate-900 dark:text-white font-display text-lg">
                            Insights Gemini
                          </h3>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            Inteligência Artificial aplicada ao negócio
                          </p>
                        </div>
                      </div>

                      {/* STRATEGY CONTEXT BAR */}
                      {dealBoard?.agentPersona && (
                        <div className="mb-6 bg-slate-900/5 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg p-3 flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-linear-to-br from-purple-500 to-indigo-600 flex items-center justify-center text-white shadow-lg">
                            <Bot size={20} />
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-bold uppercase tracking-widest text-purple-600 dark:text-purple-400 bg-purple-100 dark:bg-purple-900/30 px-1.5 py-0.5 rounded">
                                Atuando como
                              </span>
                            </div>
                            <p className="text-sm font-bold text-slate-900 dark:text-white mt-0.5">
                              {dealBoard.agentPersona?.name}
                            </p>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                              {dealBoard.agentPersona?.role} • Foco: {dealBoard.goal?.kpi || 'Geral'}
                            </p>
                          </div>
                        </div>
                      )}
                      <div className="flex gap-3 mb-5">
                        <button
                          onClick={handleAnalyzeDeal}
                          disabled={isAnalyzing}
                          className="flex-1 py-2.5 bg-white dark:bg-white/5 text-slate-700 dark:text-white text-sm font-medium rounded-lg shadow-sm border border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/10 transition-all flex items-center justify-center gap-2"
                        >
                          {isAnalyzing ? (
                            <div className="animate-spin w-4 h-4 border-2 border-current border-t-transparent rounded-full" />
                          ) : (
                            <BrainCircuit size={16} />
                          )}
                          Analisar Negócio
                        </button>
                        <button
                          onClick={handleDraftEmail}
                          disabled={isDrafting}
                          className="flex-1 py-2.5 bg-white dark:bg-white/5 text-slate-700 dark:text-white text-sm font-medium rounded-lg shadow-sm border border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/10 transition-all flex items-center justify-center gap-2"
                        >
                          {isDrafting ? (
                            <div className="animate-spin w-4 h-4 border-2 border-current border-t-transparent rounded-full" />
                          ) : (
                            <Mail size={16} />
                          )}
                          Escrever Email
                        </button>
                      </div>
                      {aiResult && (
                        <div className="bg-white/80 dark:bg-black/40 backdrop-blur-md p-4 rounded-lg border border-primary-100 dark:border-primary-500/20 mb-4">
                          <div className="flex justify-between mb-2 border-b border-primary-100 dark:border-white/5 pb-2">
                            <span className="text-xs font-bold text-primary-700 dark:text-primary-300 uppercase tracking-wider">
                              Sugestão
                            </span>
                            <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-500/10 px-2 rounded">
                              {aiResult.score}% Chance
                            </span>
                          </div>
                          <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed">
                            {aiResult.suggestion}
                          </p>
                        </div>
                      )}
                      {emailDraft && (
                        <div className="bg-white/80 dark:bg-black/40 backdrop-blur-md p-4 rounded-lg border border-primary-100 dark:border-primary-500/20">
                          <h4 className="text-xs font-bold text-primary-700 dark:text-primary-300 uppercase tracking-wider mb-2">
                            Rascunho de Email
                          </h4>
                          <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed italic">
                            "{emailDraft}"
                          </p>
                        </div>
                      )}
                    </div>

                    <div className="bg-rose-50 dark:bg-rose-900/10 p-6 rounded-xl border border-rose-100 dark:border-rose-500/20">
                      <div className="flex items-center gap-3 mb-4">
                        <div className="p-2 bg-rose-100 dark:bg-rose-500/20 rounded-lg text-rose-600 dark:text-rose-400">
                          <Sword size={20} />
                        </div>
                        <div>
                          <h3 className="font-bold text-slate-900 dark:text-white font-display text-lg">
                            Objection Killer
                          </h3>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            O cliente está difícil? A IA te ajuda a negociar.
                          </p>
                        </div>
                      </div>

                      <div className="flex gap-2 mb-4">
                        <input readOnly={!permissions.deals.edit}
                          type="text"
                          className="flex-1 bg-white dark:bg-white/5 border border-rose-200 dark:border-rose-500/20 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-rose-500 dark:text-white"
                          placeholder="Ex: 'Achamos o preço muito alto' ou 'Preciso falar com meu sócio'"
                          value={objection}
                          onChange={e => setObjection(e.target.value)}
                        />
                        <button
                          onClick={handleObjection}
                          disabled={isGeneratingObjections || !objection.trim()}
                          className="bg-rose-600 hover:bg-rose-500 text-white px-4 py-2 rounded-lg text-sm font-bold transition-colors disabled:opacity-50"
                        >
                          {isGeneratingObjections ? (
                            <div className="animate-spin w-4 h-4 border-2 border-current border-t-transparent rounded-full" />
                          ) : (
                            'Gerar Respostas'
                          )}
                        </button>
                      </div>

                      {objectionResponses.length > 0 && (
                        <div className="space-y-3">
                          {objectionResponses.map((resp, idx) => (
                            <div
                              key={idx}
                              className="bg-white dark:bg-white/5 p-3 rounded-lg border border-rose-100 dark:border-rose-500/10 flex gap-3"
                            >
                              <div className="shrink-0 w-6 h-6 bg-rose-100 dark:bg-rose-500/20 rounded-full flex items-center justify-center text-rose-600 dark:text-rose-400 font-bold text-xs">
                                {idx + 1}
                              </div>
                              <p className="text-sm text-slate-700 dark:text-slate-200">{resp}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>

        <ConfirmModal
          isOpen={Boolean(deleteId)}
          onClose={() => setDeleteId(null)}
          onConfirm={confirmDeleteDeal}
          title="Excluir Negócio"
          message="Tem certeza que deseja excluir este negócio? Esta ação não pode ser desfeita."
          confirmText="Excluir"
          variant="danger"
        />

        <ConfirmModal
          isOpen={Boolean(deleteNoteId)}
          onClose={() => setDeleteNoteId(null)}
          onConfirm={() => {
            if (deleteNoteId) void deleteActivity(deleteNoteId);
            setDeleteNoteId(null);
          }}
          title="Excluir nota"
          message="Excluir esta nota interna? A exclusão fica registrada no histórico do lead."
          confirmText="Excluir"
          variant="danger"
        />
    </>
  );

  if (isMobile) {
    return (
      <DealSheet isOpen={isOpen} onClose={onClose} ariaLabel={`Negócio: ${deal.title}`}>
        <div onKeyDown={handleKeyDown}>{inner}</div>
      </DealSheet>
    );
  }

  return (
    // allowOutsideClick: menu lateral (Inbox, Visão Geral, recolher…) continua
    // clicável com o card aberto; o foco por teclado segue preso no modal.
    // initialFocus no contêiner: sem isso o 1º botão (hub do responsável)
    // abria já com anel de foco, parecendo selecionado por padrão.
    <FocusTrap
      active={isOpen}
      onEscape={onClose}
      allowOutsideClick
      initialFocus="[data-focus-trap-fallback]"
    >
      <div
        // Backdrop + positioning wrapper. Clicking outside the panel should close the modal.
        // No desktop, este modal não deve cobrir a sidebar de navegação.
        // Em md+ deslocamos o overlay pela largura da sidebar via `--app-sidebar-width`.
        className={`fixed inset-0 md:left-[var(--app-sidebar-width,0px)] z-[9999] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm animate-in fade-in transition-[left,padding] duration-300 ease-in-out ${viewMode === 'fullscreen' ? 'p-0' : 'p-4'}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        onKeyDown={handleKeyDown}
        onClick={(e) => {
          // Only close when clicking the backdrop, not when clicking inside the panel.
          if (e.target === e.currentTarget) onClose();
        }}
      >
        {inner}
      </div>
    </FocusTrap>
  );
};
