import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ run: vi.fn(), create: vi.fn(), rules: [] as unknown[], claim: vi.fn() }));
vi.mock('./beta', () => ({ isAiAgentsApproved: async () => true }));
vi.mock('./context', () => ({ loadAgent: async () => ({ followups: h.rules }) }));
vi.mock('./engine', () => ({ runAgentOnConversation: h.run }));
vi.mock('./bots', () => ({ createBotRun: h.create, runBotRunNow: vi.fn() }));
import { processFollowups } from './followups';
const cycle = '2026-11-06T10:00:00Z';
const calendar = { enabled: true, timezone: 'America/Manaus', slots: [{ day: 1, start: '09:00', end: '18:00' }] };
function db(enabled = true) {
  const rows: Record<string, unknown[]> = {
    followup_calendars: [{ ...calendar, enabled }],
    wa_ai_agents: [{ id: 'agent', organization_id: 'org', followups: h.rules }],
    wa_conversations: [{ id: 'conv', organization_id: 'org', ai_agent_id: 'agent', last_inbound_at: cycle, ai_state: {} }],
    wa_messages: [{ created_at: '2026-11-06T10:01:00Z' }],
  };
  return { rpc: h.claim, from: (table: string) => {
    let single = false;
    const q = { select: () => q, eq: () => q, gt: () => q, limit: () => q, order: () => q,
      maybeSingle: () => { single = true; return q; },
      then: (resolve: (r: unknown) => void) => resolve({ data: single ? rows[table]?.[0] ?? null : rows[table] ?? [], error: null }) };
    return q;
  } } as never;
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-09T14:00:00Z'));
  vi.clearAllMocks(); h.claim.mockResolvedValue({ data: true }); h.run.mockResolvedValue({ status: 'ok' });
  h.rules = [60, 360, 1440].map(after_minutes => ({ id: String(after_minutes), after_minutes, kind: 'agent', instruction: 'retome', only_in_window: false }));
});
afterEach(() => vi.useRealTimers());
it('does not consume or call anything during the weekend', async () => {
  vi.setSystemTime(new Date('2026-11-07T14:00:00Z'));
  await processFollowups(db());
  expect(h.claim).not.toHaveBeenCalled(); expect(h.run).not.toHaveBeenCalled(); expect(h.create).not.toHaveBeenCalled();
});
it('Monday executes only the latest overdue rule, claiming the backlog together', async () => {
  expect((await processFollowups(db())).fired).toBe(1);
  expect(h.run).toHaveBeenCalledTimes(1);
  expect(h.claim).toHaveBeenCalledWith('claim_agent_followup', expect.objectContaining({ p_done: ['60', '360', '1440'], p_cycle: cycle }));
});
it('preserves the existing order when calendar is disabled', async () => {
  await processFollowups(db(false));
  expect(h.claim).toHaveBeenCalledWith('claim_agent_followup', expect.objectContaining({ p_done: ['60'] }));
});
it('does not execute when another worker wins the claim', async () => {
  h.claim.mockResolvedValue({ data: false });
  await processFollowups(db()); expect(h.run).not.toHaveBeenCalled();
});
it('restores pending rules when the window closes before an outbound', async () => {
  h.run.mockResolvedValue({ status: 'skipped', deferredUntil: '2026-11-16T13:00:00Z' });
  await processFollowups(db());
  expect(h.claim).toHaveBeenCalledTimes(2);
  expect(h.claim.mock.calls[1][1]).toMatchObject({ p_expected: { cycle, done: ['60', '360', '1440'] }, p_done: [] });
});
it('passes proactive scope to a follow-up robot', async () => {
  h.rules = [{ id: 'bot', after_minutes: 60, kind: 'bot', bot_id: 'robot' }];
  h.create.mockResolvedValue({ ok: true, run: {} });
  await processFollowups(db());
  expect(h.create).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ proactive: { anchor: cycle }, conversationId: 'conv' }));
});
