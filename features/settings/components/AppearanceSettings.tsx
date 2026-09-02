'use client';

/**
 * Configurações → Aparência: modo (claro/escuro/automático) e tema (paleta).
 * A escolha é individual (user_settings) e aplica na hora, para a pessoa ver
 * o resultado antes mesmo de sair da tela. Roxo é o padrão da plataforma;
 * ninguém muda de tema sem escolher aqui.
 */
import React from 'react';
import { Check, Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from '@/context/ThemeContext';
import { THEMES, type AppearanceMode, type ThemeDefinition } from '@/lib/theme/themes';

const MODES: Array<{ value: AppearanceMode; label: string; hint: string; icon: React.ReactNode }> = [
  { value: 'light', label: 'Claro', hint: 'Fundo claro o tempo todo', icon: <Sun size={18} aria-hidden="true" /> },
  { value: 'dark', label: 'Escuro', hint: 'Fundo escuro o tempo todo', icon: <Moon size={18} aria-hidden="true" /> },
  { value: 'system', label: 'Automático', hint: 'Acompanha o aparelho', icon: <Monitor size={18} aria-hidden="true" /> },
];

const GROUPS: Array<{ id: ThemeDefinition['group']; label: string; hint: string }> = [
  { id: 'padrao', label: 'Padrão da plataforma', hint: 'O visual original. Quem não escolher nada fica aqui.' },
  { id: 'mono', label: 'Monocromáticos', hint: 'Preto, branco e grafite. Refinados, sem cor forte de destaque.' },
  { id: 'cor', label: 'Com cor', hint: 'Fundos neutros e a cor só nos destaques.' },
];

/** Miniatura do CRM no tema (sidebar, cabeçalho, botão, cartão), no modo indicado. */
function ThemePreview({ theme, dark }: { theme: ThemeDefinition; dark: boolean }) {
  const side = dark ? theme.dark : theme.light;
  const s = side.surfaces ?? (dark
    ? { bg: '#0d0b14', surface: '#17132a', muted: '#1f1a36', border: '#2e2450', borderSubtle: '#2e2450', hover: '#3b2f65' }
    : { bg: '#f8f7f4', surface: '#fcfcfb', muted: '#f1f0ec', border: '#e5e3dd', borderSubtle: '#ecebe6', hover: '#f1f0ec' });
  const text = dark ? 'rgba(255,255,255,0.82)' : 'rgba(15,23,42,0.85)';
  const line = dark ? 'rgba(255,255,255,0.16)' : 'rgba(15,23,42,0.12)';
  const accentText = side.accent[dark ? 400 : 600];
  const button = side.accent[600];
  const onButton = side.onAccent ?? '#ffffff';
  const soft = `color-mix(in srgb, ${side.accent[500]} ${dark ? 16 : 12}%, transparent)`;
  return (
    <div
      className="h-28 w-full overflow-hidden rounded-lg flex"
      style={{ background: s.bg, border: `1px solid ${s.border}` }}
      aria-hidden="true"
    >
      <div className="w-10 shrink-0 p-1.5 flex flex-col gap-1.5" style={{ background: s.surface, borderRight: `1px solid ${s.border}` }}>
        <span className="h-2.5 w-2.5 rounded-md" style={{ background: side.accent[dark ? 400 : 600] }} />
        <span className="h-2 w-full rounded" style={{ background: soft, boxShadow: `inset 2px 0 0 ${accentText}` }} />
        <span className="h-1.5 w-full rounded" style={{ background: line }} />
        <span className="h-1.5 w-full rounded" style={{ background: line }} />
        <span className="h-1.5 w-2/3 rounded" style={{ background: line }} />
      </div>
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="flex items-center justify-between gap-2 px-2 py-1.5" style={{ borderBottom: `1px solid ${s.border}`, background: s.surface }}>
          <span className="h-1.5 w-10 rounded" style={{ background: text }} />
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: line }} />
        </div>
        <div className="flex-1 p-2 flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="h-1.5 w-12 rounded" style={{ background: text }} />
            <span className="h-4 w-10 rounded-md flex items-center justify-center" style={{ background: button }}>
              <span className="h-1 w-5 rounded" style={{ background: onButton, opacity: 0.9 }} />
            </span>
          </div>
          <div className="rounded-md p-1.5 flex flex-col gap-1" style={{ background: s.surface, border: `1px solid ${s.border}` }}>
            <span className="h-1.5 w-3/4 rounded" style={{ background: text, opacity: 0.8 }} />
            <span className="h-1.5 w-1/2 rounded" style={{ background: line }} />
            <span className="h-1.5 w-1/3 rounded" style={{ background: accentText }} />
          </div>
          <div className="flex gap-1">
            <span className="h-1.5 w-1/4 rounded" style={{ background: soft }} />
            <span className="h-1.5 w-1/4 rounded" style={{ background: line }} />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Três tons do tema: fundo, superfície e acento. */
function Swatches({ theme, dark }: { theme: ThemeDefinition; dark: boolean }) {
  const side = dark ? theme.dark : theme.light;
  const s = side.surfaces;
  const tones = [
    s?.bg ?? (dark ? '#0d0b14' : '#f8f7f4'),
    s?.surface ?? (dark ? '#17132a' : '#fcfcfb'),
    side.accent[dark ? 400 : 600],
  ];
  return (
    <span className="inline-flex -space-x-1" aria-hidden="true">
      {tones.map((c, i) => (
        <span
          key={i}
          className="h-3.5 w-3.5 rounded-full ring-2 ring-white dark:ring-slate-900"
          style={{ background: c, border: '1px solid rgba(127,127,127,0.35)' }}
        />
      ))}
    </span>
  );
}

const CARD_CLASS = 'bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl p-6';

export const AppearanceSettings: React.FC = () => {
  const { mode, setMode, theme, setTheme, darkMode } = useTheme();

  return (
    <div className="pb-10 space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-slate-900 dark:text-white font-display tracking-tight">Aparência</h1>
        <p className="text-slate-500 dark:text-slate-400 mt-2 text-lg">
          Como o CRM aparece para você. Vale só para a sua conta, em qualquer aparelho.
        </p>
      </div>

      <section className={CARD_CLASS} aria-labelledby="appearance-mode-title">
        <h2 id="appearance-mode-title" className="text-base font-semibold text-slate-900 dark:text-white">
          Modo
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 mb-4">Claro, escuro ou seguindo o aparelho.</p>
        <div role="radiogroup" aria-label="Modo" className="grid grid-cols-3 gap-2 max-w-xl">
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
                className={`flex flex-col items-center gap-1.5 rounded-xl border px-3 py-3 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40 ${
                  active
                    ? 'border-primary-500 bg-primary-500/10 text-primary-700 dark:text-primary-300'
                    : 'border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-300 hover:border-slate-300 dark:hover:border-white/20 hover:bg-slate-50 dark:hover:bg-white/5'
                }`}
              >
                {m.icon}
                {m.label}
                <span className="text-[11px] font-normal text-slate-400 dark:text-slate-500">{m.hint}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className={CARD_CLASS} aria-labelledby="appearance-theme-title">
        <h2 id="appearance-theme-title" className="text-base font-semibold text-slate-900 dark:text-white">
          Tema
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 mb-5">
          A cor de destaque e as superfícies. Sucesso, erro e alerta mantêm as próprias cores em qualquer tema.
        </p>
        <div className="space-y-7">
          {GROUPS.map((g) => {
            const items = THEMES.filter((t) => t.group === g.id);
            if (items.length === 0) return null;
            return (
              <div key={g.id}>
                <div className="flex items-baseline gap-2 mb-3">
                  <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{g.label}</h3>
                  <span className="text-xs text-slate-400 dark:text-slate-500">{g.hint}</span>
                </div>
                <div role="radiogroup" aria-label={g.label} className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                  {items.map((t) => {
                    const active = theme === t.id;
                    const previewDark = t.preferredMode ? t.preferredMode === 'dark' : darkMode;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => setTheme(t.id)}
                        className={`group relative text-left rounded-xl border p-3 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40 ${
                          active
                            ? 'border-primary-500 ring-2 ring-primary-500/20 bg-primary-500/5'
                            : 'border-slate-200 dark:border-white/10 hover:border-slate-300 dark:hover:border-white/20 bg-white dark:bg-slate-900/40'
                        }`}
                      >
                        <ThemePreview theme={t} dark={previewDark} />
                        <div className="mt-3 flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                              <Swatches theme={t} dark={previewDark} />
                              <span className="truncate">{t.name}</span>
                              {t.isDefault ? (
                                <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                                  Padrão
                                </span>
                              ) : null}
                            </p>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{t.description}</p>
                          </div>
                          <span
                            className={`mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full shrink-0 transition-opacity bg-primary-600 text-white ${
                              active ? 'opacity-100' : 'opacity-0'
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
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
};

export default AppearanceSettings;
