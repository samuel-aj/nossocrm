'use client';

/**
 * Botão "Automações" do compositor do chat (beta de agentes nativos).
 *
 * Fica ao lado do emoji/anexo e abre um popover PARA CIMA (nunca cortado) com
 * os agentes de IA e os robôs ligados. Escolher um abre um passo de confirmação
 * com um campo opcional de contexto adicional para a equipe escrever. Também
 * oferece "Limpar memória do agente nesta conversa" (recomeçar um teste do zero).
 *
 * Pausar/Retomar/Parar continuam na faixa acima do campo de texto (só quando há
 * agente em andamento); iniciar é sempre por aqui.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Bot, ChevronLeft, Eraser, Loader2, Sparkles, Workflow } from 'lucide-react';
import type { AgentMinimal, BotMinimal, ConversationAiInfo, ConversationBotInfo } from '@/lib/wa-agents/types';

export type AutomationStartKind = 'agent' | 'bot';

export type AutomationsMenuProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agents: AgentMinimal[];
  bots: BotMinimal[];
  ai: ConversationAiInfo | null;
  bot: ConversationBotInfo | null;
  busy: boolean;
  /** Há mensagens ou estado de agente nesta conversa (mostra "Limpar memória") */
  hasHistory: boolean;
  onStart: (kind: AutomationStartKind, id: string, context?: string) => void;
  onResetMemory: () => void;
};

const CONTEXT_MAX = 2000;

const ITEM_CLASS =
  'w-full flex items-center gap-2 text-left px-3 py-2 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10 transition-colors disabled:opacity-60';
const SECTION_CLASS = 'px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400';
const BTN_PRIMARY =
  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-60 disabled:cursor-not-allowed transition-colors';
const BTN_GHOST =
  'inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10 transition-colors disabled:opacity-60';

export function AutomationsMenu({
  open,
  onOpenChange,
  agents,
  bots,
  ai,
  bot,
  busy,
  hasHistory,
  onStart,
  onResetMemory,
}: AutomationsMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  // Passo de confirmação: qual item foi escolhido (ou "reset" para limpar memória)
  const [picked, setPicked] = useState<{ kind: AutomationStartKind; id: string; name: string } | 'reset' | null>(null);
  const [showContext, setShowContext] = useState(false);
  const [context, setContext] = useState('');

  const enabledAgents = useMemo(() => agents.filter(a => a.enabled), [agents]);
  const enabledBots = useMemo(() => bots.filter(b => b.enabled), [bots]);

  // Agente em andamento (ativo/pausado/aguardando) ou robô rodando: não dá para iniciar outro por aqui
  const agentLive = !!ai && ai.status !== 'stopped';
  const running = agentLive || !!bot;

  // Fecha com clique fora ou Escape; ao fechar, volta para a lista
  useEffect(() => {
    if (!open) {
      setPicked(null);
      setShowContext(false);
      setContext('');
      return;
    }
    const onDown = (e: Event) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOpenChange(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onOpenChange]);

  const start = () => {
    if (!picked || picked === 'reset' || busy) return;
    const ctx = context.trim();
    // contexto adicional só para o agente de IA (o robô usa só o card e a conversa)
    onStart(picked.kind, picked.id, picked.kind === 'agent' && ctx ? ctx.slice(0, CONTEXT_MAX) : undefined);
    onOpenChange(false);
  };

  const runningText = bot
    ? `Robô ${bot.name} em andamento: cancele na faixa acima para iniciar outro.`
    : ai?.agent?.name
      ? `Agente ${ai.agent.name} em andamento: use Pausar ou Parar na faixa acima para trocar.`
      : 'Agente de IA em andamento: use Pausar ou Parar na faixa acima para trocar.';

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        disabled={busy}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Automações"
        title="Automações: iniciar um agente de IA ou um robô nesta conversa"
        className={`shrink-0 h-10 w-10 inline-flex items-center justify-center rounded-xl transition-colors ${
          open
            ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600'
            : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10'
        }`}
      >
        {busy ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Automações"
          className="absolute bottom-full left-0 mb-2 z-20 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-dark-card p-1.5 shadow-lg"
        >
          {picked === null ? (
            <>
              <p className="px-3 py-1.5 text-xs font-bold text-slate-700 dark:text-slate-200 inline-flex items-center gap-1.5">
                <Sparkles size={13} className="text-emerald-500" /> Automações
              </p>
              {running ? (
                <p className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">{runningText}</p>
              ) : (
                <div className="max-h-72 overflow-y-auto">
                  <p className={SECTION_CLASS}>Agentes de IA</p>
                  {enabledAgents.length === 0 ? (
                    <p className="px-3 pb-2 text-xs text-slate-500 dark:text-slate-400">
                      Nenhum agente configurado. Crie em Configurações → Agentes.
                    </p>
                  ) : (
                    enabledAgents.map(a => (
                      <button
                        key={a.id}
                        type="button"
                        role="menuitem"
                        disabled={busy}
                        onClick={() => setPicked({ kind: 'agent', id: a.id, name: a.name })}
                        className={ITEM_CLASS}
                      >
                        <Bot size={15} className="shrink-0 text-violet-500" />
                        <span className="flex-1 min-w-0">
                          <span className="block text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">
                            {a.name}
                          </span>
                          {a.persona_name && (
                            <span className="block text-xs text-slate-500 dark:text-slate-400 truncate">
                              Persona: {a.persona_name}
                            </span>
                          )}
                        </span>
                      </button>
                    ))
                  )}
                  <p className={SECTION_CLASS}>Robôs</p>
                  {enabledBots.length === 0 ? (
                    <p className="px-3 pb-2 text-xs text-slate-500 dark:text-slate-400">
                      Nenhum robô configurado. Crie em Configurações → Agentes → Robôs.
                    </p>
                  ) : (
                    enabledBots.map(b => (
                      <button
                        key={b.id}
                        type="button"
                        role="menuitem"
                        disabled={busy}
                        onClick={() => setPicked({ kind: 'bot', id: b.id, name: b.name })}
                        className={ITEM_CLASS}
                      >
                        <Workflow size={15} className="shrink-0 text-emerald-500" />
                        <span className="block text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">
                          {b.name}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              )}
              {hasHistory && (
                <div className="mt-1 pt-1 border-t border-slate-200 dark:border-white/10">
                  <button
                    type="button"
                    role="menuitem"
                    disabled={busy}
                    onClick={() => setPicked('reset')}
                    className={`${ITEM_CLASS} text-xs text-slate-500 dark:text-slate-400`}
                    title="O agente esquece esta conversa e para; o histórico do chat continua visível"
                  >
                    <Eraser size={14} className="shrink-0" /> Limpar memória do agente nesta conversa
                  </button>
                </div>
              )}
            </>
          ) : picked === 'reset' ? (
            <div className="p-2">
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">Limpar memória do agente?</p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                O agente vai esquecer esta conversa e parar; o histórico do chat continua visível para a equipe.
                Se ele estiver em andamento, para também.
              </p>
              <div className="flex items-center justify-end gap-2 mt-3">
                <button type="button" className={BTN_GHOST} disabled={busy} onClick={() => setPicked(null)}>
                  <ChevronLeft size={13} /> Voltar
                </button>
                <button
                  type="button"
                  className={BTN_PRIMARY}
                  disabled={busy}
                  onClick={() => {
                    onResetMemory();
                    onOpenChange(false);
                  }}
                >
                  {busy ? <Loader2 size={13} className="animate-spin" /> : <Eraser size={13} />} Limpar
                </button>
              </div>
            </div>
          ) : (
            <div className="p-2">
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 inline-flex items-center gap-1.5">
                {picked.kind === 'agent' ? (
                  <Bot size={15} className="text-violet-500" />
                ) : (
                  <Workflow size={15} className="text-emerald-500" />
                )}
                Iniciar {picked.name}
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {picked.kind === 'agent'
                  ? 'O agente já recebe os dados do card (campos, etapa, histórico da conversa).'
                  : 'O robô usa os dados do card e da conversa.'}
              </p>
              {picked.kind === 'agent' && showContext ? (
                <div className="mt-2">
                  <label htmlFor="automations-context" className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                    Contexto adicional (opcional)
                  </label>
                  <textarea
                    id="automations-context"
                    value={context}
                    onChange={e => setContext(e.target.value.slice(0, CONTEXT_MAX))}
                    rows={3}
                    maxLength={CONTEXT_MAX}
                    autoFocus
                    placeholder="Ex.: cliente já mandou os documentos por e-mail; priorizar agendamento"
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/20 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-y"
                  />
                  <p className="text-[10px] text-slate-400 text-right">
                    {context.length}/{CONTEXT_MAX}
                  </p>
                </div>
              ) : picked.kind === 'agent' ? (
                <button
                  type="button"
                  onClick={() => setShowContext(true)}
                  className="mt-2 text-xs font-semibold text-emerald-700 dark:text-emerald-300 hover:underline"
                >
                  + Adicionar contexto (opcional)
                </button>
              ) : null}
              <div className="flex items-center justify-end gap-2 mt-3">
                <button type="button" className={BTN_GHOST} disabled={busy} onClick={() => setPicked(null)}>
                  <ChevronLeft size={13} /> Voltar
                </button>
                <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={start}>
                  {busy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} Iniciar
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default AutomationsMenu;
