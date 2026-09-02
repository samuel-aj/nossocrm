'use client';

/**
 * Peças visuais compartilhadas da área de Configurações: cabeçalho da
 * categoria, cartão de seção (título + descrição + ação à direita), linha de
 * configuração, sub-abas e estado vazio. Mesmo visual em todas as categorias.
 */
import React from 'react';
import type { LucideIcon } from 'lucide-react';

export const SETTINGS_INPUT_CLASS =
  'w-full bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500 transition-colors';

export const SETTINGS_BTN_PRIMARY =
  'inline-flex items-center justify-center gap-2 px-3.5 py-2 rounded-lg text-sm font-semibold bg-primary-600 hover:bg-primary-700 text-white shadow-sm disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus-visible-ring';

export const SETTINGS_BTN_SECONDARY =
  'inline-flex items-center justify-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus-visible-ring';

export const SETTINGS_BTN_SMALL =
  'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus-visible-ring';

/** Cabeçalho da categoria (h1 + uma linha). */
export function SettingsHeader({
  title,
  description,
  right,
}: {
  title: string;
  description?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="mb-7 flex items-start justify-between gap-4 flex-wrap">
      <div className="min-w-0">
        <h1 className="text-2xl md:text-3xl font-bold text-slate-900 dark:text-white font-display tracking-tight">{title}</h1>
        {description ? <p className="text-slate-500 dark:text-slate-400 mt-1.5 text-base">{description}</p> : null}
      </div>
      {right ? <div className="shrink-0">{right}</div> : null}
    </div>
  );
}

/** Cartão de seção: título, descrição curta, ação à direita e conteúdo. */
export function SettingsCard({
  title,
  description,
  icon: Icon,
  right,
  children,
  className,
  id,
  bodyClassName,
}: {
  title: string;
  description?: React.ReactNode;
  icon?: LucideIcon;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  id?: string;
  bodyClassName?: string;
}) {
  return (
    <section
      id={id}
      aria-label={title}
      className={`bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl ${className ?? ''}`}
    >
      <div className="flex items-start justify-between gap-4 px-5 pt-5 pb-4 md:px-6 md:pt-6">
        <div className="flex items-start gap-3 min-w-0">
          {Icon ? (
            <span className="mt-0.5 p-2 rounded-lg bg-primary-500/10 text-primary-600 dark:text-primary-400 shrink-0">
              <Icon className="h-4 w-4" aria-hidden="true" />
            </span>
          ) : null}
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">{title}</h2>
            {description ? <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{description}</p> : null}
          </div>
        </div>
        {right ? <div className="shrink-0">{right}</div> : null}
      </div>
      <div className={bodyClassName ?? 'px-5 pb-5 md:px-6 md:pb-6'}>{children}</div>
    </section>
  );
}

/** Linha "título + controle à direita" dentro de um cartão. */
export function SettingsRow({
  title,
  description,
  control,
  children,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  control?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="py-4 first:pt-0 last:pb-0 border-b last:border-b-0 border-slate-100 dark:border-white/5">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <div className="min-w-0 max-w-xl">
          <p className="text-sm font-medium text-slate-800 dark:text-slate-200">{title}</p>
          {description ? <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{description}</p> : null}
        </div>
        {control ? <div className="shrink-0">{control}</div> : null}
      </div>
      {children ? <div className="mt-3">{children}</div> : null}
    </div>
  );
}

/** Sub-abas dentro de uma categoria (pílulas). */
export function SubTabs<T extends string>({
  tabs,
  value,
  onChange,
  ariaLabel,
}: {
  tabs: Array<{ id: T; label: string; icon?: LucideIcon; badge?: React.ReactNode }>;
  value: T;
  onChange: (id: T) => void;
  ariaLabel: string;
}) {
  return (
    <div role="tablist" aria-label={ariaLabel} className="inline-flex flex-wrap gap-1 rounded-xl bg-slate-100 dark:bg-white/5 p-1 mb-6">
      {tabs.map((t) => {
        const active = t.id === value;
        const Icon = t.icon;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.id)}
            className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors focus-visible-ring ${
              active
                ? 'bg-white dark:bg-slate-800 text-primary-700 dark:text-primary-300 shadow-sm'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            {Icon ? <Icon className="h-4 w-4" aria-hidden="true" /> : null}
            {t.label}
            {t.badge}
          </button>
        );
      })}
    </div>
  );
}

/** Estado vazio compacto de uma lista. */
export function SettingsEmpty({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-sm text-slate-500 dark:text-slate-400 rounded-xl border border-dashed border-slate-200 dark:border-white/10 px-4 py-6 text-center">
      {children}
    </p>
  );
}
