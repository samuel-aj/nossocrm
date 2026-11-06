import { z } from 'zod';
export const ReturnTimeSchema = z.object({
  local: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
  timezone: z.string().min(1).max(100),
  context: z.string().trim().min(1).max(1000),
  confirmed: z.literal(true),
});
export type ReturnTimeInput = z.infer<typeof ReturnTimeSchema>;

/** Reject DST folds/gaps rather than silently moving the agreed appointment. */
export function resolveReturnTime(input: ReturnTimeInput, now = new Date()): string {
  const value = ReturnTimeSchema.parse(input);
  const formatter = new Intl.DateTimeFormat('sv-SE', { timeZone: value.timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const nominal = Date.parse(value.local + ':00Z');
  if (!Number.isFinite(nominal)) throw new Error('Data inválida');
  const matches: number[] = [];
  // Modern IANA offsets are in whole minutes; search covers UTC-12 through UTC+14.
  for (let offset = -14 * 60; offset <= 14 * 60; offset++) {
    const instant = nominal + offset * 60_000;
    if (formatter.format(new Date(instant)).replace(' ', 'T') === value.local) matches.push(instant);
  }
  if (matches.length !== 1) throw new Error('Horário inexistente ou ambíguo neste fuso; combine outro horário');
  if (matches[0] <= now.getTime() || matches[0] > now.getTime() + 90 * 86400000) throw new Error('Escolha um horário futuro, dentro de 90 dias');
  return new Date(matches[0]).toISOString();
}
