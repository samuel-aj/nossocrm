import { newerRecord } from "@/lib/query/dealCache";
import React, { useState, useRef, useEffect, useId, useMemo } from "react";
import { useCRM } from "@/context/CRMContext";
import { useMyActionPermissions } from "@/lib/permissions/useMyActionPermissions";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { useDeal, useContact, useOrgMembers } from "@/lib/query/hooks";
import { FocusTrap, useFocusReturn } from "@/lib/a11y";
import { useResponsiveMode } from "@/hooks/useResponsiveMode";
import { DealSheet } from "../DealSheet";
import { DealWhatsAppChat } from "@/features/whatsapp/DealWhatsAppChat";
import { LeadPropertiesPanel } from "@/features/deals/lead/LeadPropertiesPanel";
import { useLeadConversation } from "@/features/deals/lead/useLeadConversation";
import { EMPTY_ACTIVITY_DRAFT } from "@/features/deals/lead/LeadComposers";
import {
  analyzeLead,
  generateEmailDraft,
  generateObjectionResponse,
} from "@/lib/ai/tasksClient";
import { BrainCircuit, Mail, X, Bot, Sword } from "lucide-react";

interface DealDetailModalProps {
  dealId: string | null;
  isOpen: boolean;
  onClose: () => void;
  scheduleHint?: { type: "CALL" | "MEETING" | "EMAIL" } | null;
  onScheduleHintConsumed?: () => void;
}
const QUICK_ACTIVITY_TITLE_BY_TYPE = {
  CALL: "Ligar para Cliente",
  MEETING: "Reunião de Acompanhamento",
  EMAIL: "Enviar Email de Follow-up",
};

export const DealDetailModal: React.FC<DealDetailModalProps> = ({
  dealId,
  isOpen,
  onClose,
  scheduleHint = null,
  onScheduleHintConsumed,
}) => {
  const headingId = useId();
  useFocusReturn({ enabled: isOpen });
  const { mode } = useResponsiveMode();
  const isMobile = mode === "mobile";
  const {
    deals,
    contacts,
    boards,
    activeBoard,
    updateDeal,
    sidebarCollapsed,
    setSidebarCollapsed,
  } = useCRM();
  const { profile } = useAuth();
  const { addToast } = useToast();
  const { data: orgMembers = [] } = useOrgMembers();
  const collapsedRef = useRef(sidebarCollapsed);
  useEffect(() => {
    collapsedRef.current = sidebarCollapsed;
  }, [sidebarCollapsed]);
  useEffect(() => {
    if (!isOpen) return;
    const wasCollapsed = collapsedRef.current;
    setSidebarCollapsed(true);
    return () => {
      if (!wasCollapsed) setSidebarCollapsed(false);
    };
  }, [isOpen, setSidebarCollapsed]);
  const dealsById = useMemo(
    () => new Map(deals.map((d) => [d.id, d])),
    [deals],
  );
  const contactsById = useMemo(
    () => new Map(contacts.map((c) => [c.id, c])),
    [contacts],
  );
  const boardsById = useMemo(
    () => new Map(boards.map((b) => [b.id, b])),
    [boards],
  );
  const cachedDeal = dealId ? dealsById.get(dealId) : undefined;
  const {
    data: fetchedDeal,
    isLoading: fetchingDeal,
    isError: fetchDealError,
    isSuccess: fetchDealSuccess,
    refetch: refetchDeal,
  } = useDeal(isOpen && dealId ? dealId : undefined);
  const deal =
    fetchDealSuccess && fetchedDeal === null
      ? undefined
      : (newerRecord(cachedDeal, fetchedDeal as typeof cachedDeal) ??
        undefined);
  const contactQuery = useContact(
    isOpen ? deal?.contactId || undefined : undefined,
  );
  const cachedContact = deal ? contactsById.get(deal.contactId) : null;
  const contact =
    contactQuery.isSuccess && contactQuery.data === null
      ? null
      : newerRecord(cachedContact, contactQuery.data);
  const contactLoadState = !deal?.contactId
    ? fetchingDeal
      ? "loading"
      : undefined
    : contactQuery.isError
      ? "error"
      : contactQuery.isSuccess && !contact
        ? "unavailable"
        : !contact
          ? "loading"
          : undefined;
  const dealBoard = deal
    ? (boardsById.get(deal.boardId) ?? activeBoard)
    : activeBoard;
  const permissions = useMyActionPermissions(deal?.boardId);
  const conversation = useLeadConversation({ deal, enabled: isOpen });
  const [viewMode, setViewMode] = useState<"modal" | "fullscreen">(
    "fullscreen",
  );
  const [mobilePane, setMobilePane] = useState<"data" | "chat">("chat");
  const [aiOpen, setAiOpen] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isDrafting, setIsDrafting] = useState(false);
  const [aiResult, setAiResult] = useState<{
    suggestion: string;
    score: number;
  } | null>(null);
  const [emailDraft, setEmailDraft] = useState<string | null>(null);
  const [objection, setObjection] = useState("");
  const [objectionResponses, setObjectionResponses] = useState<string[]>([]);
  const [isGeneratingObjections, setIsGeneratingObjections] = useState(false);
  useEffect(() => {
    if (!isOpen) return;
    setViewMode("fullscreen");
    setMobilePane("chat");
    setAiOpen(false);
    setAiResult(null);
    setEmailDraft(null);
    setObjection("");
    setObjectionResponses([]);
  }, [isOpen, dealId]);
  useEffect(() => {
    if (!isOpen || !deal || !scheduleHint) return;
    conversation.startActivity({
      ...EMPTY_ACTIVITY_DRAFT,
      type: scheduleHint.type,
      title: QUICK_ACTIVITY_TITLE_BY_TYPE[scheduleHint.type],
    });
    setMobilePane("chat");
    onScheduleHintConsumed?.();
  }, [isOpen, dealId, scheduleHint]);
  if (!isOpen) return null;
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
          onClick={(event) => event.stopPropagation()}
        >
          {unavailable ? (
            <>
              <p role="alert">
                Não foi possível abrir este lead. Ele pode ter sido removido ou
                seu acesso pode ter mudado.
              </p>
              <button onClick={() => void refetchDeal()}>
                Tentar novamente
              </button>
            </>
          ) : (
            <p>Carregando lead…</p>
          )}
          <button onClick={onClose}>Fechar</button>
        </div>
      </div>
    );
  }
  const stageLabel = dealBoard?.stages.find(
    (stage) => stage.id === deal.status,
  )?.label;
  const handleAnalyzeDeal = async () => {
    if (!permissions.deals.edit) return;
    setIsAnalyzing(true);
    try {
      const result = await analyzeLead(deal, stageLabel);
      setAiResult({
        suggestion: result.suggestion,
        score: result.probabilityScore,
      });
      await updateDeal(
        deal.id,
        {
          aiSummary: result.suggestion,
          probability: result.probabilityScore,
        },
        { throwOnError: true },
      );
      await conversation.refresh();
    } catch (error) {
      addToast(
        error instanceof Error
          ? error.message
          : "Falha ao analisar negócio com IA.",
        "warning",
      );
    } finally {
      setIsAnalyzing(false);
    }
  };
  const handleDraftEmail = async () => {
    setIsDrafting(true);
    try {
      setEmailDraft(await generateEmailDraft(deal, stageLabel));
    } catch (error) {
      addToast(
        error instanceof Error
          ? error.message
          : "Falha ao gerar e-mail com IA.",
        "warning",
      );
    } finally {
      setIsDrafting(false);
    }
  };
  const handleObjection = async () => {
    if (!objection.trim()) return;
    setIsGeneratingObjections(true);
    try {
      setObjectionResponses(await generateObjectionResponse(deal, objection));
    } catch (error) {
      addToast(
        error instanceof Error ? error.message : "Falha ao gerar respostas.",
        "warning",
      );
    } finally {
      setIsGeneratingObjections(false);
    }
  };
  const inner = (
    <div
      className={
        isMobile
          ? "bg-white dark:bg-dark-card border border-slate-200 dark:border-white/10 w-full h-[100dvh] flex flex-col overflow-hidden pb-[var(--app-safe-area-bottom,0px)]"
          : viewMode === "fullscreen"
            ? "bg-white dark:bg-dark-card border border-slate-200 dark:border-white/10 w-full h-full flex flex-col overflow-hidden"
            : "bg-white dark:bg-dark-card border border-slate-200 dark:border-white/10 rounded-2xl shadow-2xl w-full max-w-6xl h-[88vh] flex flex-col overflow-hidden"
      }
    >
      {isMobile && (
        <div
          role="tablist"
          aria-label="Seção do lead"
          className="shrink-0 flex border-b border-slate-200 dark:border-white/10 px-2 py-1.5"
        >
          {(
            [
              ["data", "Dados do lead"],
              ["chat", "Conversa"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={mobilePane === id}
              onClick={() => setMobilePane(id)}
              className="flex-1 p-2 text-sm"
            >
              {label}
            </button>
          ))}
          <button onClick={onClose} aria-label="Fechar lead">
            <X size={20} />
          </button>
        </div>
      )}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        <div
          className={`${isMobile ? (mobilePane === "data" ? "block w-full" : "hidden") : "block w-[380px] xl:w-[420px] shrink-0 border-r border-slate-200 dark:border-white/10"} h-full`}
        >
          <LeadPropertiesPanel
            key={deal.id}
            deal={deal}
            contact={contact}
            side="left"
            onExpand={
              !isMobile
                ? () =>
                    setViewMode((mode) =>
                      mode === "modal" ? "fullscreen" : "modal",
                    )
                : undefined
            }
            onDeleted={onClose}
          />
        </div>
        <section
          aria-label="Conversa e histórico do lead"
          className={`${isMobile ? (mobilePane === "chat" ? "flex" : "hidden") : "flex"} relative flex-1 min-w-0 min-h-0 flex-col bg-white dark:bg-dark-card`}
        >
          <DealWhatsAppChat
            contact={contact}
            contactLoadState={contactLoadState}
            onRetryContact={() => {
              void refetchDeal();
              void contactQuery.refetch();
            }}
            templateContext={{
              "contato.email": contact?.email || "",
              "lead.titulo": deal.title,
              "lead.valor": Number(deal.value || 0).toLocaleString("pt-BR", {
                style: "currency",
                currency: "BRL",
              }),
              "lead.etapa": stageLabel || "",
              "responsavel.nome":
                orgMembers.find((user) => user.id === deal.ownerId)?.name || "",
              "escritorio.nome": profile?.organization_name || "",
            }}
            timeline={{
              ...conversation.timeline,
              headerExtra: (
                <button
                  type="button"
                  onClick={() => setAiOpen((open) => !open)}
                  aria-expanded={aiOpen}
                  className="h-8 px-2 inline-flex items-center gap-1.5 rounded-lg text-xs font-bold text-slate-500 hover:text-primary-600"
                  title="Análise do negócio, rascunho de e-mail e respostas a objeções"
                >
                  <BrainCircuit size={14} /> IA Insights
                </button>
              ),
              headerEnd: !isMobile ? (
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Fechar lead"
                  title="Fechar"
                  className="h-8 w-8 flex items-center justify-center text-slate-400"
                >
                  <X size={18} />
                </button>
              ) : null,
            }}
          />
          {/* IA Insights: painel sobre a conversa (não perde a posição do chat) */}
          {aiOpen && (
            <div
              data-esc-local=""
              onKeyDown={(e) => {
                if (e.key === "Escape") setAiOpen(false);
              }}
              className="absolute inset-y-0 right-0 z-20 w-full sm:w-[440px] max-w-full border-l border-slate-200 dark:border-white/10 bg-white dark:bg-dark-card shadow-2xl flex flex-col animate-in slide-in-from-right-4 fade-in duration-200"
            >
              <div className="shrink-0 flex items-center justify-between px-4 py-2.5 border-b border-slate-200 dark:border-white/10">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <BrainCircuit size={16} className="text-primary-500" /> IA
                  Insights
                </h3>
                <button
                  type="button"
                  onClick={() => setAiOpen(false)}
                  className="p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white"
                  aria-label="Fechar IA Insights"
                >
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
                          {dealBoard.agentPersona?.role} • Foco:{" "}
                          {dealBoard.goal?.kpi || "Geral"}
                        </p>
                      </div>
                    </div>
                  )}
                  <div className="flex gap-3 mb-5">
                    <button
                      onClick={handleAnalyzeDeal}
                      disabled={isAnalyzing || !permissions.deals.edit}
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
                      onChange={(e) => setObjection(e.target.value)}
                    />
                    <button
                      onClick={handleObjection}
                      disabled={isGeneratingObjections || !objection.trim()}
                      className="bg-rose-600 hover:bg-rose-500 text-white px-4 py-2 rounded-lg text-sm font-bold transition-colors disabled:opacity-50"
                    >
                      {isGeneratingObjections ? (
                        <div className="animate-spin w-4 h-4 border-2 border-current border-t-transparent rounded-full" />
                      ) : (
                        "Gerar Respostas"
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
                          <p className="text-sm text-slate-700 dark:text-slate-200">
                            {resp}
                          </p>
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
      {conversation.dialogs}
    </div>
  );
  if (isMobile)
    return (
      <DealSheet
        isOpen={isOpen}
        onClose={onClose}
        ariaLabel={`Negócio: ${deal.title}`}
      >
        <div
          onKeyDown={(event) => {
            if (event.key === "Escape") onClose();
          }}
        >
          {inner}
        </div>
      </DealSheet>
    );
  return (
    <FocusTrap
      active={isOpen}
      onEscape={onClose}
      allowOutsideClick
      initialFocus="[data-focus-trap-fallback]"
    >
      <div
        className={`fixed inset-0 md:left-[var(--app-sidebar-width,0px)] z-[9999] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm ${viewMode === "fullscreen" ? "p-0" : "p-4"}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        onClick={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        {inner}
      </div>
    </FocusTrap>
  );
};
