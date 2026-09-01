/**
 * Etiquetas do WhatsApp (modelo do WhatsApp Business): entidade da
 * organização, com nome e cor, marcada nas conversas.
 *
 * CLIENT-SAFE: só tipos, constantes e funções puras — a tela usa a mesma
 * paleta que o servidor valida, sem duas listas pra desencontrar.
 */

/** Cores possíveis. Guardamos a CHAVE (não o hex): o tom vem do tema do CRM. */
export const LABEL_COLORS = [
  'blue',
  'green',
  'yellow',
  'orange',
  'red',
  'pink',
  'purple',
  'teal',
  'slate',
] as const;

export type LabelColor = (typeof LABEL_COLORS)[number];

export const DEFAULT_LABEL_COLOR: LabelColor = 'slate';

export interface WaLabel {
  id: string;
  name: string;
  color: LabelColor;
}

export const MAX_LABEL_NAME = 40;
/** Teto por organização: lista maior que isso vira rolagem infinita na tela. */
export const MAX_LABELS_PER_ORG = 50;
/** Teto por conversa, como no WhatsApp Business. */
export const MAX_LABELS_PER_CHAT = 20;

export function isLabelColor(value: unknown): value is LabelColor {
  return typeof value === 'string' && (LABEL_COLORS as readonly string[]).includes(value);
}

/** Nome utilizável: sem espaço nas pontas e dentro do limite. '' = inválido. */
export function normalizeLabelName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.trim().slice(0, MAX_LABEL_NAME);
}

/** Chave de comparação: dois nomes que só diferem em caixa são o mesmo. */
export function labelKey(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Classes da bolinha e do selo por cor. Ficam aqui (e não espalhadas na tela)
 * pra etiqueta ter a mesma aparência em qualquer lugar do CRM.
 */
export const LABEL_DOT_CLASS: Record<LabelColor, string> = {
  blue: 'bg-sky-500',
  green: 'bg-emerald-500',
  yellow: 'bg-amber-400',
  orange: 'bg-orange-500',
  red: 'bg-rose-500',
  pink: 'bg-pink-500',
  purple: 'bg-violet-500',
  teal: 'bg-teal-500',
  slate: 'bg-slate-400',
};

export const LABEL_CHIP_CLASS: Record<LabelColor, string> = {
  blue: 'bg-sky-50 text-sky-700 ring-sky-200/70 dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-400/20',
  green:
    'bg-emerald-50 text-emerald-700 ring-emerald-200/70 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-400/20',
  yellow:
    'bg-amber-50 text-amber-700 ring-amber-200/70 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-400/20',
  orange:
    'bg-orange-50 text-orange-700 ring-orange-200/70 dark:bg-orange-500/10 dark:text-orange-300 dark:ring-orange-400/20',
  red: 'bg-rose-50 text-rose-700 ring-rose-200/70 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-400/20',
  pink: 'bg-pink-50 text-pink-700 ring-pink-200/70 dark:bg-pink-500/10 dark:text-pink-300 dark:ring-pink-400/20',
  purple:
    'bg-violet-50 text-violet-700 ring-violet-200/70 dark:bg-violet-500/10 dark:text-violet-300 dark:ring-violet-400/20',
  teal: 'bg-teal-50 text-teal-700 ring-teal-200/70 dark:bg-teal-500/10 dark:text-teal-300 dark:ring-teal-400/20',
  slate:
    'bg-slate-100 text-slate-600 ring-slate-200/70 dark:bg-white/10 dark:text-slate-300 dark:ring-white/10',
};
