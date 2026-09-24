import { DEFAULT_LABEL_COLOR, isLabelColor, LABEL_DOT_CLASS, type LabelColor } from './labels';

/** Keep the old CRM color format at its API boundary. */
export function legacyTagColor(color: string): string {
  return LABEL_DOT_CLASS[catalogColor(color)];
}

export function catalogColor(color: unknown): LabelColor {
  if (isLabelColor(color)) return color;
  if (typeof color !== 'string') return DEFAULT_LABEL_COLOR;
  const match = color.match(/(?:bg-)?(blue|sky|green|emerald|yellow|amber|orange|red|rose|pink|purple|violet|teal|slate|gray|zinc)(?:-\d+)?/);
  const aliases: Record<string, LabelColor> = { sky: 'blue', emerald: 'green', amber: 'yellow', rose: 'red', violet: 'purple', gray: 'slate', zinc: 'slate' };
  return match ? aliases[match[1]] ?? (isLabelColor(match[1]) ? match[1] : DEFAULT_LABEL_COLOR) : DEFAULT_LABEL_COLOR;
}

export function labelDelta(before: string[], after: string[]) {
  return {
    addLabelIds: [...new Set(after)].filter(id => !before.includes(id)),
    removeLabelIds: [...new Set(before)].filter(id => !after.includes(id)),
  };
}

/** Only the persisted link determines which lead is shown/changed. */
export function linkedDeal<T extends { id: string }>(deals: T[], dealId: string | null | undefined, isGroup: boolean): T | null {
  return isGroup || !dealId ? null : deals.find(deal => deal.id === dealId) ?? null;
}
