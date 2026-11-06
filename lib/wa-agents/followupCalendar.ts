import { z } from 'zod';

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const slot = z.object({ day: z.number().int().min(0).max(6), start: time, end: time }).strict();
export const FollowupCalendarSchema = z.object({
  enabled: z.boolean(),
  timezone: z.string().min(1).max(100).refine(value => {
    try { new Intl.DateTimeFormat('en', { timeZone: value }).format(); return true; } catch { return false; }
  }, 'Escolha um fuso válido'),
  slots: z.array(slot).max(28),
}).strict().superRefine((value, ctx) => {
  if (value.enabled && !value.slots.length) ctx.addIssue({ code: 'custom', path: ['slots'], message: 'Escolha pelo menos um horário' });
  for (const [index, item] of value.slots.entries()) {
    if (item.start >= item.end) ctx.addIssue({ code: 'custom', path: ['slots', index], message: 'O fim deve ser posterior ao início' });
    if (value.slots.slice(0, index).some(other => other.day === item.day && other.start < item.end && item.start < other.end)) {
      ctx.addIssue({ code: 'custom', path: ['slots', index], message: 'Os horários não podem se sobrepor' });
    }
  }
});
export type FollowupCalendar = z.infer<typeof FollowupCalendarSchema>;

/** Returns the earliest allowed instant, preserving the original due date when unrestricted. */
export function nextFollowupWindow(calendar: FollowupCalendar, due: Date): Date {
  if (!Number.isFinite(due.getTime())) throw new Error('Data inválida');
  if (!calendar.enabled) return new Date(due);
  const valid = FollowupCalendarSchema.parse(calendar);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: valid.timezone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const open = (at: Date) => {
    const parts = formatter.formatToParts(at);
    const value = (type: string) => parts.find(part => part.type === type)?.value ?? '';
    const day = days.indexOf(value('weekday'));
    const localTime = `${value('hour')}:${value('minute')}`;
    return valid.slots.some(item => item.day === day && item.start <= localTime && localTime < item.end);
  };
  if (open(due)) return new Date(due);
  // Walk absolute minutes, so skipped/repeated local hours follow actual timezone transitions.
  const first = Math.floor(due.getTime() / 60_000) * 60_000 + 60_000;
  for (let offset = 0; offset < 15 * 24 * 60; offset++) {
    const candidate = new Date(first + offset * 60_000);
    if (open(candidate)) return candidate;
  }
  throw new Error('Não foi possível encontrar o próximo horário de follow-up');
}
