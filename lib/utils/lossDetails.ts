export const lossCategoryLabel = (category?: string) => category === 'qualified' ? 'Qualificado' : category === 'disqualified' ? 'Desqualificado' : 'Classificação não informada';
export const lossReasonLabel = (reason?: string) => reason?.trim() || 'Não informado';
export const lossDetailsDescription = (category?: string, reason?: string) => `Classificação: ${lossCategoryLabel(category)}\nMotivo da perda: ${lossReasonLabel(reason)}`;

/** Cosmetic normalization only. Symbols such as +, < and > retain their meaning. */
export function normalizeLossReason(reason?: string | null): string {
  return (reason ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/\p{P}+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const DUPLICATE_CONTACT_REASONS = new Set(['contato repetido', 'lead repetido', 'repetido']);

/** A report key, never a replacement for the original reason persisted on the lead. */
export function lossReasonGroupKey(reason?: string | null): string {
  const normalized = normalizeLossReason(reason);
  if (!normalized || normalized === 'nao informado') return 'not_informed';
  if (DUPLICATE_CONTACT_REASONS.has(normalized)) return 'duplicate_contact';
  return `text:${normalized}`;
}

export function lossReasonGroupLabel(reason?: string | null): string {
  const key = lossReasonGroupKey(reason);
  if (key === 'not_informed') return 'Não informado';
  if (key === 'duplicate_contact') return 'Contato repetido';
  return lossReasonLabel(reason ?? undefined);
}

export interface LossReasonGroup<T> {
  key: string;
  label: string;
  originals: string[];
  count: number;
  items: T[];
}

/** Groups for cards and drilldowns while retaining each exact source string and item. */
export function groupLossReasons<T extends { lossReason?: string | null }>(items: readonly T[]): LossReasonGroup<T>[] {
  const groups = new Map<string, LossReasonGroup<T>>();
  for (const item of items) {
    const key = lossReasonGroupKey(item.lossReason);
    let group = groups.get(key);
    if (!group) {
      group = { key, label: lossReasonGroupLabel(item.lossReason), originals: [], count: 0, items: [] };
      groups.set(key, group);
    }
    group.count++;
    group.items.push(item);
    if (typeof item.lossReason === 'string' && !group.originals.includes(item.lossReason)) group.originals.push(item.lossReason);
  }
  return [...groups.values()];
}
