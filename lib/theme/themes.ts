/**
 * Temas (paletas) e aparência (claro/escuro/sistema) do CRM.
 *
 * Como funciona: o Tailwind v4 compila `bg-primary-600`, `text-purple-400`,
 * `from-violet-500` etc. para `var(--color-...)`. Cada tema redefine essas
 * variáveis em `html[data-theme="..."]` (claro) e `html.dark[data-theme="..."]`
 * (escuro), então TODOS os componentes existentes mudam de cor sem tocar em
 * classe nenhuma. As cores semânticas (verde de sucesso, vermelho de erro,
 * âmbar de alerta, azul de informação) não são tocadas.
 *
 * Aparência (claro/escuro/sistema) e tema são independentes: cada tema tem a
 * própria versão clara e escura. Grafite + Claro = branco e cinza claro com
 * detalhes grafite; Grafite + Escuro = preto e grafite com detalhes claros.
 *
 * O tema "roxo" é a identidade da plataforma e o padrão de todo mundo: ele
 * não emite CSS nenhum (fica exatamente o visual atual).
 *
 * Fonte única: as escalas daqui alimentam o CSS gerado (buildThemeCss) e as
 * prévias da tela de Aparência.
 */

export const THEME_IDS = ['roxo', 'grafite', 'mono', 'midnight', 'azul'] as const;
export type ThemeId = (typeof THEME_IDS)[number];
export const DEFAULT_THEME: ThemeId = 'roxo';

/** Ids de temas antigos (separados por luminosidade) que viraram um tema só. */
export const LEGACY_THEME_IDS: Record<string, ThemeId> = {
  preto: 'grafite',
  branco: 'grafite',
  'preto-branco': 'mono',
  'branco-preto': 'mono',
  esmeralda: 'azul',
  ambar: 'roxo',
  rosa: 'roxo',
};

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
/** Tema válido a partir de qualquer valor salvo (ids antigos são convertidos; o resto vira o padrão). */
export function normalizeThemeId(v: unknown): ThemeId {
  if (isThemeId(v)) return v;
  if (typeof v === 'string' && v in LEGACY_THEME_IDS) return LEGACY_THEME_IDS[v];
  return DEFAULT_THEME;
}
export function isAppearanceMode(v: unknown): v is AppearanceMode {
  return typeof v === 'string' && (APPEARANCE_MODES as readonly string[]).includes(v);
}

export type Scale = Record<50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 | 950, string>;

/** Superfícies de um modo: fundo da página, cartões, campos, bordas. */
export type Surfaces = {
  bg: string;
  surface: string;
  muted: string;
  border: string;
  borderSubtle: string;
  hover: string;
};

export type ThemeSide = {
  /** Escala do acento (botões, seleção, foco, links, badges) */
  accent: Scale;
  /** Cor do texto em cima do acento (botões cheios). Ausente = branco, como hoje. */
  onAccent?: string;
  /** Superfícies; ausente = as do visual atual (creme no claro, roxo profundo no escuro) */
  surfaces?: Surfaces;
};

export type ThemeDefinition = {
  id: ThemeId;
  name: string;
  description: string;
  group: 'padrao' | 'mono' | 'cor';
  light: ThemeSide;
  dark: ThemeSide;
  /**
   * Troca a escala `slate` (texto, bordas e fundos secundários, levemente
   * azulada) por cinzas puros: os temas monocromáticos ficam neutros de verdade.
   */
  neutralGrays?: boolean;
  /** true = tema padrão: não gera CSS (o visual atual permanece intacto) */
  isDefault?: boolean;
};

/** Cinzas puros (zinc) no lugar do slate azulado, para os temas monocromáticos. */
const NEUTRAL_GRAYS: Scale = {
  50: '#fafafa',
  100: '#f4f4f5',
  200: '#e4e4e7',
  300: '#d4d4d8',
  400: '#a1a1aa',
  500: '#71717a',
  600: '#52525b',
  700: '#3f3f46',
  800: '#27272a',
  900: '#18181b',
  950: '#09090b',
};

// ---------------------------------------------------------------------------
// Escalas de acento
// ---------------------------------------------------------------------------

/** Acento grafite para fundo claro (botões grafite com texto branco). */
const GRAPHITE_LIGHT: Scale = {
  50: '#f5f5f6',
  100: '#e8e8ea',
  200: '#d1d1d6',
  300: '#a9a9b2',
  400: '#7d7d88',
  500: '#5c5c66',
  600: '#3f3f47',
  700: '#2e2e34',
  800: '#1f1f24',
  900: '#141417',
  950: '#0a0a0c',
};

/** Acento preto para fundo claro (botões pretos, contraste alto). */
const INK_LIGHT: Scale = {
  50: '#f4f4f5',
  100: '#e4e4e7',
  200: '#d4d4d8',
  300: '#a1a1aa',
  400: '#52525b',
  500: '#27272a',
  600: '#0a0a0a',
  700: '#262626',
  800: '#171717',
  900: '#0a0a0a',
  950: '#000000',
};

/**
 * Acento para fundo escuro: 300/400 claros (texto ativo), 500/600 cinzas
 * médios (botões com texto branco), 800/900 escuros (fundos tingidos).
 */
const SILVER_DARK: Scale = {
  50: '#fafafa',
  100: '#f4f4f5',
  200: '#e4e4e7',
  300: '#d4d4d8',
  400: '#c8c8ce',
  500: '#8e8e98',
  600: '#5b5b66',
  700: '#4b4b54',
  800: '#2a2a30',
  900: '#1f1f24',
  950: '#141417',
};

/** Acento branco para fundo escuro (botões brancos com texto preto). */
const WHITE_DARK: Scale = {
  50: '#fafafa',
  100: '#f4f4f5',
  200: '#e4e4e7',
  300: '#ececee',
  400: '#f4f4f5',
  500: '#e4e4e7',
  600: '#fafafa',
  700: '#e4e4e7',
  800: '#3a3a40',
  900: '#2a2a30',
  950: '#1c1c21',
};

const BLUE: Scale = {
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
};

/** Azul-índigo suave, sem neon, para o Midnight. */
const MIDNIGHT_ACCENT: Scale = {
  50: '#eef2ff',
  100: '#e0e7ff',
  200: '#c7d2fe',
  300: '#a5b4fc',
  400: '#93a8ff',
  500: '#6b86f5',
  600: '#4f6ae6',
  700: '#3f56c8',
  800: '#3445a0',
  900: '#2b3880',
  950: '#1b234f',
};

// ---------------------------------------------------------------------------
// Superfícies
// ---------------------------------------------------------------------------

/** Claro limpo: branco puro, cinza quase branco nos campos, bordas discretas. */
const WHITE_SURFACES: Surfaces = {
  bg: '#ffffff',
  surface: '#ffffff',
  muted: '#f5f5f6',
  border: '#e6e6e9',
  borderSubtle: '#efeff1',
  hover: '#f0f0f2',
};

/** Escuro neutro profundo: quase preto, cartões grafite. */
const BLACK_SURFACES: Surfaces = {
  bg: '#050505',
  surface: '#121212',
  muted: '#1a1a1a',
  border: '#262626',
  borderSubtle: 'rgba(255,255,255,0.06)',
  hover: '#1f1f1f',
};

/** Escuro de contraste: preto puro, bordas um pouco mais visíveis. */
const PURE_BLACK_SURFACES: Surfaces = {
  bg: '#000000',
  surface: '#0e0e0e',
  muted: '#171717',
  border: '#2e2e2e',
  borderSubtle: 'rgba(255,255,255,0.08)',
  hover: '#1c1c1c',
};

/** Escuro neutro para os temas coloridos (a cor fica só nos destaques). */
const NEUTRAL_DARK_SURFACES: Surfaces = {
  bg: '#0b0b0e',
  surface: '#151518',
  muted: '#1d1d21',
  border: '#26262c',
  borderSubtle: 'rgba(255,255,255,0.06)',
  hover: '#2d2d34',
};

/** Escuro azul-marinho do Midnight. */
const MIDNIGHT_SURFACES: Surfaces = {
  bg: '#0a0f1e',
  surface: '#111a2e',
  muted: '#172238',
  border: '#22304a',
  borderSubtle: 'rgba(148,163,184,0.12)',
  hover: '#1a2540',
};

// ---------------------------------------------------------------------------
// Temas
// ---------------------------------------------------------------------------

const ROXO_ACCENT: Scale = {
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
};

export const THEMES: ThemeDefinition[] = [
  {
    id: 'roxo',
    name: 'Roxo',
    description: 'A identidade da plataforma.',
    group: 'padrao',
    isDefault: true,
    light: {
      accent: ROXO_ACCENT,
      surfaces: { bg: '#f8f7f4', surface: '#fcfcfb', muted: '#f1f0ec', border: '#e5e3dd', borderSubtle: '#ecebe6', hover: '#f1f0ec' },
    },
    dark: {
      accent: ROXO_ACCENT,
      surfaces: { bg: '#0d0b14', surface: '#17132a', muted: '#1f1a36', border: '#2e2450', borderSubtle: 'rgba(120,100,180,0.25)', hover: '#3b2f65' },
    },
  },
  {
    id: 'grafite',
    name: 'Grafite',
    description: 'Claro: branco com detalhes grafite. Escuro: preto e grafite com detalhes claros.',
    group: 'mono',
    neutralGrays: true,
    light: { accent: GRAPHITE_LIGHT, surfaces: WHITE_SURFACES },
    dark: { accent: SILVER_DARK, surfaces: BLACK_SURFACES },
  },
  {
    id: 'mono',
    name: 'Preto & Branco',
    description: 'Contraste alto: botões pretos no claro, brancos no escuro.',
    group: 'mono',
    neutralGrays: true,
    light: { accent: INK_LIGHT, surfaces: { ...WHITE_SURFACES, border: '#dedee2' } },
    dark: { accent: WHITE_DARK, onAccent: '#0a0a0a', surfaces: PURE_BLACK_SURFACES },
  },
  {
    id: 'midnight',
    name: 'Midnight',
    description: 'Azul suave nos destaques; escuro em azul-marinho.',
    group: 'cor',
    light: { accent: MIDNIGHT_ACCENT, surfaces: WHITE_SURFACES },
    dark: { accent: MIDNIGHT_ACCENT, surfaces: MIDNIGHT_SURFACES },
  },
  {
    id: 'azul',
    name: 'Azul',
    description: 'Fundos neutros e azul clássico nos destaques.',
    group: 'cor',
    light: { accent: BLUE, surfaces: WHITE_SURFACES },
    dark: { accent: BLUE, surfaces: NEUTRAL_DARK_SURFACES },
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
 * Elementos com fundo cheio na cor do acento: quando o acento é claro (branco,
 * prata) o texto deles vira escuro, senão sumiria. `text-white` nas classes
 * continua lá; esta regra ganha por especificidade.
 */
const ON_ACCENT_SELECTORS = (() => {
  const out: string[] = [];
  for (const scale of ['primary', 'purple', 'violet', 'indigo']) {
    for (const step of [500, 600, 700]) {
      out.push(`.bg-${scale}-${step}`, `.dark\\:bg-${scale}-${step}`, `.hover\\:bg-${scale}-${step}:hover`, `.from-${scale}-${step}`);
    }
  }
  return out.join(',');
})();

function accentVars(accent: Scale): string[] {
  const vars: string[] = [];
  for (const scale of BRAND_SCALES) {
    for (const [step, hex] of Object.entries(accent)) vars.push(`--color-${scale}-${step}:${hex}`);
  }
  return vars;
}

function surfaceVars(s: Surfaces): string[] {
  return [
    `--color-bg:${s.bg}`,
    `--color-surface:${s.surface}`,
    `--color-muted:${s.muted}`,
    `--color-border:${s.border}`,
    `--color-border-subtle:${s.borderSubtle}`,
    `--color-dark-bg:${s.bg}`,
    `--color-dark-card:${s.surface}`,
    `--color-dark-border:${s.border}`,
    `--color-dark-hover:${s.hover}`,
    `--glass-bg:color-mix(in srgb, ${s.surface} 80%, transparent)`,
    `--dots-color:${s.border}`,
  ];
}

/**
 * CSS dos temas (sem o roxo, que é o padrão). Vai num <style> no <head> do
 * layout raiz, junto do script que aplica `data-theme` antes da primeira
 * pintura, para não piscar.
 */
export function buildThemeCss(): string {
  const out: string[] = [];
  for (const t of THEMES) {
    if (t.isDefault) continue;
    const grays = t.neutralGrays ? Object.entries(NEUTRAL_GRAYS).map(([step, hex]) => `--color-slate-${step}:${hex}`) : [];
    const light = [...grays, ...accentVars(t.light.accent), ...(t.light.surfaces ? surfaceVars(t.light.surfaces) : [])];
    const dark = [...accentVars(t.dark.accent), ...(t.dark.surfaces ? surfaceVars(t.dark.surfaces) : [])];
    out.push(`html[data-theme="${t.id}"]{${light.join(';')}}`);
    out.push(`html.dark[data-theme="${t.id}"]{${dark.join(';')}}`);
    if (t.light.onAccent) out.push(`html[data-theme="${t.id}"]:not(.dark) :is(${ON_ACCENT_SELECTORS}){color:${t.light.onAccent}}`);
    if (t.dark.onAccent) out.push(`html.dark[data-theme="${t.id}"] :is(${ON_ACCENT_SELECTORS}){color:${t.dark.onAccent}}`);
  }
  // Regras comuns a qualquer tema fora o padrão: foco na cor do tema, selects e
  // barras de rolagem nas superfícies do tema (em vez do azul/slate fixos).
  out.push(
    'html[data-theme] .focus-visible-ring:focus-visible{outline-color:var(--color-primary-500)}',
    'html[data-theme] .focus-visible-high:focus-visible{outline-color:var(--color-primary-500);box-shadow:0 0 0 4px color-mix(in srgb, var(--color-primary-500) 30%, transparent)}',
    'html.dark[data-theme] select,html.dark[data-theme] option,html.dark[data-theme] optgroup{background-color:var(--color-surface);color:var(--color-text-primary)}',
    'html.dark[data-theme] .scrollbar-custom::-webkit-scrollbar-thumb{background:var(--color-border)}',
    'html.dark[data-theme] .scrollbar-custom::-webkit-scrollbar-thumb:hover{background:var(--color-dark-hover)}'
  );
  return out.join('\n');
}

/**
 * Script executado ANTES da hidratação: lê o tema e o modo salvos no
 * localStorage e aplica `data-theme` e a classe `dark` no <html>. Sem ele a
 * página abriria roxa/escura por um instante para quem escolheu outro visual.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var r=document.documentElement;function g(k){try{return JSON.parse(localStorage.getItem(k))}catch(e){return null}}var L=${JSON.stringify(LEGACY_THEME_IDS)};var t=g(${JSON.stringify(THEME_STORAGE_KEY)});if(typeof t==='string'&&L[t]){t=L[t]}if(typeof t==='string'&&t!==${JSON.stringify(DEFAULT_THEME)}&&${JSON.stringify(THEME_IDS)}.indexOf(t)>=0){r.setAttribute('data-theme',t)}var m=g(${JSON.stringify(MODE_STORAGE_KEY)});var d=g(${JSON.stringify(LEGACY_DARK_KEY)});var dark;if(m==='system'){dark=window.matchMedia('(prefers-color-scheme: dark)').matches}else if(m==='light'){dark=false}else if(m==='dark'){dark=true}else{dark=(d===null||d===undefined)?true:!!d}r.classList.toggle('dark',dark)}catch(e){}})();`;
