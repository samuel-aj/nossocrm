'use client';

/**
 * Peças visuais compartilhadas das telas de Agentes de IA e Robôs.
 * Segue o visual da Central de I.A (AIConfigSection).
 */
import React, { useId, useState } from 'react';
import { ChevronDown, ChevronUp, Loader2 } from 'lucide-react';

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

/** Rótulo + campo + texto de ajuda. */
export function Field({
  label,
  htmlFor,
  help,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  help?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className={LABEL_CLASS}>
        {label}
      </label>
      {children}
      {help ? <p className={HELP_CLASS}>{help}</p> : null}
    </div>
  );
}

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
