'use client';

/**
 * Peças visuais compartilhadas das telas de Agentes de IA e Robôs.
 * Segue o visual da Central de I.A (AIConfigSection).
 */
import React, { useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, ChevronRight, ChevronUp, Copy, GripVertical, HelpCircle, Loader2, MoreHorizontal, X } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { CopyId } from '@/components/ui/CopyId';

export const CARD_CLASS =
  'bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-xl p-4 shadow-sm space-y-4';

export const INPUT_CLASS =
  'w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 outline-none';

export const TEXTAREA_CLASS = `${INPUT_CLASS} resize-y`;

export const BTN_PRIMARY =
  'inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-purple-600 hover:bg-purple-700 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors';

export const BTN_SECONDARY =
  'inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors';

export const BTN_DANGER =
  'inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border border-red-200 dark:border-red-500/30 bg-white dark:bg-white/5 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors';

export const BTN_SMALL =
  'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors';

export const BTN_ICON =
  'p-2 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-white dark:hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors';

export const LABEL_CLASS = 'block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1';

export const HELP_CLASS = 'text-xs text-slate-500 dark:text-slate-400 mt-1';

export const SUBCARD_CLASS =
  'bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-white/10 rounded-lg p-3 space-y-3';

/** Interruptor liga/desliga no padrão da Central de I.A. */
export function Toggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <label className={`relative inline-flex items-center ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
      <input
        type="checkbox"
        className="sr-only peer"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={label}
      />
      <div className="w-11 h-6 bg-slate-300 dark:bg-slate-700 rounded-full peer peer-focus:ring-2 peer-focus:ring-purple-500/30 peer-disabled:opacity-50 peer-checked:bg-green-500 dark:peer-checked:bg-green-600 after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:border after:border-gray-300 after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-full peer-checked:after:border-white" />
    </label>
  );
}

/**
 * Ícone "?" com a explicação secundária num balão (passa o mouse ou toca).
 * Serve para tirar os textos de ajuda de baixo dos campos sem perder a informação.
 */
export function InfoTip({ text, label = 'Mais informações' }: { text: React.ReactNode; label?: string }) {
  // Controlado para abrir também no toque (o balão do radix só abre no hover/foco).
  const [open, setOpen] = useState(false);
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip open={open} onOpenChange={setOpen}>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={label}
            onClick={() => setOpen((v) => !v)}
            className="inline-flex items-center justify-center rounded-full text-slate-400 hover:text-purple-600 dark:hover:text-purple-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-500/40 transition-colors align-middle"
          >
            <HelpCircle size={14} aria-hidden="true" />
          </button>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          className="max-w-xs rounded-lg border-0 bg-slate-900 px-3 py-2 text-xs leading-relaxed text-white shadow-xl dark:bg-slate-700"
        >
          {text}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/** Rótulo + campo + texto de ajuda (ou um balão "?" ao lado do rótulo). */
export function Field({
  label,
  htmlFor,
  help,
  tip,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  help?: React.ReactNode;
  /** Explicação secundária, num balão ao lado do rótulo */
  tip?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className={`${LABEL_CLASS} ${tip ? 'inline-flex items-center gap-1.5' : ''}`}>
        {label}
        {tip ? <InfoTip text={tip} label={`Sobre ${label}`} /> : null}
      </label>
      {children}
      {help ? <p className={HELP_CLASS}>{help}</p> : null}
    </div>
  );
}

/**
 * Linha de configuração: título (com balão opcional) à esquerda e o controle
 * (interruptor, seletor) à direita. Várias em sequência formam uma lista compacta.
 */
export function SettingRow({
  title,
  description,
  tip,
  control,
  children,
}: {
  title: string;
  /** Uma linha curta abaixo do título, só quando for mesmo necessária */
  description?: React.ReactNode;
  tip?: React.ReactNode;
  control?: React.ReactNode;
  /** Conteúdo extra abaixo da linha (aparece só quando a opção está ligada, por exemplo) */
  children?: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-800 dark:text-slate-200 inline-flex items-center gap-1.5">
            {title}
            {tip ? <InfoTip text={tip} label={`Sobre ${title}`} /> : null}
          </p>
          {description ? <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{description}</p> : null}
        </div>
        {control ? <div className="shrink-0">{control}</div> : null}
      </div>
      {children}
    </div>
  );
}

/** Divisor fino entre linhas de configuração dentro do mesmo cartão. */
export const ROW_DIVIDER_CLASS = 'divide-y divide-slate-100 dark:divide-white/5 [&>*]:py-3 [&>*:first-child]:pt-0 [&>*:last-child]:pb-0';

/** Controle segmentado: uma escolha entre poucas opções, todas visíveis. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string; icon?: React.ReactNode }>;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={`inline-flex max-w-full flex-wrap gap-1 rounded-lg bg-slate-100 dark:bg-white/5 p-1 ${className ?? ''}`}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-500/40 ${
              active
                ? 'bg-white dark:bg-slate-800 text-purple-700 dark:text-purple-300 shadow-sm'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            {o.icon}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// Menu "..." e bloco recolhido são compartilhados com Configurações e boards.
export { KebabMenu, type KebabItem } from '@/components/ui/KebabMenu';
export { Disclosure } from '@/components/ui/Disclosure';

/** Seção colapsável do editor. */
export function Section({
  title,
  description,
  icon,
  defaultOpen = true,
  children,
}: {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  // Abre sozinha quando `defaultOpen` passa a valer depois de montada (ex.: a IA preencheu a lista
  // de uma seção recolhida); nunca fecha sozinha, para não sumir com o que o usuário está editando.
  const [lastDefaultOpen, setLastDefaultOpen] = useState(defaultOpen);
  if (defaultOpen !== lastDefaultOpen) {
    setLastDefaultOpen(defaultOpen);
    if (defaultOpen) setOpen(true);
  }
  const bodyId = useId();
  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-xl shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={bodyId}
        className="w-full flex items-center justify-between gap-3 p-4 text-left"
      >
        <span className="flex items-center gap-3 min-w-0">
          {icon ? (
            <span className="p-1.5 bg-purple-100 dark:bg-purple-900/20 rounded-lg text-purple-600 dark:text-purple-400 shrink-0">
              {icon}
            </span>
          ) : null}
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-slate-900 dark:text-white">{title}</span>
            {description ? (
              <span className="block text-xs text-slate-500 dark:text-slate-400 mt-0.5">{description}</span>
            ) : null}
          </span>
        </span>
        <span className="text-slate-400 shrink-0" aria-hidden="true">
          {open ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </span>
      </button>
      {open ? (
        <div id={bodyId} className="px-4 pb-4 space-y-4 border-t border-slate-100 dark:border-white/5 pt-4">
          {children}
        </div>
      ) : null}
    </div>
  );
}

/** Etiqueta pequena colorida. */
export function Badge({
  children,
  tone = 'slate',
}: {
  children: React.ReactNode;
  tone?: 'slate' | 'green' | 'amber' | 'red' | 'purple' | 'blue';
}) {
  const tones: Record<string, string> = {
    slate: 'bg-slate-100 text-slate-700 dark:bg-white/10 dark:text-slate-200',
    green: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
    amber: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
    red: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
    purple: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
    blue: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold ${tones[tone]}`}>
      {children}
    </span>
  );
}

/** Estado vazio de uma lista. */
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="bg-white dark:bg-slate-900 border border-dashed border-slate-300 dark:border-white/10 rounded-xl p-8 text-center">
      {icon ? (
        <div className="mx-auto w-12 h-12 rounded-full bg-purple-100 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400 flex items-center justify-center mb-3">
          {icon}
        </div>
      ) : null}
      <h3 className="text-base font-semibold text-slate-900 dark:text-white">{title}</h3>
      {description ? <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{description}</p> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

/** Indicador de carregamento em linha. */
export function Spinner({ label = 'Carregando...' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400" role="status">
      <Loader2 size={16} className="animate-spin" aria-hidden="true" />
      {label}
    </div>
  );
}

/** Aviso destacado. */
export function Notice({
  tone = 'amber',
  children,
}: {
  tone?: 'amber' | 'blue' | 'red';
  children: React.ReactNode;
}) {
  const tones: Record<string, string> = {
    amber:
      'border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-900/15 text-amber-800 dark:text-amber-200',
    blue: 'border-blue-200 dark:border-blue-500/30 bg-blue-50 dark:bg-blue-900/15 text-blue-800 dark:text-blue-200',
    red: 'border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-900/15 text-red-800 dark:text-red-200',
  };
  return <div className={`rounded-lg border px-3 py-2 text-sm ${tones[tone]}`}>{children}</div>;
}

/** Data/hora curta em pt-BR. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Mensagem de erro legível a partir de um unknown. */
export function errorMessage(err: unknown, fallback = 'Algo deu errado'): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string' && err) return err;
  return fallback;
}

/** Mensagem em pt-BR para um problema de validação do zod, pelo código do problema. */
export function describeZodIssue(issue: { code?: string; message: string }): string {
  switch (issue.code) {
    case 'invalid_type':
      return 'valor inválido';
    case 'too_small':
      return 'valor muito pequeno ou obrigatório';
    case 'too_big':
      return 'valor muito grande';
    case 'invalid_format':
    case 'invalid_string':
      return 'formato inválido (ex.: URL ou identificador)';
    case 'invalid_value':
    case 'invalid_enum_value':
      return 'opção inválida';
    default:
      return issue.message;
  }
}

/** Id curto para itens criados no navegador. */
export function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Tamanho de arquivo legível em pt-BR (B, KB, MB). */
export function formatBytes(n: number | null | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return '';
  if (n < 1024) return `${n} B`;
  const kb = n / 1024;
  if (kb < 1024) return `${kb.toLocaleString('pt-BR', { maximumFractionDigits: kb < 10 ? 1 : 0 })} KB`;
  const mb = kb / 1024;
  return `${mb.toLocaleString('pt-BR', { maximumFractionDigits: mb < 10 ? 1 : 0 })} MB`;
}

/** Cartão fixo (não colapsável) com cabeçalho: ícone, título, descrição e um espaço à direita. */
export function Panel({
  title,
  description,
  icon,
  right,
  children,
  className,
}: {
  title: string;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`${CARD_CLASS} ${className ?? ''}`} aria-label={title}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {icon ? (
            <span className="p-1.5 bg-purple-100 dark:bg-purple-900/20 rounded-lg text-purple-600 dark:text-purple-400 shrink-0">
              {icon}
            </span>
          ) : null}
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{title}</h3>
            {description ? <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{description}</p> : null}
          </div>
        </div>
        {right ? <div className="shrink-0">{right}</div> : null}
      </div>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------- Abas

export type TabDef = {
  id: string;
  label: string;
  icon?: React.ReactNode;
  /** Contador ou etiqueta ao lado do rótulo */
  badge?: React.ReactNode;
  title?: string;
};

/** Barra de abas (role tablist) com navegação por setas, Home e End. */
export function Tabs({
  tabs,
  value,
  onChange,
  ariaLabel,
  idPrefix = 'tab',
}: {
  tabs: TabDef[];
  value: string;
  onChange: (id: string) => void;
  ariaLabel: string;
  idPrefix?: string;
}) {
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const idx = tabs.findIndex((t) => t.id === value);
    if (idx < 0 || tabs.length === 0) return;
    let next = -1;
    if (e.key === 'ArrowRight') next = (idx + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') next = (idx - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    if (next < 0) return;
    e.preventDefault();
    onChange(tabs[next].id);
    document.getElementById(`${idPrefix}-${tabs[next].id}`)?.focus();
  };
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      className="flex items-end gap-1 overflow-x-auto border-b border-slate-200 dark:border-white/10"
    >
      {tabs.map((t) => {
        const active = t.id === value;
        return (
          <button
            key={t.id}
            id={`${idPrefix}-${t.id}`}
            type="button"
            role="tab"
            aria-selected={active}
            aria-controls={`${idPrefix}panel-${t.id}`}
            tabIndex={active ? 0 : -1}
            title={t.title}
            onClick={() => onChange(t.id)}
            className={`inline-flex items-center gap-2 whitespace-nowrap px-3 py-2.5 -mb-px border-b-2 text-sm font-medium transition-colors ${
              active
                ? 'border-purple-600 text-purple-700 dark:text-purple-300'
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white hover:border-slate-300 dark:hover:border-white/20'
            }`}
          >
            {t.icon}
            {t.label}
            {t.badge}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Conteúdo de uma aba. Fica montado mesmo inativo (mantém campos, cursor do
 * roteiro e rolagem) e some com o atributo `hidden`.
 */
export function TabPanel({
  id,
  active,
  idPrefix = 'tab',
  children,
  className,
}: {
  id: string;
  active: boolean;
  idPrefix?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      id={`${idPrefix}panel-${id}`}
      role="tabpanel"
      aria-labelledby={`${idPrefix}-${id}`}
      hidden={!active}
      className={className}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------- Chips arrastáveis

/**
 * Tipo MIME próprio do arrasto de um chip: a textarea do roteiro só trata o
 * drop que o carrega. Texto comum arrastado (seleção da própria textarea,
 * outra janela) fica com o comportamento nativo do navegador.
 */
/**
 * ID copiável de agente/robô: só o rótulo aparece ("ID do agente"); o valor
 * vai para a área de transferência no clique. Mesmo padrão de todo o CRM
 * (components/ui/CopyId).
 */
export function CopyIdButton({ id, label = 'ID' }: { id: string; label?: string }) {
  return <CopyId value={id} label={label} size="xs" />;
}

export const PROMPT_TOKEN_MIME = 'application/x-wa-prompt-token';

/** true quando o arrasto (`dataTransfer.types`) veio de um chip do roteiro. */
export function isPromptTokenDrag(types: ArrayLike<string> | null | undefined): boolean {
  return Array.from(types ?? []).includes(PROMPT_TOKEN_MIME);
}

/**
 * Chip de token do roteiro: clique insere no cursor; arrastar leva o token
 * (dataTransfer com PROMPT_TOKEN_MIME e 'text/plain') até o ponto do texto
 * onde for solto. Com `draggable={false}` (abas em que a textarea do roteiro
 * está escondida) o chip só insere pelo clique.
 */
export function TokenChip({
  token,
  label,
  title,
  tone = 'slate',
  icon,
  onInsert,
  draggable = true,
}: {
  token: string;
  label?: string;
  title?: string;
  tone?: 'slate' | 'purple' | 'green' | 'blue' | 'amber';
  icon?: React.ReactNode;
  onInsert?: (token: string) => void;
  /** false: sem arrastar (a textarea do roteiro não está visível nesta aba) */
  draggable?: boolean;
}) {
  const tones: Record<string, string> = {
    slate:
      'bg-slate-100 border-slate-200 text-slate-700 hover:bg-slate-200 dark:bg-white/10 dark:border-white/10 dark:text-slate-200 dark:hover:bg-white/20',
    purple:
      'bg-purple-50 border-purple-200 text-purple-700 hover:bg-purple-100 dark:bg-purple-900/20 dark:border-purple-500/30 dark:text-purple-300 dark:hover:bg-purple-900/40',
    green:
      'bg-green-50 border-green-200 text-green-700 hover:bg-green-100 dark:bg-green-900/20 dark:border-green-500/30 dark:text-green-300 dark:hover:bg-green-900/40',
    blue: 'bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100 dark:bg-blue-900/20 dark:border-blue-500/30 dark:text-blue-300 dark:hover:bg-blue-900/40',
    amber:
      'bg-amber-50 border-amber-200 text-amber-800 hover:bg-amber-100 dark:bg-amber-900/20 dark:border-amber-500/30 dark:text-amber-200 dark:hover:bg-amber-900/40',
  };
  return (
    <button
      type="button"
      draggable={draggable}
      onDragStart={
        draggable
          ? (e) => {
              e.dataTransfer.setData(PROMPT_TOKEN_MIME, token);
              e.dataTransfer.setData('text/plain', token);
              e.dataTransfer.effectAllowed = 'copy';
            }
          : undefined
      }
      onClick={() => onInsert?.(token)}
      title={
        title ??
        (draggable
          ? `Clique para inserir no cursor ou arraste até o ponto do roteiro: ${token}`
          : `Clique para inserir no cursor do roteiro: ${token}`)
      }
      aria-label={`Inserir ${label ?? token} no roteiro`}
      className={`inline-flex items-center gap-1 max-w-full ${
        draggable ? 'pl-1 cursor-grab active:cursor-grabbing' : 'pl-2 cursor-pointer'
      } pr-2 py-1 rounded-md text-xs font-mono border select-none transition-colors ${tones[tone]}`}
    >
      {draggable ? <GripVertical size={12} className="opacity-50 shrink-0" aria-hidden="true" /> : null}
      {icon}
      <span className="truncate">{label ?? token}</span>
    </button>
  );
}

// ---------------------------------------------------------------- Painel lateral

/**
 * Painel lateral à direita (não modal: a tela atrás continua editável).
 * Renderiza num portal no body; Esc fecha (menos com um modal aberto por
 * cima, que trata o próprio Esc). Fica montado fechado para preservar o
 * estado (ex.: a conversa do chat de teste).
 *
 * Empilhamento: acima da sidebar (z-20) e do cabeçalho (z-40) e ABAIXO das
 * notificações do ToastContext (z-50), que precisam aparecer por cima do
 * painel (erros do teste e do "Ajustar com IA"); os modais (z-[9999])
 * continuam por cima de tudo. No celular para em cima da barra de navegação
 * inferior, como o editor do robô.
 */
export function Drawer({
  open,
  onClose,
  title,
  description,
  headerRight,
  children,
  widthClass = 'sm:w-[480px] xl:w-[560px]',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: React.ReactNode;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
  widthClass?: string;
}) {
  const titleId = useId();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      // Um modal aberto por cima (descartar alterações, excluir mídia) fecha só a si mesmo.
      if (document.querySelector('[role="alertdialog"], [role="dialog"][aria-modal="true"]')) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!mounted) return null;
  return createPortal(
    <aside
      role="dialog"
      aria-labelledby={titleId}
      aria-hidden={!open}
      className={`fixed top-0 bottom-[calc(var(--app-bottom-nav-height,0px)+var(--app-safe-area-bottom,0px))] right-0 z-[45] w-full ${widthClass} max-w-full flex flex-col bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-white/10 shadow-2xl transition-transform duration-200 ${
        open ? 'translate-x-0' : 'translate-x-full invisible'
      }`}
    >
      <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-slate-200 dark:border-white/10">
        <div className="min-w-0">
          <h2 id={titleId} className="text-base font-semibold text-slate-900 dark:text-white truncate">
            {title}
          </h2>
          {description ? <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{description}</p> : null}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {headerRight}
          <button type="button" className={BTN_ICON} onClick={onClose} aria-label="Fechar painel">
            <X size={18} aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-0 flex flex-col">{children}</div>
    </aside>,
    document.body
  );
}
