'use client';

/**
 * Catálogo de blocos: ícone, cor e dica de cada tipo, e a lista clicável usada
 * pela paleta e pelo botão "+ Adicionar bloco" do balão (mesmo catálogo nos
 * dois lugares). Separado de nodes.tsx para a paleta não depender dos nós.
 */
import React from 'react';
import {
  Bot,
  ClipboardList,
  Clock,
  Flag,
  GitBranch,
  Keyboard,
  MessageCircle,
  MessageSquareReply,
  MoveRight,
  Tag,
  Webhook,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { DND_MIME, STEP_LABELS, STEP_TYPES, type StepType } from './types';

export type NodeTone = 'amber' | 'green' | 'sky' | 'blue' | 'purple' | 'pink' | 'orange' | 'slate' | 'red';

const TONE_CLASS: Record<NodeTone, string> = {
  amber: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  green: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  sky: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300',
  blue: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  purple: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  pink: 'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300',
  orange: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
  slate: 'bg-slate-100 text-slate-700 dark:bg-white/10 dark:text-slate-200',
  red: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
};

/** Classes do ícone colorido de um tom. */
export function toneClass(tone: NodeTone): string {
  return TONE_CLASS[tone];
}

export type NodeMeta = { label: string; icon: LucideIcon; tone: NodeTone; color: string; hint: string };

/** Rótulo, ícone, cor (minimapa) e dica de cada tipo de bloco. */
export const NODE_META: Record<StepType, NodeMeta> = {
  send_text: {
    label: STEP_LABELS.send_text,
    icon: MessageCircle,
    tone: 'green',
    color: '#22c55e',
    hint: 'Envia um texto pelo WhatsApp',
  },
  send_template: {
    label: STEP_LABELS.send_template,
    icon: ClipboardList,
    tone: 'green',
    color: '#16a34a',
    hint: 'Envia um modelo aprovado do WhatsApp API (vale fora das 24 h, com botões)',
  },
  wait: { label: STEP_LABELS.wait, icon: Clock, tone: 'sky', color: '#0ea5e9', hint: 'Aguarda um tempo antes de seguir' },
  typing: { label: STEP_LABELS.typing, icon: Keyboard, tone: 'sky', color: '#38bdf8', hint: 'Mostra "digitando..." por alguns segundos' },
  wait_reply: {
    label: STEP_LABELS.wait_reply,
    icon: MessageSquareReply,
    tone: 'blue',
    color: '#3b82f6',
    hint: 'Espera o lead responder, com prazo',
  },
  condition: {
    label: STEP_LABELS.condition,
    icon: GitBranch,
    tone: 'purple',
    color: '#a855f7',
    hint: 'Escolhe o caminho pela resposta do lead',
  },
  move_stage: {
    label: STEP_LABELS.move_stage,
    icon: MoveRight,
    tone: 'orange',
    color: '#f97316',
    hint: 'Move o negócio para uma etapa',
  },
  add_tag: { label: STEP_LABELS.add_tag, icon: Tag, tone: 'pink', color: '#ec4899', hint: 'Adiciona um rótulo ao negócio' },
  webhook: { label: STEP_LABELS.webhook, icon: Webhook, tone: 'slate', color: '#64748b', hint: 'Chama uma URL externa' },
  handoff_agent: {
    label: STEP_LABELS.handoff_agent,
    icon: Bot,
    tone: 'purple',
    color: '#7c3aed',
    hint: 'Um agente de IA assume a conversa',
  },
  start_bot: {
    label: STEP_LABELS.start_bot,
    icon: Workflow,
    tone: 'amber',
    color: '#f59e0b',
    hint: 'Encerra este robô e inicia outro na mesma conversa',
  },
  end: { label: STEP_LABELS.end, icon: Flag, tone: 'red', color: '#ef4444', hint: 'Encerra o robô' },
};

/** Ícone colorido de um tipo de bloco. */
export function BlockIcon({ type, size = 14 }: { type: StepType; size?: number }) {
  const meta = NODE_META[type];
  const Icon = meta.icon;
  return (
    <span className={`p-1 rounded-md shrink-0 ${TONE_CLASS[meta.tone]}`} aria-hidden="true">
      <Icon size={size} />
    </span>
  );
}

/**
 * Lista de tipos de bloco. `onPick` recebe o tipo clicado; com `draggable`, o
 * item também pode ser arrastado (para o quadro ou para um balão).
 * `iconsOnly` mostra só os ícones (paleta recolhida); `horizontal` deita a lista
 * (barra inferior no celular).
 */
export function BlockCatalog({
  onPick,
  draggable = false,
  iconsOnly = false,
  horizontal = false,
  disabledReason = null,
}: {
  onPick: (type: StepType) => void;
  draggable?: boolean;
  iconsOnly?: boolean;
  horizontal?: boolean;
  disabledReason?: string | null;
}) {
  return (
    <div className={horizontal ? 'flex gap-1' : 'flex flex-col gap-0.5'} role="group" aria-label="Tipos de bloco">
      {STEP_TYPES.map((type) => {
        const meta = NODE_META[type];
        const Icon = meta.icon;
        const title = disabledReason ?? `${meta.hint}. Clique para adicionar${draggable ? ' ou arraste para o quadro' : ''}.`;
        return (
          // div em vez de button: o Firefox não inicia o arrasto nativo a partir de <button draggable>.
          <div
            key={type}
            role="button"
            tabIndex={disabledReason ? -1 : 0}
            draggable={draggable && !disabledReason}
            aria-disabled={disabledReason ? true : undefined}
            onDragStart={(e) => {
              e.dataTransfer.setData(DND_MIME, type);
              e.dataTransfer.effectAllowed = 'copy';
            }}
            onClick={() => {
              if (!disabledReason) onPick(type);
            }}
            onKeyDown={(e) => {
              if (disabledReason) return;
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onPick(type);
              }
            }}
            title={title}
            aria-label={iconsOnly ? meta.label : undefined}
            className={`shrink-0 inline-flex items-center gap-2 rounded-lg text-sm text-left text-slate-700 dark:text-slate-200 select-none outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40 transition-colors ${
              horizontal ? 'flex-col gap-1 px-2 py-1.5 min-w-[64px] text-[10px] leading-tight text-center' : iconsOnly ? 'p-1.5 justify-center' : 'px-2.5 py-2'
            } ${
              disabledReason
                ? 'opacity-40 cursor-not-allowed'
                : `hover:bg-slate-100 dark:hover:bg-white/10 ${draggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'}`
            }`}
          >
            <span className={`p-1 rounded-md shrink-0 ${TONE_CLASS[meta.tone]}`} aria-hidden="true">
              <Icon size={horizontal ? 16 : 14} />
            </span>
            {iconsOnly ? null : <span className={horizontal ? 'whitespace-nowrap' : 'whitespace-nowrap'}>{meta.label}</span>}
          </div>
        );
      })}
    </div>
  );
}
