/**
 * Temas (paletas) e aparência (claro/escuro/sistema) do CRM.
 *
 * Como funciona: o Tailwind v4 compila `bg-primary-600`, `text-purple-400`,
 * `from-violet-500` etc. para `var(--color-...)`. Cada tema redefine essas
 * variáveis num seletor `[data-theme="..."]` no <html>, então TODOS os
 * componentes existentes mudam de cor sem tocar em classe nenhuma. As cores
 * semânticas (verde de sucesso, vermelho de erro, âmbar de alerta, azul de
 * informação) não são tocadas.
 *
 * O tema "roxo" é a identidade da plataforma e o padrão de todo mundo: ele
 * não emite CSS nenhum (fica exatamente o visual atual). Os outros são uma
 * personalização opcional, por usuário.
 *
 * Fonte única: as escalas daqui alimentam o CSS gerado (buildThemeCss) e as
 * prévias da tela de Aparência.
 */

export const THEME_IDS = ['roxo', 'grafite', 'azul', 'esmeralda', 'ambar', 'rosa'] as const;
export type ThemeId = (typeof THEME_IDS)[number];
export const DEFAULT_THEME: ThemeId = 'roxo';

export const APPEARANCE_MODES = ['light', 'dark', 'system'] as const;
export type AppearanceMode = (typeof APPEARANCE_MODES)[number];

/** Chaves do localStorage (JSON, como o usePersistedState grava). */
export const THEME_STORAGE_KEY = 'crm_theme';
export const MODE_STORAGE_KEY = 'crm_theme_mode';
/** Chave antiga do claro/escuro (boolean); continua valendo quando não há modo salvo. */
export const LEGACY_DARK_KEY = 'crm_dark_mode';

export function isThemeId(v: unknown): v is ThemeId {
  return typeof v === 'string' && (THEME_IDS as readonly string[]).includes(v);
}
export function isAppearanceMode(v: unknown): v is AppearanceMode {
  return typeof v === 'string' && (APPEARANCE_MODES as readonly string[]).includes(v);
}

type Scale = Record<50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 | 950, string>;

export type ThemeDefinition = {
  id: ThemeId;
  name: string;
  description: string;
  /** Escala do acento (botões, seleção, foco, links, badges) */
  accent: Scale;
  /** Superfícies do modo escuro (fundo, cartão, borda, hover) */
  dark: { bg: string; card: string; border: string; hover: string };
  /** true = tema padrão: não gera CSS (o visual atual permanece intacto) */
  isDefault?: boolean;
};

/** Superfícies escuras NEUTRAS (preto, grafite e cinza), usadas por todos os temas fora o roxo. */
const NEUTRAL_DARK = { bg: '#0b0b0e', card: '#151518', border: '#26262c', hover: '#2d2d34' };

export const THEMES: ThemeDefinition[] = [
  {
    id: 'roxo',
    name: 'Roxo',
    description: 'A identidade da plataforma. Padrão para todos.',
    isDefault: true,
    accent: {
      50: '#f5f3ff',
      100: '#ede9fe',
      200: '#ddd6fe',
      300: '#c4b5fd',
      400: '#a78bfa',
      500: '#8b5cf6',
      600: '#7c3aed',
      700: '#6d28d9',
      800: '#5b21b6',
      900: '#4c1d95',
      950: '#2e1065',
    },
    dark: { bg: '#0d0b14', card: '#17132a', border: '#2e2450', hover: '#3b2f65' },
  },
  {
    id: 'grafite',
    name: 'Grafite',
    description: 'Neutro, sofisticado e tecnológico.',
    accent: {
      50: '#f7f7f8',
      100: '#ececee',
      200: '#d9d9dd',
      300: '#b8b8bf',
      400: '#9a9aa3',
      500: '#6b6b75',
      600: '#4a4a54',
      700: '#34343c',
      800: '#232328',
      900: '#161619',
      950: '#0c0c0e',
    },
    dark: NEUTRAL_DARK,
  },
  {
    id: 'azul',
    name: 'Azul',
    description: 'Clássico e confiável.',
    accent: {
      50: '#eff6ff',
      100: '#dbeafe',
      200: '#bfdbfe',
      300: '#93c5fd',
      400: '#60a5fa',
      500: '#3b82f6',
      600: '#2563eb',
      700: '#1d4ed8',
      800: '#1e40af',
      900: '#1e3a8a',
      950: '#172554',
    },
    dark: NEUTRAL_DARK,
  },
  {
    id: 'esmeralda',
    name: 'Esmeralda',
    description: 'Fresco e equilibrado.',
    accent: {
      50: '#ecfdf5',
      100: '#d1fae5',
      200: '#a7f3d0',
      300: '#6ee7b7',
      400: '#34d399',
      500: '#10b981',
      600: '#059669',
      700: '#047857',
      800: '#065f46',
      900: '#064e3b',
      950: '#022c22',
    },
    dark: NEUTRAL_DARK,
  },
  {
    id: 'ambar',
    name: 'Âmbar',
    description: 'Quente e energético.',
    accent: {
      50: '#fffbeb',
      100: '#fef3c7',
      200: '#fde68a',
      300: '#fcd34d',
      400: '#fbbf24',
      500: '#f59e0b',
      600: '#d97706',
      700: '#b45309',
      800: '#92400e',
      900: '#78350f',
      950: '#451a03',
    },
    dark: NEUTRAL_DARK,
  },
  {
    id: 'rosa',
    name: 'Rosa',
    description: 'Elegante e marcante.',
    accent: {
      50: '#fff1f2',
      100: '#ffe4e6',
      200: '#fecdd3',
      300: '#fda4af',
      400: '#fb7185',
      500: '#f43f5e',
      600: '#e11d48',
      700: '#be123c',
      800: '#9f1239',
      900: '#881337',
      950: '#4c0519',
    },
    dark: NEUTRAL_DARK,
  },
];

export function getTheme(id: ThemeId): ThemeDefinition {
  return THEMES.find(t => t.id === id) ?? THEMES[0];
}

/**
 * Escalas do Tailwind que a plataforma usa como "cor da marca" e que passam a
 * seguir o acento do tema. As demais (green, red, amber, blue, fuchsia...)
 * continuam com significado próprio.
 */
const BRAND_SCALES = ['primary', 'purple', 'violet', 'indigo'] as const;

/**
 * CSS dos temas (sem o roxo, que é o padrão). Vai num <style> no <head> do
 * layout raiz, junto do script que aplica `data-theme` antes da primeira
 * pintura, para não piscar.
 */
export function buildThemeCss(): string {
  const out: string[] = [];
  for (const t of THEMES) {
    if (t.isDefault) continue;
    const vars: string[] = [];
    for (const scale of BRAND_SCALES) {
      for (const [step, hex] of Object.entries(t.accent)) vars.push(`--color-${scale}-${step}:${hex}`);
    }
    vars.push(
      `--color-dark-bg:${t.dark.bg}`,
      `--color-dark-card:${t.dark.card}`,
      `--color-dark-border:${t.dark.border}`,
      `--color-dark-hover:${t.dark.hover}`
    );
    out.push(`html[data-theme="${t.id}"]{${vars.join(';')}}`);
    // Modo escuro neutro: fundo, superfícies, bordas e vidro sem o tom roxo.
    out.push(
      `html.dark[data-theme="${t.id}"]{` +
        [
          '--color-bg:oklch(0.13 0.004 270)',
          '--color-surface:oklch(0.17 0.004 270)',
          '--color-muted:oklch(0.21 0.005 270)',
          '--color-border:oklch(0.28 0.006 270)',
          '--color-border-subtle:oklch(0.23 0.005 270 / 0.6)',
          '--glass-bg:oklch(0.16 0.004 270 / 0.75)',
          '--dots-color:oklch(0.24 0.004 270)',
        ].join(';') +
        '}'
    );
  }
  return out.join('\n');
}

/**
 * Script executado ANTES da hidratação: lê o tema e o modo salvos no
 * localStorage e aplica `data-theme` e a classe `dark` no <html>. Sem ele a
 * página abriria roxa/escura por um instante para quem escolheu outro visual.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var r=document.documentElement;function g(k){try{return JSON.parse(localStorage.getItem(k))}catch(e){return null}}var t=g(${JSON.stringify(THEME_STORAGE_KEY)});if(typeof t==='string'&&t!==${JSON.stringify(DEFAULT_THEME)}&&${JSON.stringify(THEME_IDS)}.indexOf(t)>=0){r.setAttribute('data-theme',t)}var m=g(${JSON.stringify(MODE_STORAGE_KEY)});var d=g(${JSON.stringify(LEGACY_DARK_KEY)});var dark;if(m==='system'){dark=window.matchMedia('(prefers-color-scheme: dark)').matches}else if(m==='light'){dark=false}else if(m==='dark'){dark=true}else{dark=(d===null||d===undefined)?true:!!d}r.classList.toggle('dark',dark)}catch(e){}})();`;
