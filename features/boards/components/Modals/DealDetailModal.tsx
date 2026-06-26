import React, { useState, useRef, useEffect, useId, useMemo, useCallback } from 'react';
import { useCRM } from '@/context/CRMContext';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import ConfirmModal from '@/components/ConfirmModal';
import { LossReasonModal } from '@/components/ui/LossReasonModal';
import { useMoveDealSimple, useDeal, useOrgUsers } from '@/lib/query/hooks';
import { FocusTrap, useFocusReturn } from '@/lib/a11y';
import { Activity } from '@/types';

import { useResponsiveMode } from '@/hooks/useResponsiveMode';
import { DealSheet } from '../DealSheet';
import { DealWhatsAppChat } from '@/features/whatsapp/DealWhatsAppChat';
import {
  analyzeLead,
  generateEmailDraft,
  generateObjectionResponse,
} from '@/lib/ai/tasksClient';
import {
  BrainCircuit,
  Mail,
  Phone,
  Calendar,
  Check,
  X,
  Trash2,
  Pencil,
  ThumbsUp,
  ThumbsDown,
  Building2,
  User,
  Package,
  Sword,
  CheckCircle2,
  Bot,
  Tag as TagIcon,
  Plus,
  Maximize2,
  Minimize2,
  Copy,
  ExternalLink,
  MessageCircle,
} from 'lucide-react';
import { StageProgressBar } from '../StageProgressBar';
import { ActivityRow } from '@/features/activities/components/ActivityRow';
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
const PT_BR_DATE_FORMATTER = new Intl.DateTimeFormat('pt-BR');

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
    updateDeal,
    deleteDeal,
    activities,
    addActivity,
    updateActivity,
    deleteActivity,
    toggleActivityCompletion,
    isActivityPending,
    products,
    addItemToDeal,
    removeItemFromDeal,
    customFieldDefinitions,
    activeBoard,
    boards,
    lifecycleStages,
    availableTags,
    addTag,
  } = useCRM();
  const { profile } = useAuth();
  const { addToast } = useToast();
  const { users: orgUsers, isAdmin: canAssignOwner } = useOrgUsers();

  // Performance: avoid repeated `find(...)` on large arrays.
  const dealsById = useMemo(() => new Map(deals.map((d) => [d.id, d])), [deals]);
  const contactsById = useMemo(() => new Map(contacts.map((c) => [c.id, c])), [contacts]);
  const boardsById = useMemo(() => new Map(boards.map((b) => [b.id, b])), [boards]);
  const lifecycleStageById = useMemo(() => new Map(lifecycleStages.map((s) => [s.id, s])), [lifecycleStages]);
  const productsById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const dealFromCache = dealId ? dealsById.get(dealId) : undefined;
  // Fallback fetch: when a deal id lands in the modal (deep link, brand-new
  // card from Realtime, or optimistic temp→real swap race) but the DealView
  // cache hasn't caught up yet, fetch it directly so the modal still opens
  // instead of silently returning null. The query is disabled when the cache
  // already has the deal to avoid redundant requests.
  const shouldFetch = !!dealId && !!isOpen && !dealFromCache;
  const { data: fetchedDeal } = useDeal(shouldFetch ? dealId : undefined);
  const deal = dealFromCache ?? (fetchedDeal as unknown as typeof dealFromCache | undefined);
  const contact = deal ? (contactsById.get(deal.contactId) ?? null) : null;

  // Determine the correct board for this deal
  const dealBoard = deal ? (boardsById.get(deal.boardId) ?? activeBoard) : activeBoard;

  // Use unified TanStack Query hook for moving deals
  const { moveDeal } = useMoveDealSimple(dealBoard, lifecycleStages);

  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [isEditingValue, setIsEditingValue] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editValue, setEditValue] = useState('');

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isDrafting, setIsDrafting] = useState(false);
  const [aiResult, setAiResult] = useState<{ suggestion: string; score: number } | null>(null);
  const [emailDraft, setEmailDraft] = useState<string | null>(null);
  const [newNote, setNewNote] = useState('');
  const [showNewNote, setShowNewNote] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState('');
  const descriptionTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [idCopied, setIdCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<'whatsapp' | 'timeline' | 'activities' | 'notes' | 'products' | 'info'>('whatsapp');
  const noteTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Quick activity creation / edition from deal card (same form).
  const [showQuickActivity, setShowQuickActivity] = useState(false);
  const [editingActivityId, setEditingActivityId] = useState<string | null>(null);
  const [quickActivityType, setQuickActivityType] = useState<'CALL' | 'MEETING' | 'EMAIL' | 'TASK'>('CALL');
  const [quickActivityTitle, setQuickActivityTitle] = useState('');
  const [quickActivityDate, setQuickActivityDate] = useState('');
  const [quickActivityTime, setQuickActivityTime] = useState('');
  const [quickActivityDesc, setQuickActivityDesc] = useState('');

  const resetQuickActivityForm = useCallback(() => {
    setShowQuickActivity(false);
    setEditingActivityId(null);
    setQuickActivityType('CALL');
    setQuickActivityTitle('');
    setQuickActivityDate('');
    setQuickActivityTime('');
    setQuickActivityDesc('');
  }, []);

  // Stable reference so the memoized ActivityRow children don't re-render
  // on every parent state change just because the callback was inline.
  const startEditActivity = useCallback((a: Activity) => {
    const d = new Date(a.date);
    setEditingActivityId(a.id);
    setQuickActivityType((a.type === 'TASK' ? 'TASK' : a.type) as typeof quickActivityType);
    setQuickActivityTitle(a.title);
    setQuickActivityDate(d.toISOString().split('T')[0]);
    setQuickActivityTime(d.toTimeString().slice(0, 5));
    setQuickActivityDesc(a.description || '');
    setShowQuickActivity(true);
    setActiveTab('activities');
  }, []);

  const [objection, setObjection] = useState('');
  const [objectionResponses, setObjectionResponses] = useState<string[]>([]);
  const [isGeneratingObjections, setIsGeneratingObjections] = useState(false);

  const [selectedProductId, setSelectedProductId] = useState('');
  const [productQuantity, setProductQuantity] = useState(1);
  const [showCustomItem, setShowCustomItem] = useState(false);
  const [customItemName, setCustomItemName] = useState('');
  const [customItemPrice, setCustomItemPrice] = useState<string>('0');
  const [customItemQuantity, setCustomItemQuantity] = useState(1);

  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [showLossReasonModal, setShowLossReasonModal] = useState(false);
  const [pendingLostStageId, setPendingLostStageId] = useState<string | null>(null);
  const [lossReasonOrigin, setLossReasonOrigin] = useState<'button' | 'stage'>('button');
  const [isCustomFieldsEditMode, setIsCustomFieldsEditMode] = useState(false);
  const [customFieldsDraft, setCustomFieldsDraft] = useState<Record<string, string>>({});

  const [tagQuery, setTagQuery] = useState('');
  const [viewMode, setViewMode] = useState<'modal' | 'fullscreen'>('modal');

  const normalizeTag = (value: string) => value.trim().replace(/\s+/g, ' ');
  const tagsLower = useMemo(() => new Set((deal?.tags || []).map(t => t.toLowerCase())), [deal?.tags]);
  const availableTagsLower = useMemo(() => new Set((availableTags || []).map(t => t.toLowerCase())), [availableTags]);

  // Helper functions removed as they are now handled by ActivityRow component

  // Reset state when deal changes or modal opens
  useEffect(() => {
    if (isOpen && deal) {
      setEditTitle(deal.title);
      setEditValue(deal.value.toString());
      setAiResult(null);
      setEmailDraft(null);
      setObjectionResponses([]);
      setObjection('');
      setActiveTab('whatsapp');
      setIsEditingTitle(false);
      setIsEditingValue(false);
      setShowLossReasonModal(false);
      setPendingLostStageId(null);
      setLossReasonOrigin('button');
      setIsCustomFieldsEditMode(false);
      setTagQuery('');
      setCustomFieldsDraft({});
      setShowNewNote(false);
      setNewNote('');
      setDescriptionDraft(deal.description ?? '');
      resetQuickActivityForm();
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
  }, [descriptionDraft, isOpen, activeTab]);

  // Apply schedule hint (coming from the Kanban status icon) after the
  // base reset effect above, so the user lands directly on the activities
  // tab with the form open and the type pre-selected. The parent clears
  // the hint via `onScheduleHintConsumed` so it only fires once per intent.
  useEffect(() => {
    if (!isOpen || !deal || !scheduleHint) return;
    setActiveTab('activities');
    setEditingActivityId(null);
    setQuickActivityType(scheduleHint.type);
    setQuickActivityTitle(QUICK_ACTIVITY_TITLE_BY_TYPE[scheduleHint.type]);
    setQuickActivityDate('');
    setQuickActivityTime('');
    setQuickActivityDesc('');
    setShowQuickActivity(true);
    onScheduleHintConsumed?.();
  }, [isOpen, dealId, scheduleHint]); // eslint-disable-line react-hooks/exhaustive-deps

  // UX: preselect board's default product when opening the Products tab (non-invasive).
  useEffect(() => {
    if (!isOpen) return;
    if (activeTab !== 'products') return;
    const defaultId = dealBoard?.defaultProductId;
    if (!defaultId) return;
    if (selectedProductId) return;
    // Only suggest if product exists & is active.
    const p = productsById.get(defaultId);
    if (!p || p.active === false) return;
    setSelectedProductId(defaultId);
    setProductQuantity(1);
  }, [activeTab, dealBoard?.defaultProductId, isOpen, productsById, selectedProductId]);

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

  // Notes-only view for the Notas tab
  const dealNotes = useMemo(() => {
    return dealActivities.filter((a) => a.type === 'NOTE');
  }, [dealActivities]);

  // Activities-only (tasks, calls, meetings, emails — no notes/status changes)
  const dealTaskActivities = useMemo(() => {
    return dealActivities.filter((a) => a.type !== 'NOTE' && a.type !== 'STATUS_CHANGE');
  }, [dealActivities]);

  if (!isOpen) return null;

  // isOpen but the deal hasn't hydrated yet (cache race or deep-link to a
  // deal not yet in the current list). Show a minimal loading shell instead
  // of silently returning null — prevents the "URL changed but nothing
  // opens, needs F5" UX regression. `useDeal(shouldFetch)` above populates
  // `deal` as soon as the server responds or Realtime fills the cache.
  if (!deal) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
        role="dialog"
        aria-modal="true"
        aria-busy="true"
        onClick={onClose}
      >
        <div
          className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl p-8 flex flex-col items-center gap-3"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="h-8 w-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-slate-500 dark:text-slate-400">Carregando lead…</p>
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
    updateDeal(deal.id, { tags: nextTags });
  };

  const tagSuggestions = (() => {
    const q = normalizeTag(tagQuery);
    if (!q) return [];
    const qLower = q.toLowerCase();
    return (availableTags || [])
      .filter(t => !tagsLower.has(t.toLowerCase()))
      .filter(t => t.toLowerCase().includes(qLower))
      .slice(0, 8);
  })();

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

  const handleAddNote = () => {
    if (!newNote.trim()) return;

    const noteActivity: Activity = {
      id: crypto.randomUUID(),
      dealId: deal.id,
      dealTitle: deal.title,
      type: 'NOTE',
      title: 'Nota Adicionada',
      description: newNote,
      date: new Date().toISOString(),
      user: { name: 'Eu', avatar: 'https://i.pravatar.cc/150?u=me' },
      completed: true,
    };

    addActivity(noteActivity);
    setNewNote('');
  };

  const handleAddQuickActivity = () => {
    if (!quickActivityTitle.trim() || !quickActivityDate || !quickActivityTime) return;

    const dateTime = new Date(`${quickActivityDate}T${quickActivityTime}`).toISOString();

    if (editingActivityId) {
      updateActivity(editingActivityId, {
        type: quickActivityType,
        title: quickActivityTitle,
        description: quickActivityDesc || undefined,
        date: dateTime,
      });
      addToast('Atividade atualizada', 'success');
      resetQuickActivityForm();
      return;
    }

    const newActivity: Activity = {
      id: crypto.randomUUID(),
      dealId: deal.id,
      dealTitle: deal.title,
      type: quickActivityType,
      title: quickActivityTitle,
      description: quickActivityDesc || undefined,
      date: dateTime,
      user: { name: 'Eu', avatar: 'https://i.pravatar.cc/150?u=me' },
      // Activities always start pending. Only the user can mark as completed.
      completed: false,
    };

    addActivity(newActivity);
    addToast('Atividade agendada', 'success');
    resetQuickActivityForm();
  };

  const handleAddProduct = () => {
    if (!selectedProductId) return;
    // Performance: O(1) lookup instead of scanning all products.
    const product = productsById.get(selectedProductId);
    if (!product) return;

    addItemToDeal(deal.id, {
      productId: product.id,
      name: product.name,
      price: product.price,
      quantity: productQuantity,
    });

    setSelectedProductId('');
    setProductQuantity(1);
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
    if (deleteId) {
      deleteDeal(deleteId);
      addToast('Negócio excluído com sucesso', 'success');
      setDeleteId(null);
      onClose();
    }
  };

  const saveTitle = () => {
    if (editTitle) {
      updateDeal(deal.id, { title: editTitle });
      setIsEditingTitle(false);
    }
  };

  const saveValue = () => {
    if (editValue) {
      updateDeal(deal.id, { value: Number(editValue) });
      setIsEditingValue(false);
    }
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

  const startCustomFieldsEditMode = () => {
    const nextDraft: Record<string, string> = {};
    for (const field of customFieldDefinitions) {
      const current = deal.customFields?.[field.key];
      // multiselect is handled directly via deal.customFields (array), skip draft
      if (field.type === 'multiselect') continue;
      nextDraft[field.key] = current == null ? '' : String(current);
    }
    setCustomFieldsDraft(nextDraft);
    setIsCustomFieldsEditMode(true);
  };

  const saveCustomFieldsDraft = () => {
    const nextCustomFields: Record<string, unknown> = { ...(deal.customFields || {}) };

    for (const field of customFieldDefinitions) {
      const raw = (customFieldsDraft[field.key] ?? '').toString();

      if (field.type === 'number' || field.type === 'currency') {
        const normalized = raw.trim().replace(',', '.');
        if (normalized === '') {
          nextCustomFields[field.key] = null;
          continue;
        }

        const parsed = Number(normalized);
        if (!Number.isFinite(parsed)) {
          addToast(`Valor numérico inválido em "${field.label}".`, 'warning');
          return;
        }

        nextCustomFields[field.key] = parsed;
        continue;
      }

      if (field.type === 'multiselect') {
        // Stored as array from checkboxes, read from draft as comma-separated or from deal
        const current = deal.customFields?.[field.key];
        nextCustomFields[field.key] = Array.isArray(current) ? current : [];
        continue;
      }

      if (field.type === 'date' || field.type === 'select') {
        nextCustomFields[field.key] = raw.trim() === '' ? null : raw.trim();
        continue;
      }

      nextCustomFields[field.key] = raw.trim() === '' ? null : raw;
    }

    updateDeal(deal.id, { customFields: nextCustomFields });
    setIsCustomFieldsEditMode(false);
    setCustomFieldsDraft({});
  };

  const tryOpenDatePicker = (input: HTMLInputElement) => {
    try {
      (input as HTMLInputElement & { showPicker?: () => void }).showPicker?.();
    } catch {
      // Some browsers can throw when picker is not allowed in current interaction context.
    }
  };

  // dealActivities memoized above.

  // Handle escape key to close modal
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && !isEditingTitle && !isEditingValue) {
      onClose();
    }
  };

  const inner = (
    <>
    <div
      className={
        isMobile
          ? 'bg-white dark:bg-dark-card border border-slate-200 dark:border-white/10 w-full h-[100dvh] flex flex-col overflow-hidden pb-[var(--app-safe-area-bottom,0px)]'
          : viewMode === 'fullscreen'
            ? 'bg-white dark:bg-dark-card border border-slate-200 dark:border-white/10 rounded-none w-full h-full flex flex-col overflow-hidden animate-in zoom-in-95 duration-200'
            : 'bg-white dark:bg-dark-card border border-slate-200 dark:border-white/10 rounded-2xl shadow-2xl w-full max-w-4xl h-[85vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200'
      }
    >
          {/* HEADER (Stage Bar + Won/Lost) */}
          <div className="bg-slate-50 dark:bg-black/20 border-b border-slate-200 dark:border-white/10 p-6 shrink-0">
            <div className="flex justify-between items-start mb-6">
              <div className="flex-1 mr-8">
                {isEditingTitle ? (
                  <div className="flex gap-2 mb-1">
                    <input
                      autoFocus
                      type="text"
                      className="text-2xl font-bold text-slate-900 dark:text-white bg-white dark:bg-black/20 border border-slate-300 dark:border-slate-600 rounded px-2 py-1 w-full outline-none focus:ring-2 focus:ring-primary-500"
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
                      className="text-2xl font-bold text-slate-900 dark:text-white font-display leading-tight cursor-pointer hover:text-primary-600 dark:hover:text-primary-400 flex items-center gap-2 group transition-colors"
                      title="Clique para editar"
                    >
                      {deal.title}
                      <Pencil size={16} className="opacity-0 group-hover:opacity-50 text-slate-400" />
                    </h2>
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(deal.id);
                          setIdCopied(true);
                          setTimeout(() => setIdCopied(false), 1500);
                        } catch {}
                      }}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-[11px] font-mono text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-white/10 transition-colors"
                      title={`Copiar ID: ${deal.id}`}
                      aria-label="Copiar ID do lead"
                    >
                      <Copy size={12} />
                      {idCopied ? 'Copiado!' : `ID: ${deal.id.slice(0, 8)}…`}
                    </button>
                  </div>
                )}

                {isEditingValue ? (
                  <div className="flex gap-2 items-center">
                    <span className="text-lg font-mono font-bold text-slate-500">$</span>
                    <input
                      autoFocus
                      type="number"
                      className="text-lg font-mono font-bold text-primary-600 dark:text-primary-400 bg-white dark:bg-black/20 border border-slate-300 dark:border-slate-600 rounded px-2 py-1 w-32 outline-none focus:ring-2 focus:ring-primary-500"
                      value={editValue}
                      onChange={e => setEditValue(e.target.value)}
                      onBlur={saveValue}
                      onKeyDown={e => e.key === 'Enter' && saveValue()}
                    />
                    <button onClick={saveValue} className="text-green-500 hover:text-green-400">
                      <Check size={20} />
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col">
                    {deal.items && deal.items.length > 0 && (
                      <span className="text-xs text-slate-500 dark:text-slate-400 mb-0.5">
                        {deal.items.map(i => i.name).join(', ')}
                      </span>
                    )}
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
                  </div>
                )}
              </div>
              <div className="flex gap-3 items-center">
                {/* Se fechado: mostra badge + botão Reabrir */}
                {(deal.isWon || deal.isLost) ? (
                  <>
                    <span className={`text-xs font-bold px-3 py-1.5 rounded-lg ${deal.isWon ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'}`}>
                      {deal.isWon ? '✓ GANHO' : '✗ PERDIDO'}
                    </span>
                    <button
                      onClick={() => {
                        // Find first non-won/lost stage to reopen to
                        const firstRegularStage = dealBoard?.stages.find(
                          s => s.linkedLifecycleStage !== 'CUSTOMER' && s.linkedLifecycleStage !== 'OTHER'
                        );
                        if (firstRegularStage) {
                          moveDeal(deal, firstRegularStage.id);
                        } else {
                          // Fallback: just clear the won/lost flags
                          updateDeal(deal.id, { isWon: false, isLost: false, closedAt: undefined });
                        }
                      }}
                      className="px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg font-bold text-sm flex items-center gap-2 transition-all"
                    >
                      ↩ Reabrir
                    </button>
                  </>
                ) : (
                  /* Se aberto: mostra botões Ganho e Perdido */
                  <>
                    <button
                      onClick={() => {
                        // Intelligent "Won" Logic:
                        // 0. Check for "Stay in Stage" flag (Archive/Close in place)
                        if (dealBoard?.wonStayInStage) {
                          moveDeal(deal, deal.status, undefined, true, false);
                          onClose();
                          return;
                        }

                        // 1. Check if board has explicit Won Stage configured
                        if (dealBoard?.wonStageId) {
                          moveDeal(deal, dealBoard.wonStageId);
                          onClose();
                          return;
                        }

                        // 2. Find the appropriate "Success Stage" for this board based on lifecycle
                        const successStage = dealBoard?.stages.find(
                          s => s.linkedLifecycleStage === 'CUSTOMER'
                        ) || dealBoard?.stages.find(
                          s => s.linkedLifecycleStage === 'MQL'
                        ) || dealBoard?.stages.find(
                          s => s.linkedLifecycleStage === 'SALES_QUALIFIED'
                        );

                        if (successStage) {
                          moveDeal(deal, successStage.id);
                        } else {
                          // Fallback: just mark as won without moving
                          updateDeal(deal.id, { isWon: true, isLost: false, closedAt: new Date().toISOString() });
                        }
                        onClose();
                      }}
                      className="px-4 py-2 bg-green-600 hover:bg-green-500 text-white rounded-lg font-bold text-sm shadow-sm flex items-center gap-2"
                    >
                      <ThumbsUp size={16} /> GANHO
                    </button>
                    <button
                      onClick={() => {
                        // 0. Check for "Stay in Stage" flag
                        if (dealBoard?.lostStayInStage) {
                          // We don't set pendingLostStageId because we aren't moving to a new stage ID
                          // But the modal logic relies on it? No, if pendingLostStageId is null, we might need another flag.
                          // Actually, let's keep it clean.
                          // setPendingLostStageId(deal.status); // Hack?
                          // Better: Just open modal, and handle logic in confirm.
                        }

                        // If board has explicit Lost Stage, queue it
                        if (dealBoard?.lostStageId) {
                          setPendingLostStageId(dealBoard.lostStageId);
                        }
                        setLossReasonOrigin('button');
                        setShowLossReasonModal(true);
                      }}
                      className="px-4 py-2 bg-transparent border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg font-bold text-sm shadow-sm flex items-center gap-2"
                    >
                      <ThumbsDown size={16} /> PERDIDO
                    </button>
                  </>
                )}
                <button
                  onClick={() => setViewMode(v => v === 'modal' ? 'fullscreen' : 'modal')}
                  className="ml-2 text-slate-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
                  title={viewMode === 'modal' ? 'Tela cheia' : 'Modo modal'}
                >
                  {viewMode === 'modal' ? <Maximize2 size={20} /> : <Minimize2 size={20} />}
                </button>
                <button
                  onClick={() => setDeleteId(deal.id)}
                  className="ml-2 text-slate-400 hover:text-red-500 dark:hover:text-red-400 transition-colors"
                  title="Excluir Negócio"
                >
                  <Trash2 size={24} />
                </button>
                <button
                  onClick={onClose}
                  className="ml-2 text-slate-400 hover:text-slate-600 dark:hover:text-white"
                >
                  <X size={24} />
                </button>
              </div>
            </div>

            {dealBoard ? (
              <StageProgressBar
                stages={dealBoard.stages}
                currentStatus={deal.status}
                variant="timeline"
                onStageClick={stageId => {
                  // Check if clicking on a LOST stage
                  const targetStage = dealBoard.stages.find(s => s.id === stageId);
                  // Check if it matches configured Lost Stage OR explicitly linked 'OTHER' stage
                  const isLostStage =
                    dealBoard.lostStageId === stageId ||
                    targetStage?.linkedLifecycleStage === 'OTHER';

                  if (isLostStage) {
                    // Show loss reason modal
                    setPendingLostStageId(stageId);
                    setLossReasonOrigin('stage');
                    setShowLossReasonModal(true);
                  } else {
                    // Regular move
                    moveDeal(deal, stageId);
                  }
                }}
              />
            ) : (
              <div className="mt-4 rounded-lg border border-slate-200/60 bg-slate-50 px-4 py-3 text-xs text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-300">
                Board não encontrado para este negócio. Algumas ações (mover estágio) podem ficar indisponíveis.
              </div>
            )}
          </div>

          <div className="flex-1 flex flex-col md:flex-row overflow-hidden min-h-0">
            {/* Left Sidebar (Static Info + Custom Fields) */}
            <div className="w-full md:w-1/3 border-b md:border-b-0 md:border-r border-slate-200 dark:border-white/5 p-4 sm:p-6 overflow-y-auto overflow-x-hidden scrollbar-custom bg-white dark:bg-dark-card max-h-[38vh] md:max-h-none">
              <div className="space-y-6">
                <div>
                  <h3 className="text-xs font-bold text-slate-400 uppercase mb-2 flex items-center gap-2">
                    <Building2 size={14} /> Empresa (Conta)
                  </h3>
                  <p className="text-slate-900 dark:text-white font-medium">{deal.companyName}</p>
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

                {/* DYNAMIC CUSTOM FIELDS INPUTS */}
                {customFieldDefinitions.length > 0 && (
                  <div className="pt-4 border-t border-slate-100 dark:border-white/5">
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <h3 className="text-xs font-bold text-slate-400 uppercase">
                        Campos Personalizados
                      </h3>
                      <button
                        type="button"
                        onClick={() => {
                          if (isCustomFieldsEditMode) {
                            saveCustomFieldsDraft();
                          } else {
                            startCustomFieldsEditMode();
                          }
                        }}
                        className="text-xs font-bold px-2.5 py-1 rounded-md border border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10 transition-colors"
                      >
                        {isCustomFieldsEditMode ? 'Concluir' : 'Alterar'}
                      </button>
                    </div>
                    <div className="divide-y divide-slate-100 dark:divide-white/5">
                      {customFieldDefinitions.map(field => (
                        <div
                          key={field.id}
                          className="py-2.5 last:pb-0"
                        >
                          <div className="min-w-0 text-sm">
                            <span className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1" title={field.label}>
                              {field.label}
                            </span>

                            {isCustomFieldsEditMode ? (
                              <div className="w-full min-w-0">
                                {field.type === 'select' ? (
                                  <select
                                    value={customFieldsDraft[field.key] ?? ''}
                                    onChange={e =>
                                      setCustomFieldsDraft(prev => ({ ...prev, [field.key]: e.target.value }))
                                    }
                                    className="w-full min-w-0 bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg px-2.5 py-1.5 text-sm dark:text-white focus:ring-2 focus:ring-primary-500 outline-none"
                                  >
                                    <option value="">Selecione...</option>
                                    {field.options?.map(opt => (
                                      <option key={opt} value={opt}>
                                        {opt}
                                      </option>
                                    ))}
                                  </select>
                                ) : field.type === 'multiselect' ? (
                                  <div className="space-y-1 max-h-32 overflow-y-auto">
                                    {field.options?.map(opt => {
                                      const current: string[] = Array.isArray(deal.customFields?.[field.key])
                                        ? deal.customFields[field.key]
                                        : [];
                                      const isChecked = current.includes(opt);
                                      return (
                                        <label key={opt} className="flex items-center gap-2 cursor-pointer text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/5 px-2 py-1 rounded">
                                          <input
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
                                    <input
                                      type="text"
                                      inputMode="decimal"
                                      value={customFieldsDraft[field.key] ?? ''}
                                      onChange={e =>
                                        setCustomFieldsDraft(prev => ({ ...prev, [field.key]: e.target.value }))
                                      }
                                      placeholder="0,00"
                                      className="w-full min-w-0 bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg pl-8 pr-2.5 py-1.5 text-sm dark:text-white focus:ring-2 focus:ring-primary-500 outline-none"
                                    />
                                  </div>
                                ) : (
                                  <input
                                    type={field.type === 'date' ? 'date' : field.type}
                                    value={customFieldsDraft[field.key] ?? ''}
                                    onChange={e =>
                                      setCustomFieldsDraft(prev => ({ ...prev, [field.key]: e.target.value }))
                                    }
                                    onClick={e => {
                                      if (field.type === 'date') {
                                        tryOpenDatePicker(e.currentTarget);
                                      }
                                    }}
                                    className="w-full min-w-0 bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg px-2.5 py-1.5 text-sm dark:text-white focus:ring-2 focus:ring-primary-500 outline-none"
                                  />
                                )}
                              </div>
                            ) : (() => {
                              const value = deal.customFields?.[field.key];
                              const displayValue = getCustomFieldDisplayValue(field.type, value);
                              if (!displayValue) {
                                return (
                                  <p className="min-w-0 text-sm italic text-slate-500 dark:text-slate-400">
                                    Campo vazio
                                  </p>
                                );
                              }
                              return (
                                <p
                                  className="min-w-0 line-clamp-3 break-words text-sm text-slate-900 dark:text-white cursor-default"
                                  title={String(displayValue)}
                                >
                                  {displayValue}
                                </p>
                              );
                            })()}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* TAGS */}
                <div className="pt-4 border-t border-slate-100 dark:border-white/5">
                  <h3 className="text-xs font-bold text-slate-400 uppercase mb-3 flex items-center gap-2">
                    <TagIcon size={14} /> Tags
                  </h3>

                  <div className="flex flex-wrap gap-2">
                    {(deal.tags || []).length === 0 ? (
                      <p className="text-xs text-slate-500 italic">Sem tags.</p>
                    ) : (
                      (deal.tags || []).map((tag) => (
                        <span
                          key={tag}
                          className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-full bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-white/10"
                        >
                          {tag}
                          <button
                            type="button"
                            onClick={() => removeDealTag(tag)}
                            className="ml-0.5 text-slate-400 hover:text-red-500 dark:hover:text-red-400"
                            aria-label={`Remover tag ${tag}`}
                            title="Remover tag"
                          >
                            <X size={12} />
                          </button>
                        </span>
                      ))
                    )}
                  </div>

                  <div className="mt-3">
                    <label className="block text-[11px] font-bold text-slate-400 uppercase mb-1">
                      Adicionar tag
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={tagQuery}
                        onChange={(e) => setTagQuery(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            addDealTag(tagQuery);
                          }
                        }}
                        placeholder="Ex: VIP, Urgente, Q4..."
                        className="min-w-0 flex-1 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary-500 dark:text-white"
                        aria-label="Adicionar tag"
                      />
                      <button
                        type="button"
                        onClick={() => addDealTag(tagQuery)}
                        disabled={!normalizeTag(tagQuery)}
                        className="shrink-0 h-10 w-10 inline-flex items-center justify-center rounded-lg bg-primary-600 hover:bg-primary-500 disabled:opacity-50 disabled:cursor-not-allowed text-white transition-colors"
                        aria-label="Adicionar tag"
                        title="Adicionar tag"
                      >
                        <Plus size={18} aria-hidden="true" />
                      </button>
                    </div>

                    {(normalizeTag(tagQuery) && tagSuggestions.length > 0) && (
                      <div className="mt-2 bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg overflow-hidden">
                        {tagSuggestions.map((t) => (
                          <button
                            key={t}
                            type="button"
                            onClick={() => addDealTag(t)}
                            className="w-full text-left px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors"
                          >
                            {t}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

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
                        {PT_BR_DATE_FORMATTER.format(new Date(deal.createdAt))}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-500">Probabilidade</span>
                      <span className="text-slate-900 dark:text-white">{deal.probability}%</span>
                    </div>
                  </div>
                </div>

                {/* RESPONSÁVEL (owner) — só admin/super_admin pode atribuir — última seção */}
                {canAssignOwner && (
                  <div className="pt-4 border-t border-slate-100 dark:border-white/5">
                    <h3 className="text-xs font-bold text-slate-400 uppercase mb-2 flex items-center gap-2">
                      <User size={14} /> Responsável
                    </h3>
                    <select
                      value={deal.ownerId || ''}
                      onChange={(e) => updateDeal(deal.id, { ownerId: e.target.value })}
                      className="w-full bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg px-2.5 py-2 text-sm text-slate-900 dark:text-white focus:ring-2 focus:ring-primary-500 outline-none"
                    >
                      <option value="">Sem responsável</option>
                      {orgUsers.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}{u.role === 'admin' ? ' (admin)' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            </div>

            {/* Right Content (Tabs & Timeline) */}
            <div className="flex-1 min-h-0 flex flex-col bg-white dark:bg-dark-card">
              <div className="h-14 border-b border-slate-200 dark:border-white/5 flex items-center px-6 shrink-0">
                <div className="flex gap-6">
                  <button
                    onClick={() => setActiveTab('whatsapp')}
                    className={`text-sm font-bold h-14 border-b-2 transition-colors flex items-center gap-1.5 ${activeTab === 'whatsapp' ? 'border-emerald-500 text-emerald-600 dark:text-emerald-400' : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-white'}`}
                  >
                    <MessageCircle size={15} /> WhatsApp
                  </button>
                  <button
                    onClick={() => setActiveTab('timeline')}
                    className={`text-sm font-bold h-14 border-b-2 transition-colors ${activeTab === 'timeline' ? 'border-primary-500 text-primary-600 dark:text-white' : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-white'}`}
                  >
                    Timeline
                  </button>
                  <button
                    onClick={() => setActiveTab('activities')}
                    className={`text-sm font-bold h-14 border-b-2 transition-colors ${activeTab === 'activities' ? 'border-primary-500 text-primary-600 dark:text-white' : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-white'}`}
                  >
                    Atividades
                  </button>
                  <button
                    onClick={() => setActiveTab('notes')}
                    className={`text-sm font-bold h-14 border-b-2 transition-colors ${activeTab === 'notes' ? 'border-primary-500 text-primary-600 dark:text-white' : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-white'}`}
                  >
                    Notas
                  </button>
                  <button
                    onClick={() => setActiveTab('products')}
                    className={`text-sm font-bold h-14 border-b-2 transition-colors ${activeTab === 'products' ? 'border-primary-500 text-primary-600 dark:text-white' : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-white'}`}
                  >
                    Produtos
                  </button>
                  <button
                    onClick={() => setActiveTab('info')}
                    className={`text-sm font-bold h-14 border-b-2 transition-colors ${activeTab === 'info' ? 'border-primary-500 text-primary-600 dark:text-white' : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-white'}`}
                  >
                    IA Insights
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto scrollbar-custom p-6 bg-slate-50/30 dark:bg-black/10">
                {activeTab === 'whatsapp' && (
                  <div className="h-full">
                    <DealWhatsAppChat contact={contact} />
                  </div>
                )}
                {activeTab === 'timeline' && (
                  <div className="space-y-6">
                    {/* Descrição fixa — sempre visível, persistente (salva no blur) */}
                    <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl p-4 shadow-sm">
                      <textarea
                        ref={descriptionTextareaRef}
                        className="w-full bg-transparent text-sm text-slate-900 dark:text-white placeholder:text-slate-400 outline-none resize-none overflow-hidden min-h-[120px]"
                        placeholder="Adicione uma descrição..."
                        value={descriptionDraft}
                        onChange={e => setDescriptionDraft(e.target.value)}
                        onBlur={() => {
                          const next = descriptionDraft;
                          if (next !== (deal.description ?? '')) {
                            updateDeal(deal.id, { description: next });
                          }
                        }}
                      />
                    </div>

                    {/* Nova Nota — editor só aparece após clique */}
                    {!showNewNote ? (
                      <button
                        onClick={() => setShowNewNote(true)}
                        className="w-full flex items-center justify-center gap-2 py-2.5 border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-xl text-sm font-medium text-slate-500 dark:text-slate-400 hover:border-primary-400 hover:text-primary-600 dark:hover:border-primary-500 dark:hover:text-primary-400 transition-colors"
                      >
                        <Plus size={16} /> Nova Nota
                      </button>
                    ) : (
                      <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl p-4 shadow-sm">
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="text-sm font-bold text-slate-700 dark:text-white">Nova Nota</h4>
                          <button
                            onClick={() => { setShowNewNote(false); setNewNote(''); }}
                            className="text-slate-400 hover:text-slate-600 dark:hover:text-white"
                          >
                            <X size={16} />
                          </button>
                        </div>
                        <textarea
                          ref={noteTextareaRef}
                          autoFocus
                          className="w-full bg-transparent text-sm text-slate-900 dark:text-white placeholder:text-slate-400 outline-none resize-none min-h-[80px]"
                          placeholder="Escreva uma nota..."
                          value={newNote}
                          onChange={e => setNewNote(e.target.value)}
                        />
                        <div className="flex justify-between items-center mt-2 pt-2 border-t border-slate-100 dark:border-white/5">
                          <div />
                          <button
                            onClick={() => { handleAddNote(); setShowNewNote(false); }}
                            disabled={!newNote.trim()}
                            className="bg-primary-600 hover:bg-primary-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-1.5 rounded-lg text-xs font-bold flex items-center gap-2 transition-all"
                          >
                            <Check size={14} /> Enviar
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Quick Activity Creation */}
                    {!showQuickActivity ? (
                      <button
                        onClick={() => setShowQuickActivity(true)}
                        className="w-full flex items-center justify-center gap-2 py-2.5 border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-xl text-sm font-medium text-slate-500 dark:text-slate-400 hover:border-primary-400 hover:text-primary-600 dark:hover:border-primary-500 dark:hover:text-primary-400 transition-colors"
                      >
                        <Plus size={16} /> Nova Atividade
                      </button>
                    ) : (
                      <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl p-4 shadow-sm space-y-3">
                        <div className="flex items-center justify-between">
                          <h4 className="text-sm font-bold text-slate-700 dark:text-white">
                            {editingActivityId ? 'Editar Atividade' : 'Nova Atividade'}
                          </h4>
                          <button onClick={resetQuickActivityForm} className="text-slate-400 hover:text-slate-600 dark:hover:text-white">
                            <X size={16} />
                          </button>
                        </div>
                        <input
                          type="text"
                          required
                          className="w-full bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-primary-500"
                          placeholder="Título da atividade..."
                          value={quickActivityTitle}
                          onChange={e => setQuickActivityTitle(e.target.value)}
                        />
                        <div className="grid grid-cols-3 gap-2">
                          <select
                            className="bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-primary-500"
                            value={quickActivityType}
                            onChange={e => setQuickActivityType(e.target.value as typeof quickActivityType)}
                          >
                            <option value="CALL">Ligação</option>
                            <option value="MEETING">Reunião</option>
                            <option value="EMAIL">Email</option>
                            <option value="TASK">Tarefa</option>
                          </select>
                          <input
                            type="date"
                            required
                            className="bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-primary-500"
                            value={quickActivityDate}
                            onChange={e => setQuickActivityDate(e.target.value)}
                          />
                          <input
                            type="time"
                            required
                            className="bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-primary-500"
                            value={quickActivityTime}
                            onChange={e => setQuickActivityTime(e.target.value)}
                          />
                        </div>
                        <textarea
                          className="w-full bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-primary-500 min-h-[60px] resize-none"
                          placeholder="Descrição (opcional)..."
                          value={quickActivityDesc}
                          onChange={e => setQuickActivityDesc(e.target.value)}
                        />
                        <button
                          onClick={handleAddQuickActivity}
                          disabled={!quickActivityTitle.trim() || !quickActivityDate || !quickActivityTime}
                          className="w-full bg-primary-600 hover:bg-primary-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-sm font-bold transition-all"
                        >
                          {editingActivityId ? 'Salvar alterações' : 'Criar Atividade'}
                        </button>
                      </div>
                    )}

                    <div className="space-y-3 pl-4 border-l border-slate-200 dark:border-slate-800">
                      {dealActivities.length === 0 && (
                        <p className="text-sm text-slate-500 italic pl-4">
                          Nenhuma atividade registrada.
                        </p>
                      )}
                      {dealActivities.map(activity => (
                        <ActivityRow
                          key={activity.id}
                          activity={activity}
                          deal={deal}
                          onToggleComplete={toggleActivityCompletion}
                          onEdit={startEditActivity}
                          onDelete={deleteActivity}
                          isPending={isActivityPending(activity.id)}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {activeTab === 'activities' && (
                  <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
                    {/* Quick Activity Creation */}
                    {!showQuickActivity ? (
                      <button
                        onClick={() => setShowQuickActivity(true)}
                        className="w-full flex items-center justify-center gap-2 py-2.5 border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-xl text-sm font-medium text-slate-500 dark:text-slate-400 hover:border-primary-400 hover:text-primary-600 dark:hover:border-primary-500 dark:hover:text-primary-400 transition-colors"
                      >
                        <Plus size={16} /> Nova Atividade
                      </button>
                    ) : (
                      <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl p-4 shadow-sm space-y-3">
                        <div className="flex items-center justify-between">
                          <h4 className="text-sm font-bold text-slate-700 dark:text-white">
                            {editingActivityId ? 'Editar Atividade' : 'Nova Atividade'}
                          </h4>
                          <button onClick={resetQuickActivityForm} className="text-slate-400 hover:text-slate-600 dark:hover:text-white">
                            <X size={16} />
                          </button>
                        </div>
                        <input
                          type="text"
                          className="w-full bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-primary-500"
                          placeholder="Título da atividade..."
                          value={quickActivityTitle}
                          onChange={e => setQuickActivityTitle(e.target.value)}
                        />
                        <div className="grid grid-cols-3 gap-2">
                          <select
                            className="bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-primary-500"
                            value={quickActivityType}
                            onChange={e => setQuickActivityType(e.target.value as typeof quickActivityType)}
                          >
                            <option value="CALL">Ligação</option>
                            <option value="MEETING">Reunião</option>
                            <option value="EMAIL">Email</option>
                            <option value="TASK">Tarefa</option>
                          </select>
                          <input
                            type="date"
                            className="bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-primary-500"
                            value={quickActivityDate}
                            onChange={e => setQuickActivityDate(e.target.value)}
                          />
                          <input
                            type="time"
                            className="bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-primary-500"
                            value={quickActivityTime}
                            onChange={e => setQuickActivityTime(e.target.value)}
                          />
                        </div>
                        <textarea
                          className="w-full bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-primary-500 min-h-[60px] resize-none"
                          placeholder="Descrição (opcional)..."
                          value={quickActivityDesc}
                          onChange={e => setQuickActivityDesc(e.target.value)}
                        />
                        <button
                          onClick={handleAddQuickActivity}
                          disabled={!quickActivityTitle.trim() || !quickActivityDate || !quickActivityTime}
                          className="w-full bg-primary-600 hover:bg-primary-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-sm font-bold transition-all"
                        >
                          {editingActivityId ? 'Salvar alterações' : 'Criar Atividade'}
                        </button>
                      </div>
                    )}

                    <div className="space-y-3">
                      {dealTaskActivities.length === 0 && (
                        <p className="text-sm text-slate-500 italic text-center py-4">
                          Nenhuma atividade registrada.
                        </p>
                      )}
                      {dealTaskActivities.map(activity => (
                        <ActivityRow
                          key={activity.id}
                          activity={activity}
                          deal={deal}
                          onToggleComplete={toggleActivityCompletion}
                          onEdit={startEditActivity}
                          onDelete={deleteActivity}
                          isPending={isActivityPending(activity.id)}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {activeTab === 'notes' && (
                  <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
                    <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl p-4 shadow-sm">
                      <textarea
                        className="w-full bg-transparent text-sm text-slate-900 dark:text-white placeholder:text-slate-400 outline-none resize-none min-h-[80px]"
                        placeholder="Escreva uma nota..."
                        value={newNote}
                        onChange={e => setNewNote(e.target.value)}
                      />
                      <div className="flex justify-between items-center mt-2 pt-2 border-t border-slate-100 dark:border-white/5">
                        <div />
                        <button
                          onClick={handleAddNote}
                          disabled={!newNote.trim()}
                          className="bg-primary-600 hover:bg-primary-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-1.5 rounded-lg text-xs font-bold flex items-center gap-2 transition-all"
                        >
                          <Check size={14} /> Enviar
                        </button>
                      </div>
                    </div>

                    <div className="space-y-3">
                      {dealNotes.length === 0 && (
                        <p className="text-sm text-slate-500 italic text-center py-4">
                          Nenhuma nota registrada.
                        </p>
                      )}
                      {dealNotes.map(note => (
                        <div
                          key={note.id}
                          className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl p-4 group"
                        >
                          <p className="text-sm text-slate-900 dark:text-white whitespace-pre-wrap">
                            {note.description}
                          </p>
                          <div className="flex items-center justify-between mt-3 pt-2 border-t border-slate-100 dark:border-white/5">
                            <span className="text-xs text-slate-400">
                              {new Date(note.date).toLocaleDateString('pt-BR')} às {new Date(note.date).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                            </span>
                            <button
                              onClick={() => deleteActivity(note.id)}
                              className="text-slate-400 hover:text-red-500 p-1 rounded opacity-0 group-hover:opacity-100 transition-all"
                              title="Excluir nota"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {activeTab === 'products' && (
                  <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
                    <div className="bg-slate-50 dark:bg-black/20 p-4 rounded-xl border border-slate-200 dark:border-white/10">
                      <h3 className="text-sm font-bold text-slate-700 dark:text-white mb-3 flex items-center gap-2">
                        <Package size={16} /> Adicionar Produto/Serviço
                      </h3>
                      <div className="flex gap-3">
                        <select
                          className="flex-1 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary-500 dark:text-white"
                          value={selectedProductId}
                          onChange={e => setSelectedProductId(e.target.value)}
                        >
                          <option value="">Selecione um item...</option>
                          {products.map(p => (
                            <option key={p.id} value={p.id}>
                              {p.name} - ${p.price}
                            </option>
                          ))}
                        </select>
                        <input
                          type="number"
                          min="1"
                          className="w-20 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary-500 dark:text-white"
                          value={productQuantity}
                          onChange={e => setProductQuantity(parseInt(e.target.value))}
                        />
                        <button
                          onClick={handleAddProduct}
                          disabled={!selectedProductId}
                          className="bg-primary-600 hover:bg-primary-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-sm font-bold transition-colors"
                        >
                          Adicionar
                        </button>
                      </div>

                      <div className="mt-3 flex items-center justify-between gap-3">
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          Produto depende do cliente? Use um item personalizado (não precisa estar no catálogo).
                        </div>
                        <button
                          type="button"
                          onClick={() => setShowCustomItem(v => !v)}
                          className="text-xs font-bold text-primary-600 dark:text-primary-400 hover:underline"
                        >
                          {showCustomItem ? 'Fechar' : 'Adicionar item personalizado'}
                        </button>
                      </div>

                      {showCustomItem && (
                        <div className="mt-3 rounded-xl border border-slate-200 dark:border-white/10 bg-white/60 dark:bg-white/5 p-3">
                          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                            <div className="sm:col-span-6">
                              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Nome do item</label>
                              <input
                                value={customItemName}
                                onChange={e => setCustomItemName(e.target.value)}
                                placeholder="Ex.: Pacote personalizado, Procedimento X…"
                                className="w-full bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary-500 dark:text-white"
                              />
                            </div>
                            <div className="sm:col-span-3">
                              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Preço</label>
                              <input
                                value={customItemPrice}
                                onChange={e => setCustomItemPrice(e.target.value)}
                                inputMode="decimal"
                                className="w-full bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary-500 dark:text-white"
                              />
                            </div>
                            <div className="sm:col-span-2">
                              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Qtd</label>
                              <input
                                type="number"
                                min={1}
                                value={customItemQuantity}
                                onChange={e => setCustomItemQuantity(parseInt(e.target.value))}
                                className="w-full bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary-500 dark:text-white"
                              />
                            </div>
                            <div className="sm:col-span-1">
                              <button
                                type="button"
                                onClick={handleAddCustomItem}
                                className="w-full bg-primary-600 hover:bg-primary-500 text-white px-3 py-2 rounded-lg text-sm font-bold transition-colors"
                              >
                                +
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/5 rounded-xl overflow-hidden">
                      <table className="w-full text-left text-sm">
                        <thead className="bg-slate-50 dark:bg-black/20 border-b border-slate-200 dark:border-white/5 text-slate-500 dark:text-slate-400 font-medium">
                          <tr>
                            <th className="px-4 py-3">Item</th>
                            <th className="px-4 py-3 w-20 text-center">Qtd</th>
                            <th className="px-4 py-3 w-32 text-right">Preço Unit.</th>
                            <th className="px-4 py-3 w-32 text-right">Total</th>
                            <th className="px-4 py-3 w-10"></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                          {!deal.items || deal.items.length === 0 ? (
                            <tr>
                              <td colSpan={5} className="px-4 py-8 text-center text-slate-500 italic">
                                Nenhum produto adicionado. O valor do negócio é manual.
                              </td>
                            </tr>
                          ) : (
                            deal.items.map(item => (
                              <tr key={item.id}>
                                <td className="px-4 py-3 text-slate-900 dark:text-white font-medium">
                                  {item.name}
                                </td>
                                <td className="px-4 py-3 text-center text-slate-600 dark:text-slate-300">
                                  {item.quantity}
                                </td>
                                <td className="px-4 py-3 text-right text-slate-600 dark:text-slate-300">
                                  ${item.price.toLocaleString()}
                                </td>
                                <td className="px-4 py-3 text-right font-bold text-slate-900 dark:text-white">
                                  ${(item.price * item.quantity).toLocaleString()}
                                </td>
                                <td className="px-4 py-3 text-center">
                                  <button
                                    onClick={() => removeItemFromDeal(deal.id, item.id)}
                                    className="text-slate-400 hover:text-red-500 transition-colors"
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                        <tfoot className="bg-slate-50 dark:bg-black/20 border-t border-slate-200 dark:border-white/5">
                          <tr>
                            <td
                              colSpan={3}
                              className="px-4 py-3 text-right font-bold text-slate-700 dark:text-slate-300 uppercase text-xs tracking-wider"
                            >
                              Total do Pedido
                            </td>
                            <td className="px-4 py-3 text-right font-bold text-primary-600 dark:text-primary-400 text-lg">
                              ${(deal.items || []).reduce((sum, i) => sum + i.price * i.quantity, 0).toLocaleString()}
                            </td>
                            <td></td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                )}

                {activeTab === 'info' && (
                  <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
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
                        <input
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
                )}
              </div>
            </div>
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

        <LossReasonModal
          isOpen={showLossReasonModal}
          onClose={() => {
            setShowLossReasonModal(false);
            setPendingLostStageId(null);
            setLossReasonOrigin('button');
          }}
          onConfirm={(reason, category) => {
            // Priority:
            // 0. Stay in stage flag (Archive)
            // 1. Pending Stage (if set via click or explicit button)
            // 2. Explicit Lost Stage on Board
            // 3. Stage linked to 'OTHER' lifecycle

            const lossFields = {
              isLost: true,
              isWon: false,
              closedAt: new Date().toISOString(),
              lossReason: reason,
              lossCategory: category,
            };

            if (dealBoard?.lostStayInStage) {
              moveDeal(deal, deal.status, reason, false, true); // explicitLost = true
              updateDeal(deal.id, { lossCategory: category });
              setShowLossReasonModal(false);
              setPendingLostStageId(null);
              if (lossReasonOrigin === 'button') onClose();
              return;
            }

            let targetStageId = pendingLostStageId;

            if (!targetStageId && dealBoard?.lostStageId) {
              targetStageId = dealBoard.lostStageId;
            }

            if (!targetStageId) {
              targetStageId =
                dealBoard?.stages.find(s => s.linkedLifecycleStage === 'OTHER')?.id ?? null;
            }

            if (targetStageId) {
              moveDeal(deal, targetStageId, reason);
              updateDeal(deal.id, { lossCategory: category });
            } else {
              // Fallback: just mark as lost without moving
              updateDeal(deal.id, lossFields);
            }
            setShowLossReasonModal(false);
            setPendingLostStageId(null);
            // Only close the deal modal if it was triggered via the "PERDIDO" button
            if (lossReasonOrigin === 'button') onClose();
          }}
          dealTitle={deal.title}
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
    <FocusTrap active={isOpen} onEscape={onClose}>
      <div
        // Backdrop + positioning wrapper. Clicking outside the panel should close the modal.
        // No desktop, este modal não deve cobrir a sidebar de navegação.
        // Em md+ deslocamos o overlay pela largura da sidebar via `--app-sidebar-width`.
        className={`fixed inset-0 md:left-[var(--app-sidebar-width,0px)] z-[9999] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm ${viewMode === 'fullscreen' ? 'p-0' : 'p-4'}`}
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
