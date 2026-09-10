import { z } from 'zod';

export const PERIOD_LABELS = {
  all: 'Sem limite de período', today: 'Hoje', yesterday: 'Ontem', last7: 'Últimos 7 dias',
  last30: 'Últimos 30 dias', lastMonth: 'Mês passado', thisMonth: 'Este mês', custom: 'Personalizado',
} as const;
const date = z.string().refine(v => v === '' || (/^\d{4}-\d{2}-\d{2}$/.test(v) && v >= '1900-01-01' &&
  !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v));
export const periodSchema = z.object({
  preset: z.enum(['all', 'today', 'yesterday', 'last7', 'last30', 'lastMonth', 'thisMonth', 'custom']),
  start: date, end: date,
  created: z.boolean(), closed: z.boolean(), logic: z.enum(['AND', 'OR']),
}).strict().refine(v => v.created || v.closed, 'Selecione pelo menos uma data.')
  .refine(v => v.preset !== 'custom' || (!!v.start && !!v.end && v.start <= v.end), 'Informe um intervalo válido.');
export const generalSchema = z.object({
  status: z.enum(['open', 'won', 'lost', 'all']),
  owner: z.string().max(80), product: z.string().max(80), tag: z.string().max(200),
  logic: z.enum(['AND', 'OR']),
  conditions: z.array(z.object({
    id: z.string().max(80), field: z.string().max(200),
    operator: z.enum(['contains', 'not_contains', 'equals', 'empty', 'not_empty']), value: z.string().max(2000),
  }).strict()).max(30),
}).strict();
export type PeriodSettings = z.infer<typeof periodSchema>;
export type GeneralSettings = z.infer<typeof generalSchema>;
export type BoardFilterDefaults = { period: PeriodSettings | null; general: GeneralSettings | null };
export const EMPTY_PERIOD: PeriodSettings = { preset: 'all', start: '', end: '', created: true, closed: false, logic: 'AND' };
export const EMPTY_GENERAL: GeneralSettings = { status: 'open', owner: 'all', product: '', tag: '', logic: 'AND', conditions: [] };

function localDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function periodRange(value: PeriodSettings, now = new Date()) {
  if (value.preset === 'all') return { start: '', end: '' };
  if (value.preset === 'custom') return { start: value.start, end: value.end };
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start);
  if (value.preset === 'yesterday') { start.setDate(start.getDate() - 1); end.setDate(end.getDate() - 1); }
  if (value.preset === 'last7') start.setDate(start.getDate() - 6);
  if (value.preset === 'last30') start.setDate(start.getDate() - 29);
  if (value.preset === 'thisMonth') { start.setDate(1); end.setMonth(end.getMonth() + 1, 0); }
  if (value.preset === 'lastMonth') { start.setMonth(start.getMonth() - 1, 1); end.setDate(0); }
  return { start: localDate(start), end: localDate(end) };
}
export function matchesPeriod(deal: { createdAt: string; closedAt?: string | null; isWon: boolean; isLost: boolean }, value: PeriodSettings, now = new Date()) {
  if (value.preset === 'all') return true;
  const { start, end } = periodRange(value, now);
  // A custom draft is never used as a half-filled range.
  if (!start || !end || start > end) return true;
  const from = new Date(`${start}T00:00:00`).getTime();
  const until = new Date(`${end}T23:59:59.999`).getTime();
  const inRange = (v?: string | null) => !!v && new Date(v).getTime() >= from && new Date(v).getTime() <= until;
  const checks: boolean[] = [];
  if (value.created) checks.push(inRange(deal.createdAt));
  if (value.closed) checks.push((deal.isWon || deal.isLost) && inRange(deal.closedAt));
  return value.logic === 'AND' ? checks.every(Boolean) : checks.some(Boolean);
}
export function matchesProduct(items: Array<{ productId: string }>, product: string) {
  return !product || items.some(item => item.productId === product);
}
