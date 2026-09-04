import React, { useState } from 'react';
import {
  Target,
  Bot,
  DoorOpen,
  Info,
  Edit2,
  Check,
  X,
  ChevronRight,
  MessageSquare,
} from 'lucide-react';
import { Board } from '@/types';
import { useCRM } from '@/context/CRMContext';
import { useToast } from '@/context/ToastContext';

// Performance: reuse formatter instances.
const BRL_CURRENCY_FORMATTER = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

interface BoardStrategyHeaderProps {
  board: Board;
}

/**
 * Componente React `BoardStrategyHeader`.
 *
 * @param {BoardStrategyHeaderProps} { board } - Parâmetro `{ board }`.
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export const BoardStrategyHeader: React.FC<BoardStrategyHeaderProps> = ({ board }) => {
  const { updateBoard, setIsGlobalAIOpen, boards, deals } = useCRM();
  const { addToast } = useToast();
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editedBoard, setEditedBoard] = useState(board);

  // Calculate Progress Automatically
  const calculatedProgress = React.useMemo(() => {
    const type = board.goal?.type || 'number';

    /**
     * Performance: avoid `deals.filter(...)` + extra passes over the boardDeals.
     * We scan once and compute the aggregates we need.
     */
    let dealCount = 0;
    let wonCount = 0;
    let totalValue = 0;
    for (const d of deals) {
      if (d.boardId !== board.id) continue;
      dealCount += 1;
      totalValue += d.value || 0;
      if (d.isWon) wonCount += 1;
    }

    if (type === 'currency') {
      return {
        value: totalValue,
        display: BRL_CURRENCY_FORMATTER.format(totalValue),
      };
    }

    if (type === 'percentage') {
      if (dealCount === 0) return { value: 0, display: '0%' };
      const percent = Math.round((wonCount / dealCount) * 100);
      return {
        value: percent,
        display: `${percent}%`,
      };
    }

    // Default: Number
    return {
      value: dealCount,
      display: dealCount.toString(),
    };
  }, [deals, board.id, board.goal?.type]);

  // Performance: parse target once per goal change (instead of per render).
  // Hook must live before any early returns (rules-of-hooks).
  const targetValueNumber = React.useMemo(() => {
    if (!board.goal?.targetValue) return 0;

    // Parse Target
    const targetStr = board.goal.targetValue.replace(/[^0-9.]/g, '');
    const target = parseFloat(targetStr);
    return Number.isFinite(target) ? target : 0;
  }, [board.goal?.targetValue]);

  // Performance: compute progress as a derived value (and keep hooks order stable).
  const progress = React.useMemo(() => {
    if (targetValueNumber === 0) return 0;
    const current = calculatedProgress.value;
    return Math.min(100, Math.max(0, (current / targetValueNumber) * 100));
  }, [calculatedProgress.value, targetValueNumber]);

  const hasStrategy = board.goal || board.agentPersona || board.entryTrigger;

  // Abertura do editor via menu ⋮ do board (evento global): é o caminho pra
  // DEFINIR a estratégia quando ela ainda não existe (o header fica oculto).
  React.useEffect(() => {
    const openEditor = () => {
      setEditedBoard(board);
      setIsEditing(true);
    };
    window.addEventListener('crm:board-strategy-edit', openEditor);
    return () => window.removeEventListener('crm:board-strategy-edit', openEditor);
  }, [board]);

  // Board sem estratégia definida: NADA aparece no kanban (sem banner de CTA).
  // O header só renderiza quando a estratégia existe (ou durante a definição).
  if (!hasStrategy && !isEditing) {
    return null;
  }

  const handleSave = async () => {
    // Normaliza antes de gravar: campos só com espaços não contam, e uma seção
    // toda vazia vira null (o service LIMPA as colunas no banco — apagar os
    // textos e salvar é o jeito de excluir aquela parte da estratégia).
    const g = editedBoard.goal;
    const goal =
      g && (g.description?.trim() || g.kpi?.trim() || g.targetValue?.trim())
        ? {
            description: g.description?.trim() || '',
            kpi: g.kpi?.trim() || '',
            targetValue: g.targetValue?.trim() || '',
            type: g.type,
          }
        : null;
    const p = editedBoard.agentPersona;
    const agentPersona =
      p && (p.name?.trim() || p.role?.trim() || p.behavior?.trim())
        ? { name: p.name?.trim() || '', role: p.role?.trim() || '', behavior: p.behavior?.trim() || '' }
        : null;

    setIsSaving(true);
    const ok = await updateBoard(board.id, {
      goal,
      agentPersona,
      entryTrigger: editedBoard.entryTrigger?.trim() || '',
      nextBoardId: editedBoard.nextBoardId,
    });
    setIsSaving(false);
    if (!ok) {
      // Editor continua aberto: nada digitado se perde
      addToast('Não foi possível salvar a estratégia. Tente de novo.', 'error');
      return;
    }
    addToast(goal || agentPersona ? 'Estratégia salva.' : 'Estratégia removida.', 'success');
    setIsEditing(false);
  };

  const handleRemove = async () => {
    if (!window.confirm('Remover a estratégia deste board? Objetivo, agente e regras de entrada serão apagados.')) {
      return;
    }
    setIsSaving(true);
    const ok = await updateBoard(board.id, { goal: null, agentPersona: null, entryTrigger: '' });
    setIsSaving(false);
    if (!ok) {
      addToast('Não foi possível remover a estratégia. Tente de novo.', 'error');
      return;
    }
    addToast('Estratégia removida.', 'success');
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditedBoard(board);
    setIsEditing(false);
  };

  return (
    // Mobile: o card de estratégia (Objetivo/Agente/Entrada) comia meia tela
    // antes do funil; fica oculto, mas o EDITOR (⋮ > Estratégia) segue
    // aparecendo quando aberto.
    <div className={`relative mb-4 group/header z-20 ${isEditing ? '' : 'max-md:hidden'}`}>
      {/* Background Glow Effect (Subtle) */}
      <div className="absolute -inset-1 bg-gradient-to-r from-primary-500/5 via-transparent to-primary-500/5 rounded-xl blur-xl opacity-50 group-hover/header:opacity-100 transition-opacity duration-700"></div>

      <div className="relative px-5 py-3 bg-white dark:bg-dark-card rounded-lg border border-slate-100 dark:border-white/5 shadow-sm transition-all duration-300 hover:shadow-md">
        {/* Edit Button - Only visible on hover */}
        {!isEditing && (
          <button
            onClick={() => {
              // Sempre parte do board ATUAL: o estado inicial do useState fica
              // defasado quando o board recarrega (o editor abria com valores velhos)
              setEditedBoard(board);
              setIsEditing(true);
            }}
            className="absolute top-2 right-2 p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:text-white dark:hover:bg-white/10 rounded-full transition-all opacity-0 group-hover/header:opacity-100"
            title="Editar Estratégia"
          >
            <Edit2 size={12} />
          </button>
        )}

        {isEditing ? (
          // --- EDIT MODE (Functional & Clean) ---
          // --- EDIT MODE (Jobs Style: Clean, Focused, Minimal) ---
          // --- EDIT MODE (Polished & Unified) ---
          <div className="animate-in fade-in zoom-in-95 duration-300">
            {/* Header Actions */}
            <div className="flex justify-between items-center mb-6 border-b border-slate-100 dark:border-white/5 pb-4">
              <div className="flex items-center gap-2">
                <div className="p-1.5 bg-slate-100 dark:bg-white/10 rounded-lg">
                  <Target size={16} className="text-slate-600 dark:text-slate-300" />
                </div>
                <div>
                  <h3 className="font-display font-bold text-sm text-slate-900 dark:text-white">
                    Estratégia do Board
                  </h3>
                  <p className="text-[10px] text-slate-500 font-medium">
                    Defina como a IA deve trabalhar aqui
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {hasStrategy && (
                  <button
                    onClick={handleRemove}
                    disabled={isSaving}
                    className="px-3 py-1.5 text-xs font-medium text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 transition-colors disabled:opacity-50"
                  >
                    Remover estratégia
                  </button>
                )}
                <button
                  onClick={handleCancel}
                  disabled={isSaving}
                  className="px-3 py-1.5 text-xs font-medium text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 transition-colors disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleSave}
                  disabled={isSaving}
                  className="px-4 py-1.5 bg-primary-600 hover:bg-primary-700 text-white text-xs font-bold rounded-lg transition-colors disabled:opacity-60"
                >
                  {isSaving ? 'Salvando...' : 'Salvar Alterações'}
                </button>
              </div>
            </div>

            <div className="space-y-8">
              {/* TOP SECTION: RULES (The Brain) */}
              <div className="space-y-3">
                <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
                  <DoorOpen size={12} /> Regras de Entrada (O Filtro)
                </label>
                <div className="relative">
                  <textarea
                    className="w-full h-24 bg-slate-50 dark:bg-white/5 rounded-xl p-4 text-sm text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary-500/20 resize-none leading-relaxed border border-slate-200 dark:border-white/5 transition-all"
                    placeholder="Descreva as regras para a IA: Quem deve entrar aqui? Quais critérios de qualidade? (ex: Apenas leads B2B com budget > 50k)"
                    value={editedBoard.entryTrigger || ''}
                    onChange={e => setEditedBoard({ ...editedBoard, entryTrigger: e.target.value })}
                  />
                  <div className="absolute bottom-3 right-3 text-[10px] text-slate-400 bg-white/50 dark:bg-black/20 px-2 py-1 rounded-full backdrop-blur-sm">
                    A IA usará isso para filtrar leads
                  </div>
                </div>
              </div>

              {/* BOTTOM SECTION: GOAL & AGENT (Side by Side) */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* LEFT: GOAL (All Goal fields) */}
                <div className="space-y-4 border-r border-slate-100 dark:border-white/5 pr-8">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 flex items-center gap-1.5 border-b border-slate-100 dark:border-white/5 pb-2">
                    <Target size={12} /> Objetivo (O Alvo)
                  </label>

                  {/* KPI Inputs */}
                  <div className="flex gap-4">
                    <div className="flex-1 bg-slate-50 dark:bg-white/5 rounded-xl p-3 border border-slate-200 dark:border-white/5 focus-within:ring-2 focus-within:ring-primary-500/20 transition-all">
                      <div className="flex items-center gap-2 mb-1">
                        <input
                          className="flex-1 bg-transparent text-xl font-bold text-slate-900 dark:text-white placeholder:text-slate-300 dark:placeholder:text-slate-700 focus:outline-none"
                          placeholder="0"
                          value={editedBoard.goal?.targetValue || ''}
                          onChange={e =>
                            setEditedBoard({
                              ...editedBoard,
                              goal: { ...editedBoard.goal!, targetValue: e.target.value },
                            })
                          }
                        />
                        <select
                          className="bg-transparent text-[10px] font-bold uppercase text-slate-400 focus:text-primary-500 focus:outline-none cursor-pointer"
                          value={editedBoard.goal?.type || 'number'}
                          onChange={e =>
                            setEditedBoard({
                              ...editedBoard,
                              goal: {
                                ...editedBoard.goal!,
                                type: e.target.value as 'currency' | 'number' | 'percentage',
                              },
                            })
                          }
                        >
                          <option value="currency">R$ (Valor)</option>
                          <option value="number"># (Qtd)</option>
                          <option value="percentage">% (Taxa)</option>
                        </select>
                      </div>
                      <input
                        className="w-full bg-transparent text-xs font-medium text-slate-500 focus:text-primary-600 focus:outline-none transition-colors border-b border-transparent focus:border-primary-300 pb-0.5"
                        placeholder="Nome do KPI"
                        value={editedBoard.goal?.kpi || ''}
                        onChange={e =>
                          setEditedBoard({
                            ...editedBoard,
                            goal: { ...editedBoard.goal!, kpi: e.target.value },
                          })
                        }
                      />
                    </div>
                    <div className="w-24 opacity-50 pointer-events-none grayscale">
                      <label className="text-[10px] text-slate-400 font-medium block mb-1">
                        Progresso (Auto)
                      </label>
                      <input
                        className="w-full bg-transparent border-b border-slate-200 dark:border-white/10 text-lg font-bold text-slate-700 dark:text-slate-300 focus:outline-none"
                        placeholder="-"
                        readOnly
                        value={calculatedProgress.display}
                      />
                    </div>
                  </div>

                  {/* Goal Context */}
                  <textarea
                    className="w-full h-24 bg-transparent border border-slate-200 dark:border-white/10 rounded-lg p-3 text-xs text-slate-600 dark:text-slate-300 focus:outline-none focus:border-primary-500/50 resize-none transition-all"
                    placeholder="Por que essa meta existe? Qual o contexto estratégico?"
                    value={editedBoard.goal?.description || ''}
                    onChange={e =>
                      setEditedBoard({
                        ...editedBoard,
                        goal: { ...editedBoard.goal!, description: e.target.value },
                      })
                    }
                  />
                </div>

                {/* RIGHT: AGENT (All Agent fields) */}
                <div className="space-y-4 pl-2">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 flex items-center gap-1.5 border-b border-slate-100 dark:border-white/5 pb-2">
                    <Bot size={12} /> Agente (O Executor)
                  </label>

                  {/* Agent Identity */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-[10px] text-slate-400 font-medium">Nome</label>
                      <input
                        className="w-full bg-transparent border-b border-slate-200 dark:border-white/10 py-1 text-sm font-bold text-slate-900 dark:text-white focus:outline-none focus:border-primary-500 transition-colors placeholder:text-slate-300"
                        placeholder="Ex: Ana"
                        value={editedBoard.agentPersona?.name || ''}
                        onChange={e =>
                          setEditedBoard({
                            ...editedBoard,
                            agentPersona: { ...editedBoard.agentPersona!, name: e.target.value },
                          })
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] text-slate-400 font-medium">Cargo</label>
                      <input
                        className="w-full bg-transparent border-b border-slate-200 dark:border-white/10 py-1 text-xs text-slate-500 focus:outline-none focus:border-primary-500 transition-colors placeholder:text-slate-300"
                        placeholder="Ex: Vendedora"
                        value={editedBoard.agentPersona?.role || ''}
                        onChange={e =>
                          setEditedBoard({
                            ...editedBoard,
                            agentPersona: { ...editedBoard.agentPersona!, role: e.target.value },
                          })
                        }
                      />
                    </div>
                  </div>

                  {/* Agent Behavior */}
                  <textarea
                    className="w-full h-24 bg-transparent border border-slate-200 dark:border-white/10 rounded-lg p-3 text-xs text-slate-600 dark:text-slate-300 focus:outline-none focus:border-primary-500/50 resize-none transition-all"
                    placeholder="Como o agente deve agir? (Tom de voz, postura...)"
                    value={editedBoard.agentPersona?.behavior || ''}
                    onChange={e =>
                      setEditedBoard({
                        ...editedBoard,
                        agentPersona: { ...editedBoard.agentPersona!, behavior: e.target.value },
                      })
                    }
                  />
                </div>
              </div>
            </div>
          </div>
        ) : (
          // --- VIEW MODE (Compact & Premium) ---
          <>
            <div className="flex flex-col md:flex-row gap-6 md:items-center">
              {/* GOAL (Hero Section) */}
              {board.goal && (
              <div className="md:flex-[4] md:min-w-0 flex flex-col justify-center md:border-r border-slate-100 dark:border-white/5 md:pr-6 relative last:border-r-0 last:pr-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="flex h-1.5 w-1.5 rounded-full bg-primary-500 animate-pulse"></span>
                  <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400">
                    Objetivo
                  </span>
                </div>

                <div className="flex flex-col mb-2">
                  <h2 className="text-lg md:text-xl font-display font-bold text-slate-900 dark:text-white tracking-tight leading-tight">
                    {board.goal?.targetValue}
                  </h2>
                  <span className="text-xs text-slate-500 dark:text-slate-400 font-medium truncate mt-0.5">
                    {board.goal?.kpi}
                  </span>
                </div>

                {/* Sleek Progress Bar */}
                <div className="relative h-1 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden mb-1">
                  <div
                    className="absolute top-0 left-0 h-full bg-gradient-to-r from-primary-600 to-primary-400 rounded-full transition-all duration-1000 ease-out"
                    style={{ width: `${progress}% ` }}
                  ></div>
                </div>
                <div className="flex justify-between text-[9px] font-medium text-slate-400 uppercase tracking-wider">
                  <span>{calculatedProgress.display} Concluído</span>
                  <div className="group/goal relative cursor-help">
                    <span className="border-b border-dotted border-slate-600 hover:text-primary-500 transition-colors">
                      Detalhes
                    </span>
                    {/* Tooltip for Goal Description */}
                    <div className="absolute left-0 top-full mt-2 hidden group-hover/goal:block w-80 p-4 bg-slate-900 dark:bg-dark-card text-slate-200 text-xs rounded-lg shadow-2xl z-[100] border border-slate-700 dark:border-dark-border max-h-64 overflow-y-auto">
                      {board.goal?.description}
                    </div>
                  </div>
                </div>
              </div>
              )}

              {/* AGENT */}
              {board.agentPersona && (
              <div className="md:flex-[3] md:min-w-0 flex flex-col justify-center md:px-4 md:border-r border-slate-100 dark:border-white/5 relative last:border-r-0">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <Bot size={12} className="text-primary-500" />
                    <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400">
                      Agente
                    </span>
                  </div>
                  {board.agentPersona && (
                    <button
                      onClick={() => setIsGlobalAIOpen(true)}
                      className="text-[10px] font-bold text-primary-600 dark:text-primary-400 hover:bg-primary-500/10 px-2 py-0.5 rounded flex items-center gap-1 transition-colors"
                    >
                      <MessageSquare size={12} /> Falar
                    </button>
                  )}
                </div>

                <div className="group/agent relative">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-0.5 group-hover/agent:text-primary-500 transition-colors cursor-default truncate">
                    {board.agentPersona?.name}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 font-medium truncate">
                    {board.agentPersona?.role}
                  </p>

                  {/* Tooltip for Agent Behavior */}
                  <div className="absolute left-1/2 -translate-x-1/2 top-full mt-2 hidden group-hover/agent:block w-80 p-4 bg-slate-900 dark:bg-dark-card text-slate-200 text-xs rounded-lg shadow-2xl z-[100] border border-slate-700 dark:border-dark-border max-h-64 overflow-y-auto">
                    <p className="font-semibold text-primary-300 mb-1">Comportamento</p>"
                    {board.agentPersona?.behavior}"
                  </div>
                </div>
              </div>
              )}

              {/* TRIGGER */}
              {board.entryTrigger && (
              <div className="md:flex-[5] md:min-w-0 flex flex-col justify-center md:pl-4 relative">
                <div className="flex items-center gap-2 mb-1">
                  <DoorOpen size={12} className="text-orange-500" />
                  <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400">
                    Entrada
                  </span>
                </div>

                <div className="group/trigger relative cursor-help">
                  <p className="text-xs text-slate-600 dark:text-slate-300 line-clamp-2 leading-relaxed">
                    {board.entryTrigger}
                  </p>
                  {/* Tooltip for Full Trigger */}
                  <div className="absolute right-0 top-full mt-2 hidden group-hover/trigger:block w-80 p-4 bg-slate-900 dark:bg-dark-card text-slate-200 text-xs rounded-lg shadow-2xl z-[100] border border-slate-700 dark:border-dark-border max-h-64 overflow-y-auto">
                    {board.entryTrigger}
                  </div>
                </div>
              </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
