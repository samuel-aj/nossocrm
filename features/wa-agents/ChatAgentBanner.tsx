'use client';

/**
 * Faixa do agente de IA e do robô no chat do WhatsApp (beta de agentes nativos).
 *
 * Fica logo acima do campo de texto e mostra, em linhas compactas, o estado
 * do agente e do robô nesta conversa com as ações possíveis. Substitui a faixa
 * antiga (só Pausar/Retomar) e continua cobrindo o agente externo (n8n via API),
 * que aqui também pode ser parado e trocado por um agente nativo ou um robô.
 */

import React, { useEffect, useId, useRef, useState } from 'react';
import { Bot, Check, ChevronDown, Loader2, Pause, Play, Square, Workflow, X } from 'lucide-react';
import type {
  AgentMinimal,
  BotMinimal,
  ConversationAiAction,
  ConversationAiInfo,
  ConversationBotInfo,
} from '@/lib/wa-agents/types';

const RESUME_FMT = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });

/** Hora (HH:MM, pt-BR, fuso do navegador) em que a pausa termina. '' se a data for inválida. */
export function formatResumeAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return RESUME_FMT.format(d);
}

export type ChatAgentBannerProps = {
  ai: ConversationAiInfo | null;
  /** Robô em andamento nesta conversa (null = nenhum) */
  bot: ConversationBotInfo | null;
  agents: AgentMinimal[];
  bots: BotMinimal[];
  busy: boolean;
  /** `id` = agentId em "start"; botId em "start_bot"; ausente nas demais ações. */
  onAction: (action: ConversationAiAction, id?: string) => void;
};

type Tone = 'violet' | 'amber' | 'slate' | 'sky' | 'emerald';

const BANNER_TONE: Record<Tone, string> = {
  violet:
    'border-violet-200 dark:border-violet-500/30 bg-violet-50 dark:bg-violet-900/15 text-violet-700 dark:text-violet-300',
  amber:
    'border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-900/15 text-amber-700 dark:text-amber-300',
  slate:
    'border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 text-slate-600 dark:text-slate-300',
  sky: 'border-sky-200 dark:border-sky-500/30 bg-sky-50 dark:bg-sky-900/15 text-sky-700 dark:text-sky-300',
  emerald:
    'border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-900/15 text-emerald-700 dark:text-emerald-300',
};

const BUTTON_TONE: Record<Tone, string> = {
  violet:
    'border-violet-300 dark:border-violet-500/40 bg-white dark:bg-black/20 hover:bg-violet-100 dark:hover:bg-violet-900/30',
  amber:
    'border-amber-300 dark:border-amber-500/40 bg-white dark:bg-black/20 hover:bg-amber-100 dark:hover:bg-amber-900/30',
  slate:
    'border-slate-300 dark:border-white/15 bg-white dark:bg-black/20 hover:bg-slate-100 dark:hover:bg-white/10',
  sky: 'border-sky-300 dark:border-sky-500/40 bg-white dark:bg-black/20 hover:bg-sky-100 dark:hover:bg-sky-900/30',
  emerald:
    'border-emerald-300 dark:border-emerald-500/40 bg-white dark:bg-black/20 hover:bg-emerald-100 dark:hover:bg-emerald-900/30',
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

/** Item do menu de início (agente ou robô). */
function StartMenuItem({
  icon,
  name,
  subtitle,
  onClick,
}: {
  icon: React.ReactNode;
  name: string;
  subtitle?: string | null;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="w-full flex items-center gap-2 text-left px-3 py-2 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10 transition-colors"
    >
      {icon}
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">{name}</span>
        {subtitle && (
          <span className="block text-xs text-slate-500 dark:text-slate-400 truncate">{subtitle}</span>
        )}
      </span>
    </button>
  );
}

/**
 * Botão "Iniciar" com menu em duas seções: agentes de IA ligados e robôs
 * ligados. O menu abre para cima (a faixa fica colada no campo de texto) e
 * fecha com clique/toque fora ou Escape.
 */
function StartMenu({
  agents,
  bots,
  busy,
  spinning,
  onStartAgent,
  onStartBot,
  variant,
}: {
  agents: AgentMinimal[];
  bots: BotMinimal[];
  busy: boolean;
  spinning: boolean;
  onStartAgent: (agentId: string) => void;
  onStartBot: (botId: string) => void;
  /** 'discreet' = fora de faixa (sem agente nem robô); senão o tom da faixa em que o botão está. */
  variant: 'discreet' | Tone;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const agentsHeadingId = useId();
  const botsHeadingId = useId();
  const enabledAgents = agents.filter(a => a.enabled);
  const enabledBots = bots.filter(b => b.enabled);

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

  const discreet = variant === 'discreet';
  const label = discreet ? 'Iniciar agente ou robô' : 'Iniciar';
  const buttonCls = discreet
    ? 'inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] font-bold text-slate-500 dark:text-slate-400 hover:text-violet-700 dark:hover:text-violet-300 hover:bg-violet-50 dark:hover:bg-violet-900/20 transition-colors disabled:opacity-60 disabled:cursor-not-allowed'
    : `${BUTTON_BASE} ${BUTTON_TONE[variant]}`;
  const sectionTitleCls = 'px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400';
  const emptyCls = 'px-3 py-2 text-xs text-slate-500 dark:text-slate-400';

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        disabled={busy}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Escolher um agente de IA ou um robô para atender esta conversa"
        className={buttonCls}
      >
        {spinning ? (
          <Loader2 size={12} className="animate-spin" />
        ) : discreet ? (
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
          aria-label="Iniciar agente ou robô"
          className="absolute left-0 bottom-full mb-1.5 z-20 w-64 max-h-80 overflow-y-auto rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-dark-card p-1.5 shadow-lg"
        >
          <div role="group" aria-labelledby={agentsHeadingId}>
            <p id={agentsHeadingId} className={sectionTitleCls}>
              Agentes de IA
            </p>
            {enabledAgents.length === 0 ? (
              <p className={emptyCls}>Nenhum agente configurado</p>
            ) : (
              enabledAgents.map(a => (
                <StartMenuItem
                  key={a.id}
                  icon={<Bot size={14} className="shrink-0 text-violet-500" />}
                  name={a.name}
                  subtitle={a.persona_name ? `Persona: ${a.persona_name}` : null}
                  onClick={() => {
                    setOpen(false);
                    onStartAgent(a.id);
                  }}
                />
              ))
            )}
          </div>
          <div
            role="group"
            aria-labelledby={botsHeadingId}
            className="mt-1 pt-1 border-t border-slate-100 dark:border-white/10"
          >
            <p id={botsHeadingId} className={sectionTitleCls}>
              Robôs
            </p>
            {enabledBots.length === 0 ? (
              <p className={emptyCls}>Nenhum robô configurado</p>
            ) : (
              enabledBots.map(b => (
                <StartMenuItem
                  key={b.id}
                  icon={<Workflow size={14} className="shrink-0 text-emerald-500" />}
                  name={b.name}
                  onClick={() => {
                    setOpen(false);
                    onStartBot(b.id);
                  }}
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Uma linha da faixa: ícone + texto (truncado) à esquerda, ações à direita, detalhes opcionais abaixo. */
function BannerLine({
  tone,
  icon,
  text,
  actions,
  details,
}: {
  tone: Tone;
  icon: React.ReactNode;
  text: string;
  actions: React.ReactNode;
  details?: React.ReactNode;
}) {
  return (
    <div className={`mb-1.5 px-3 py-1.5 rounded-xl border text-xs ${BANNER_TONE[tone]}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 font-bold min-w-0">
          {icon}
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

export function ChatAgentBanner({ ai, bot, agents, bots, busy, onAction }: ChatAgentBannerProps) {
  // Qual ação foi clicada por último: o Loader2 aparece só nesse botão enquanto busy.
  const [pending, setPending] = useState<ConversationAiAction | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(false);

  const act = (action: ConversationAiAction, id?: string) => {
    if (busy) return;
    setPending(action);
    onAction(action, id);
  };
  const spinning = (action: ConversationAiAction) => busy && pending === action;

  const startMenu = (variant: 'discreet' | Tone) => (
    <StartMenu
      agents={agents}
      bots={bots}
      busy={busy}
      spinning={spinning('start') || spinning('start_bot')}
      onStartAgent={id => act('start', id)}
      onStartBot={id => act('start_bot', id)}
      variant={variant}
    />
  );

  // Sem agente e sem robô nesta conversa: só o botão discreto para iniciar um.
  if (!ai && !bot) {
    return <div className="flex items-center mb-1.5 px-0.5">{startMenu('discreet')}</div>;
  }

  // Linha do robô em andamento: vem primeiro e traz o menu de início (trocar por
  // agente ou por outro robô). Com robô, a linha do agente só aparece se ele
  // ainda estiver atuando (ativo, pausado ou pedindo aprovação).
  const botLine = bot ? (
    <BannerLine
      tone="emerald"
      icon={<Workflow size={13} className="shrink-0" />}
      text={
        bot.status === 'waiting_reply'
          ? `Robô ${bot.name} aguardando resposta do contato`
          : `Robô ${bot.name} em andamento`
      }
      actions={
        <>
          <ActionButton
            tone="emerald"
            icon={<Square size={12} />}
            label="Cancelar robô"
            title="Cancelar o robô nesta conversa: ele para de executar os passos"
            busy={busy}
            spinning={spinning('cancel_bot')}
            onClick={() => act('cancel_bot')}
          />
          {startMenu('emerald')}
        </>
      }
    />
  ) : null;

  let agentLine: React.ReactNode = null;
  if (ai && (!bot || ai.status !== 'stopped')) {
    const name = agentName(ai);
    const external = ai.native === false;
    // Com a linha do robô acima, o menu de início já está lá: não repete na linha do agente.
    const menuHere = !bot;

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
          ? 'Agente de IA externo ativo nesta conversa'
          : name
            ? `Agente ${name} ativo nesta conversa`
            : 'Agente de IA ativo nesta conversa';
        actions = (
          <>
            {pauseBtn(tone)}
            {stopBtn(tone)}
            {menuHere && startMenu(tone)}
          </>
        );
        break;
      }
      case 'paused': {
        tone = 'amber';
        if (external) {
          text = 'Agente de IA externo pausado (atendimento humano)';
        } else {
          const who = name ? `Agente ${name} pausado` : 'Agente de IA pausado';
          const when = ai.resumeAt ? formatResumeAt(ai.resumeAt) : '';
          text = when ? `${who}, retoma às ${when}` : `${who} até você retomar`;
        }
        actions = (
          <>
            {resumeBtn(tone)}
            {stopBtn(tone)}
            {menuHere && startMenu(tone)}
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
        actions = menuHere ? startMenu('slate') : null;
        break;
      }
    }

    agentLine = (
      <BannerLine
        tone={tone}
        icon={<Bot size={13} className="shrink-0" />}
        text={text}
        actions={actions}
        details={details}
      />
    );
  }

  return (
    <>
      {botLine}
      {agentLine}
    </>
  );
}

export default ChatAgentBanner;
