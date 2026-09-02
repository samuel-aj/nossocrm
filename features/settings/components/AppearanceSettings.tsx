'use client';

/**
 * Configurações → Aparência: modo (claro/escuro/sistema) e tema (paleta).
 * A escolha é individual (user_settings) e aplica na hora, para a pessoa ver
 * o resultado antes mesmo de sair da tela. Roxo é o padrão da plataforma;
 * ninguém muda de tema sem escolher aqui.
 */
import React from 'react';
import { Check, Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from '@/context/ThemeContext';
import { THEMES, type AppearanceMode, type ThemeDefinition } from '@/lib/theme/themes';

const MODES: Array<{ value: AppearanceMode; label: string; icon: React.ReactNode; hint: string }> = [
  { value: 'light', label: 'Claro', icon: <Sun size={16} aria-hidden="true" />, hint: 'Fundo claro o tempo todo' },
  { value: 'dark', label: 'Escuro', icon: <Moon size={16} aria-hidden="true" />, hint: 'Fundo escuro o tempo todo' },
  { value: 'system', label: 'Sistema', icon: <Monitor size={16} aria-hidden="true" />, hint: 'Acompanha o aparelho' },
];

/** Miniatura do CRM com as cores do tema (sidebar, botão, cartão), no modo atual. */
function ThemePreview({ theme, dark }: { theme: ThemeDefinition; dark: boolean }) {
  const bg = dark ? theme.dark.bg : '#f8f7f4';
  const card = dark ? theme.dark.card : '#ffffff';
  const border = dark ? theme.dark.border : '#e5e4e0';
  const line = dark ? 'rgba(255,255,255,0.18)' : 'rgba(15,23,42,0.14)';
  const accent = theme.accent[dark ? 400 : 600];
  const accentSoft = dark ? `${theme.accent[500]}33` : theme.accent[100];
  return (
    <div className="h-24 w-full overflow-hidden rounded-lg flex" style={{ background: bg, border: `1px solid ${border}` }} aria-hidden="true">
      <div className="w-9 shrink-0 p-1.5 flex flex-col gap-1.5" style={{ background: card, borderRight: `1px solid ${border}` }}>
        <span className="h-2 w-2 rounded-full" style={{ background: accent }} />
        <span className="h-1.5 w-full rounded" style={{ background: accentSoft }} />
        <span className="h-1.5 w-full rounded" style={{ background: line }} />
        <span className="h-1.5 w-full rounded" style={{ background: line }} />
        <span className="h-1.5 w-2/3 rounded" style={{ background: line }} />
      </div>
      <div className="flex-1 p-2 flex flex-col gap-1.5 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="h-1.5 w-12 rounded" style={{ background: line }} />
          <span className="h-3.5 w-9 rounded-md" style={{ background: theme.accent[dark ? 500 : 600] }} />
        </div>
        <div className="rounded-md p-1.5 flex flex-col gap-1" style={{ background: card, border: `1px solid ${border}` }}>
          <span className="h-1.5 w-3/4 rounded" style={{ background: line }} />
          <span className="h-1.5 w-1/2 rounded" style={{ background: line }} />
          <span className="h-1.5 w-1/3 rounded" style={{ background: accent }} />
        </div>
        <div className="flex gap-1">
          <span className="h-1.5 w-1/4 rounded" style={{ background: accentSoft }} />
          <span className="h-1.5 w-1/4 rounded" style={{ background: line }} />
        </div>
      </div>
    </div>
  );
}

const CARD_CLASS = 'bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl p-6';

export const AppearanceSettings: React.FC = () => {
  const { mode, setMode, theme, setTheme, darkMode } = useTheme();

  return (
    <div className="pb-10 space-y-8">
      <section className={CARD_CLASS} aria-labelledby="appearance-mode-title">
        <h3 id="appearance-mode-title" className="text-lg font-semibold text-slate-900 dark:text-white mb-1">
          Aparência
        </h3>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">Vale só para você, em qualquer aparelho.</p>
        <div role="radiogroup" aria-label="Aparência" className="inline-flex flex-wrap gap-1 rounded-xl bg-slate-100 dark:bg-white/5 p-1">
          {MODES.map((m) => {
            const active = mode === m.value;
            return (
              <button
                key={m.value}
                type="button"
                role="radio"
                aria-checked={active}
                title={m.hint}
                onClick={() => setMode(m.value)}
                className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40 ${
                  active
                    ? 'bg-white dark:bg-slate-800 text-primary-600 dark:text-primary-400 shadow-sm'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {m.icon}
                {m.label}
              </button>
            );
          })}
        </div>
      </section>

      <section className={CARD_CLASS} aria-labelledby="appearance-theme-title">
        <h3 id="appearance-theme-title" className="text-lg font-semibold text-slate-900 dark:text-white mb-1">
          Tema
        </h3>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-5">
          A cor de destaque dos botões, seleções, links e detalhes. Fundos continuam neutros; sucesso, erro e alerta
          não mudam.
        </p>
        <div role="radiogroup" aria-label="Tema" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {THEMES.map((t) => {
            const active = theme === t.id;
            return (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setTheme(t.id)}
                className={`group relative text-left rounded-xl border p-3 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40 ${
                  active
                    ? 'border-primary-500 ring-2 ring-primary-500/20 bg-primary-50/40 dark:bg-primary-500/5'
                    : 'border-slate-200 dark:border-white/10 hover:border-slate-300 dark:hover:border-white/20 bg-white dark:bg-slate-900/40'
                }`}
              >
                <ThemePreview theme={t} dark={darkMode} />
                <div className="mt-3 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                      <span className="h-3 w-3 rounded-full shrink-0" style={{ background: t.accent[500] }} aria-hidden="true" />
                      {t.name}
                      {t.isDefault ? (
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                          Padrão
                        </span>
                      ) : null}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{t.description}</p>
                  </div>
                  <span
                    className={`mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full shrink-0 transition-opacity ${
                      active ? 'bg-primary-600 text-white opacity-100' : 'opacity-0'
                    }`}
                    aria-hidden="true"
                  >
                    <Check size={12} />
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
};

export default AppearanceSettings;
