import type { Deal } from '@/types';
import { getDealLeadSource } from '@/lib/deals/leadSource';
import type { PerformanceMode } from './performanceHistory';

export interface LeadSourceGroup {
  key: string; label: string; count: number; percentage: number; color: string; deals: Deal[];
}
export interface LeadSourceSlice extends LeadSourceGroup { sourceKeys: string[] }
export const UNKNOWN_LEAD_SOURCE_KEY = 'not_informed';
export const LEAD_SOURCE_BASE: Record<PerformanceMode, string> = {
  cohort: 'Leads criados no período e registrados neste funil até a data de apuração.',
  period: 'Leads distintos com entrada registrada no funil no período. Reentradas contam uma vez.',
  current: 'Negócios abertos no funil agora, com a origem do cadastro atual.',
};
export const LEAD_SOURCE_HISTORY_NOTE = 'Nos registros antigos sem origem preservada no evento, a origem foi reconstruída do cadastro disponível. Ela não comprova a origem na data histórica.';
export const leadSourceKey = (source: string | null) => source === null ? UNKNOWN_LEAD_SOURCE_KEY
  : `source:${source.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').replace(/\s+/g, ' ').trim()}`;

const SOURCE_COLORS: Record<string, string> = {
  'source:google ads': '#2563eb', 'source:meta ads': '#7c3aed', 'source:indicacao': '#059669',
  'source:organico/rede social': '#0891b2', 'source:presencial': '#d97706', 'source:outros': '#db2777',
  [UNKNOWN_LEAD_SOURCE_KEY]: '#64748b',
};
export function leadSourceColor(key: string) {
  if (SOURCE_COLORS[key]) return SOURCE_COLORS[key];
  let hash = 0;
  for (const character of key) hash = (Math.imul(hash, 31) + character.charCodeAt(0)) | 0;
  return `hsl(${Math.abs(hash) % 360} 60% 42%)`;
}
/** Never group contact.source or raw UTMs. An explicit native null stays unknown. */
export function groupLeadSources(entries: Deal[]): LeadSourceGroup[] {
  const deals = [...new Map(entries.map(deal => [deal.id, deal])).values()];
  const groups = new Map<string, LeadSourceGroup>();
  for (const deal of deals) {
    const source = getDealLeadSource(deal);
    const key = leadSourceKey(source);
    let group = groups.get(key);
    if (!group) {
      group = { key, label: source || 'Não informado', count: 0, percentage: 0, color: leadSourceColor(key), deals: [] };
      groups.set(key, group);
    }
    group.deals.push(deal);
    group.count++;
  }
  return [...groups.values()].map(group => ({ ...group, percentage: group.count / deals.length * 100 }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'pt-BR'));
}
/** Keep unknown visible and preserve the full category set behind the overflow. */
export function leadSourceSlices(groups: LeadSourceGroup[], limit = 6): LeadSourceSlice[] {
  const direct = (group: LeadSourceGroup): LeadSourceSlice => ({ ...group, sourceKeys: [group.key] });
  if (groups.length <= limit) return groups.map(direct);
  const unknown = groups.find(group => group.key === UNKNOWN_LEAD_SOURCE_KEY);
  const main = groups.filter(group => group !== unknown).slice(0, Math.max(1, limit - (unknown ? 2 : 1)));
  const kept = new Set([...main, ...(unknown ? [unknown] : [])].map(group => group.key));
  const others = groups.filter(group => !kept.has(group.key));
  return [...main.map(direct), {
    key: 'overflow', label: 'Outros (agrupados)', color: '#475569', count: others.reduce((sum, group) => sum + group.count, 0),
    percentage: others.reduce((sum, group) => sum + group.percentage, 0), deals: others.flatMap(group => group.deals),
    sourceKeys: others.map(group => group.key),
  }, ...(unknown ? [direct(unknown)] : [])];
}
