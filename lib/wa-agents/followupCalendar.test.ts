import { describe, expect, it } from 'vitest';
import { FollowupCalendarSchema, nextFollowupWindow, type FollowupCalendar } from './followupCalendar';

const calendar: FollowupCalendar = { enabled: true, timezone: 'America/Manaus', slots: [1,2,3,4,5].map(day => ({ day, start: '09:00', end: '18:00' })) };
const next = (date: string, config = calendar) => nextFollowupWindow(config, new Date(date)).toISOString();
describe('calendário de follow-up', () => {
  it('adia sábado para segunda às 9h no fuso configurado', () => expect(next('2026-11-07T18:00:00Z')).toBe('2026-11-09T13:00:00.000Z'));
  it('preserva o instante quando dentro do horário', () => expect(next('2026-11-06T15:12:34Z')).toBe('2026-11-06T15:12:34.000Z'));
  it('inclui início e exclui fim', () => {
    expect(next('2026-11-06T13:00:00Z')).toBe('2026-11-06T13:00:00.000Z');
    expect(next('2026-11-06T22:00:00Z')).toBe('2026-11-09T13:00:00.000Z');
  });
  it('não muda o comportamento quando desligado', () => expect(next('2026-11-07T18:00:00Z', { ...calendar, enabled: false })).toBe('2026-11-07T18:00:00.000Z'));
  it('respeita intervalo de almoço', () => expect(next('2026-11-09T16:15:00Z', { ...calendar, slots: [{ day: 1, start: '09:00', end: '12:00' }, { day: 1, start: '14:00', end: '18:00' }] })).toBe('2026-11-09T18:00:00.000Z'));
  it('atravessa horário local inexistente no início do horário de verão', () => expect(next('2026-03-08T06:59:00Z', { enabled: true, timezone: 'America/New_York', slots: [{ day: 0, start: '02:30', end: '04:00' }] })).toBe('2026-03-08T07:00:00.000Z'));
  it.each([
    { ...calendar, timezone: 'invalid' }, { ...calendar, slots: [] },
    { ...calendar, slots: [{ day: 1, start: '18:00', end: '09:00' }] },
    { ...calendar, slots: [{ day: 1, start: '09:00', end: '12:00' }, { day: 1, start: '11:00', end: '13:00' }] },
  ])('rejeita configuração inválida', value => expect(FollowupCalendarSchema.safeParse(value).success).toBe(false));
});
