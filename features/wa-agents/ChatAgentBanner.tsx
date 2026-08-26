'use client';

/**
 * Faixa do agente de IA no chat do WhatsApp (beta de agentes nativos).
 *
 * Fica logo acima do campo de texto e mostra, em uma linha compacta, o estado
 * do agente nesta conversa com as ações possíveis. Substitui a faixa antiga
 * (só Pausar/Retomar) e continua cobrindo o agente externo (n8n via API),
 * que só sabe pausar e retomar.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Bot, Check, ChevronDown, Loader2, Pause, Play, Square, X } from 'lucide-react';
import type { AgentMinimal, ConversationAiAction, ConversationAiInfo } from '@/lib/wa-agents/types';

const RESUME_FMT = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });

/** Hora (HH:MM, pt-BR, fuso do navegador) em que a pausa termina. '' se a data for inválida. */
export function formatResumeAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return RESUME_FMT.format(d);
}

export type ChatAgentBannerProps = {
  ai: ConversationAiInfo | null;
  agents: AgentMinimal[];
  busy: boolean;
  onAction: (action: ConversationAiAction, agentId?: string) => void;
};

type Tone = 'violet' | 'amber' | 'slate' | 'sky';

const BANNER_TONE: Record<Tone, string> = {
  violet:
    'border-violet-200 dark:border-violet-500/30 bg-violet-50 dark:bg-violet-900/15 text-violet-700 dark:text-violet-300',
  amber:
    'border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-900/15 text-amber-700 dark:text-amber-300',
  slate:
    'border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 text-slate-600 dark:text-slate-300',
  sky: 'border-sky-200 dark:border-sky-500/30 bg-sky-50 dark:bg-sky-900/15 text-sky-700 dark:text-sky-300',
};

const BUTTON_TONE: Record<Tone, string> = {
  violet:
    'border-violet-300 dark:border-violet-500/40 bg-white dark:bg-black/20 hover:bg-violet-100 dark:hover:bg-violet-900/30',
  amber:
    'border-amber-300 dark:border-amber-500/40 bg-white dark:bg-black/20 hover:bg-amber-100 dark:hover:bg-amber-900/30',
  slate:
    'border-slate-300 dark:border-white/15 bg-white dark:bg-black/20 hover:bg-slate-100 dark:hover:bg-white/10',
  sky: 'border-sky-300 dark:border-sky-500/40 bg-white dark:bg-black/20 hover:bg-sky-100 dark:hover:bg-sky-900/30',
};

const BUTTON_BASE =
  'shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-colors disabled:opacity-60 disabled:cursor-not-allowed';

/** Nome do agente para os textos da faixa (nome do cadastro; senão a persona). */
function agentName(ai: ConversationAiInfo): string | null {
  const name = ai.agent?.name?.trim() || ai.agent?.persona_name?.trim() || '';
  return name || null;
}

function ActionButton({
  tone,
  icon,
  label,
  title,
  busy,
  spinning,
  onClick,
  filled = false,
}: {
  tone: Tone;
  icon: React.ReactNode;
  label: string;
  title: string;
  busy: boolean;
  /** Mostra o Loader2 no lugar do ícone (ação em andamento neste botão). */
  spinning: boolean;
  onClick: () => void;
  /** Botão de destaque (fundo sólido), usado em Aprovar. */
  filled?: boolean;
}) {
  const filledCls =
    'border-sky-600 bg-sky-600 hover:bg-sky-700 text-white dark:border-sky-500 dark:bg-sky-500 dark:hover:bg-sky-600';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      title={title}
      className={`${BUTTON_BASE} ${filled ? filledCls : BUTTON_TONE[tone]}`}
    >
      {spinning ? <Loader2 size={12} className="animate-spin" /> : icon}
      {label}
    </button>
  );
}

/**
 * Botão "Iniciar" com menu dos agentes ligados. O menu abre para cima (a faixa
 * fica colada no campo de texto) e fecha com clique/toque fora ou Escape.
 */
function StartAgentMenu({
  agents,
  busy,
  spinning,
  onStart,
  variant,
}: {
  agents: AgentMinimal[];
  busy: boolean;
  spinning: boolean;
  onStart: (agentId: string) => void;
  /** 'discreet' = fora de faixa (sem agente); 'slate' = dentro da faixa cinza (parado). */
  variant: 'discreet' | 'slate';
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const enabledAgents = agents.filter(a => a.enabled);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: Event) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const label = variant === 'discreet' ? 'Iniciar agente de IA' : 'Iniciar';
  const buttonCls =
    variant === 'discreet'
      ? 'inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] font-bold text-slate-500 dark:text-slate-400 hover:text-violet-700 dark:hover:text-violet-300 hover:bg-violet-50 dark:hover:bg-violet-900/20 transition-colors disabled:opacity-60 disabled:cursor-not-allowed'
      : `${BUTTON_BASE} ${BUTTON_TONE.slate}`;

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        disabled={busy}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Escolher um agente de IA para atender esta conversa"
        className={buttonCls}
      >
        {spinning ? (
          <Loader2 size={12} className="animate-spin" />
        ) : variant === 'discreet' ? (
          <Bot size={13} />
        ) : (
          <Play size={12} />
        )}
        {label}
        <ChevronDown size={12} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute left-0 bottom-full mb-1.5 z-20 w-64 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-dark-card p-1.5 shadow-lg"
        >
          <p className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Iniciar com o agente
          </p>
          {enabledAgents.length === 0 ? (
            <p className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">
              Nenhum agente configurado
            </p>
          ) : (
            enabledAgents.map(a => (
              <button
                key={a.id}
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  onStart(a.id);
                }}
                className="w-full flex items-center gap-2 text-left px-3 py-2 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10 transition-colors"
              >
                <Bot size={14} className="shrink-0 text-violet-500" />
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
        </div>
      )}
    </div>
  );
}

export function ChatAgentBanner({ ai, agents, busy, onAction }: ChatAgentBannerProps) {
  // Qual ação foi clicada por último: o Loader2 aparece só nesse botão enquanto busy.
  const [pending, setPending] = useState<ConversationAiAction | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(false);

  const act = (action: ConversationAiAction, agentId?: string) => {
    if (busy) return;
    setPending(action);
    onAction(action, agentId);
  };
  const spinning = (action: ConversationAiAction) => busy && pending === action;

  // Sem agente nesta conversa: só o botão discreto para iniciar um.
  if (!ai) {
    return (
      <div className="flex items-center mb-1.5 px-0.5">
        <StartAgentMenu
          agents={agents}
          busy={busy}
          spinning={spinning('start')}
          onStart={id => act('start', id)}
          variant="discreet"
        />
      </div>
    );
  }

  const name = agentName(ai);
  const external = ai.native === false;

  let tone: Tone;
  let text: string;
  let actions: React.ReactNode = null;
  let details: React.ReactNode = null;

  const pauseBtn = (t: Tone) => (
    <ActionButton
      tone={t}
      icon={<Pause size={12} />}
      label="Pausar"
      title="Pausar o agente: ele para de responder este contato até você retomar"
      busy={busy}
      spinning={spinning('pause')}
      onClick={() => act('pause')}
    />
  );
  const resumeBtn = (t: Tone) => (
    <ActionButton
      tone={t}
      icon={<Play size={12} />}
      label="Retomar"
      title="Retomar: o agente volta a responder este contato"
      busy={busy}
      spinning={spinning('resume')}
      onClick={() => act('resume')}
    />
  );
  const stopBtn = (t: Tone) => (
    <ActionButton
      tone={t}
      icon={<Square size={12} />}
      label="Parar"
      title="Parar o agente nesta conversa: o atendimento fica só com a equipe"
      busy={busy}
      spinning={spinning('stop')}
      onClick={() => act('stop')}
    />
  );

  switch (ai.status) {
    case 'active': {
      tone = 'violet';
      text = external
        ? 'Agente de IA ativo nesta conversa'
        : name
          ? `Agente ${name} ativo nesta conversa`
          : 'Agente de IA ativo nesta conversa';
      actions = (
        <>
          {pauseBtn(tone)}
          {!external && stopBtn(tone)}
        </>
      );
      break;
    }
    case 'paused': {
      tone = 'amber';
      if (external) {
        text = 'Agente de IA pausado (atendimento humano)';
      } else {
        const who = name ? `Agente ${name} pausado` : 'Agente de IA pausado';
        const when = ai.resumeAt ? formatResumeAt(ai.resumeAt) : '';
        text = when ? `${who}, retoma às ${when}` : `${who} até você retomar`;
      }
      actions = (
        <>
          {resumeBtn(tone)}
          {!external && stopBtn(tone)}
        </>
      );
      break;
    }
    case 'awaiting_approval': {
      tone = 'sky';
      const next = ai.approval?.nextAgentName?.trim() || 'outro agente';
      text = `${name ? `Agente ${name}` : 'Agente de IA'} pede aprovação para passar a ${next}`;
      const summary = ai.approval?.summary?.trim() || '';
      actions = external ? null : (
        <>
          {summary && (
            <button
              type="button"
              onClick={() => setSummaryOpen(o => !o)}
              aria-expanded={summaryOpen}
              className={`${BUTTON_BASE} ${BUTTON_TONE.sky}`}
              title="Ver o resumo que o agente deixou para a passagem"
            >
              <ChevronDown
                size={12}
                className={`transition-transform ${summaryOpen ? 'rotate-180' : ''}`}
              />
              {summaryOpen ? 'Ocultar resumo' : 'Ver resumo'}
            </button>
          )}
          <ActionButton
            tone="sky"
            icon={<Check size={12} />}
            label="Aprovar"
            title={`Aprovar: ${next} assume esta conversa agora`}
            busy={busy}
            spinning={spinning('approve')}
            onClick={() => act('approve')}
            filled
          />
          <ActionButton
            tone="sky"
            icon={<X size={12} />}
            label="Recusar"
            title="Recusar: o agente para e a conversa fica com a equipe"
            busy={busy}
            spinning={spinning('reject')}
            onClick={() => act('reject')}
          />
        </>
      );
      details =
        summaryOpen && summary ? (
          <p className="mt-1.5 pt-1.5 border-t border-sky-200/70 dark:border-sky-500/20 text-[11px] font-normal text-sky-800 dark:text-sky-200 whitespace-pre-wrap break-words">
            {summary}
          </p>
        ) : null;
      break;
    }
    case 'stopped':
    default: {
      tone = 'slate';
      text = 'Agente parado nesta conversa';
      actions = external ? null : (
        <StartAgentMenu
          agents={agents}
          busy={busy}
          spinning={spinning('start')}
          onStart={id => act('start', id)}
          variant="slate"
        />
      );
      break;
    }
  }

  return (
    <div className={`mb-1.5 px-3 py-1.5 rounded-xl border text-xs ${BANNER_TONE[tone]}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 font-bold min-w-0">
          <Bot size={13} className="shrink-0" />
          <span className="truncate" title={text}>
            {text}
          </span>
        </span>
        {actions && <span className="inline-flex items-center gap-1.5 shrink-0">{actions}</span>}
      </div>
      {details}
    </div>
  );
}

export default ChatAgentBanner;
