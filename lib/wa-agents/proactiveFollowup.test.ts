import { describe, expect, it, vi } from 'vitest';
import { checkProactiveFollowup } from './proactiveFollowup';
import { loadFollowupCalendar } from './followupCalendarStore';

function db(rows: Record<string, unknown>, fail?: string) {
  return { rpc: async () => ({ data: rows.budget ?? { blocked_at: null }, error: null }), from: (table: string) => {
    const q = { in: () => q, not: () => q, order: () => q, limit: () => q, select: vi.fn(() => q), eq: vi.fn(() => q), maybeSingle: async () => ({ data: (table === 'wa_messages' ? { created_at: (rows.wa_conversations as typeof conv)?.last_inbound_at } : rows[table]) ?? null, error: fail === table ? { message: 'offline' } : null }) };
    return q;
  } } as never;
}
const anchor = '2026-11-05T10:00:00Z';
const now = new Date('2026-11-07T16:00:00Z'); // Saturday
const conv = { last_inbound_at: anchor, ai_status: 'active', ai_approval: null };
const calendar = { enabled: true, timezone: 'America/Manaus', slots: [{ day: 1, start: '09:00', end: '18:00' }] };

describe('proactive follow-up guard', () => {
  it('moves weekend work to Monday in the configured timezone', async () => {
    expect(await checkProactiveFollowup(db({ wa_conversations: conv, followup_calendars: calendar }), 'org', 'conv', { anchor }, now))
      .toEqual({ kind: 'defer', until: '2026-11-09T13:00:00.000Z' });
  });
  it('preserves unrestricted existing organizations', async () => {
    expect(await checkProactiveFollowup(db({ wa_conversations: conv }), 'org', 'conv', { anchor }, now)).toEqual({ kind: 'allowed' });
  });
  it.each(['paused', 'stopped', 'awaiting_approval'])('never resumes %s', async ai_status => {
    expect((await checkProactiveFollowup(db({ wa_conversations: { ...conv, ai_status } }), 'org', 'conv', { anchor }, now)).kind).toBe('cancel');
  });
  it('cancels a stale follow-up after the customer answers', async () => {
    expect((await checkProactiveFollowup(db({ wa_conversations: { ...conv, last_inbound_at: '2026-11-06T10:00:00Z' } }), 'org', 'conv', { anchor }, now)).kind).toBe('cancel');
  });
  it('fails closed on calendar read errors', async () => {
    await expect(checkProactiveFollowup(db({ wa_conversations: conv }, 'followup_calendars'), 'org', 'conv', { anchor }, now)).rejects.toThrow('offline');
  });
  it('rejects invalid stored calendars', async () => {
    await expect(loadFollowupCalendar(db({ followup_calendars: { ...calendar, slots: [] } }), 'org')).rejects.toThrow();
  });
  it.each([{ stage_id: 'other' }, { is_won: true }, { is_lost: true }, { deleted_at: anchor }])('cancels when the deal changes: %o', async change => {
    const rows = { wa_conversations: conv, deals: { stage_id: 'stage', ...change } };
    expect((await checkProactiveFollowup(db(rows), 'org', 'conv', { anchor, dealId: 'deal', stageId: 'stage', ruleVersion: 1 }, now)).kind).toBe('cancel');
  });
  it('cancels a robot continuation after the stage rule changes', async () => {
    expect((await checkProactiveFollowup(db({ wa_conversations: conv, deals: { stage_id: 'stage' }, stage_followup_rules: { enabled: true, version: 2 } }), 'org', 'conv', { anchor, dealId: 'deal', stageId: 'stage', ruleVersion: 1 }, now)).kind).toBe('cancel');
  });
});

describe('retorno explicitamente combinado', () => {
  const bound = { ...conv, connection_id: 'number-1' };
  const saved = { scheduled_for: now.toISOString(), scheduled_anchor: anchor, scheduled_connection_id: 'number-1', status: 'running' };
  const context = { anchor, scheduledReturnId: 'scheduled' };
  const rows = { wa_conversations: bound, wa_bot_runs: saved, followup_calendars: calendar };
  it('permite o sábado combinado, inclusive se o worker atrasar', async () => {
    for (const at of [now, new Date(now.getTime() + 3600_000)]) {
      expect(await checkProactiveFollowup(db(rows), 'org', 'conv', context, at)).toEqual({ kind: 'allowed' });
    }
  });
  it('não inicia antes do horário salvo', async () => {
    expect(await checkProactiveFollowup(db(rows), 'org', 'conv', context, new Date(now.getTime() - 1000)))
      .toEqual({ kind: 'defer', until: saved.scheduled_for });
  });
  it.each([
    { wa_bot_runs: null },
    { wa_bot_runs: { ...saved, status: 'cancelled' } },
    { wa_bot_runs: { ...saved, scheduled_connection_id: 'other' } },
    { wa_bot_runs: { ...saved, scheduled_anchor: null } },
    { budget: { blocked_at: anchor } },
    { wa_conversations: { ...bound, ai_status: 'paused' } },
    { wa_conversations: { ...bound, last_inbound_at: '2026-11-06T10:00:00Z' } },
  ])('não usa exceção para contexto inválido: %o', async change => {
    expect((await checkProactiveFollowup(db({ ...rows, ...change }), 'org', 'conv', context, now)).kind).toBe('cancel');
  });
  it('um retorno pendente adia follow-up ordinário sem criar outra tentativa', async () => {
    expect(await checkProactiveFollowup(db(rows), 'org', 'conv', { anchor }, new Date(now.getTime() - 1000)))
      .toEqual({ kind: 'defer', until: new Date(now.getTime() + 59000).toISOString() });
  });
  it('aceita timestamps equivalentes com formatos diferentes', async () => {
    expect(await checkProactiveFollowup(db({ ...rows, wa_bot_runs: { ...saved, scheduled_anchor: '2026-11-05T10:00:00+00:00' } }), 'org', 'conv', context, now))
      .toEqual({ kind: 'allowed' });
  });
});
