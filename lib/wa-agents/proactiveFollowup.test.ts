import { describe, expect, it, vi } from 'vitest';
import { checkProactiveFollowup } from './proactiveFollowup';
import { loadFollowupCalendar } from './followupCalendarStore';

function db(rows: Record<string, unknown>, fail?: string) {
  return { from: (table: string) => {
    const q = { order: () => q, limit: () => q, select: vi.fn(() => q), eq: vi.fn(() => q), maybeSingle: async () => ({ data: (table === 'wa_messages' ? { created_at: (rows.wa_conversations as typeof conv)?.last_inbound_at } : rows[table]) ?? null, error: fail === table ? { message: 'offline' } : null }) };
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
