import { beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ budget: vi.fn(), approved: vi.fn(), agent: vi.fn(), check: vi.fn(), run: vi.fn(), rpc: vi.fn() }));
vi.mock('@/lib/ai-usage/budget', () => ({ checkConversationBudget: h.budget }));
vi.mock('./beta', () => ({ isAiAgentsApproved: h.approved }));
vi.mock('./context', () => ({ loadAgent: h.agent }));
vi.mock('./proactiveFollowup', () => ({ checkProactiveFollowup: h.check }));
vi.mock('./engine', () => ({ runAgentOnConversation: h.run }));
import { startStageFollowupAgent } from './stageFollowupAgent';
const input = { organizationId: 'org', conversationId: 'conv', agentId: 'agent', instruction: 'Retome a proposta', proactive: { anchor: '2026-11-05T10:00:00Z' } };
const db = { rpc: h.rpc } as never;
beforeEach(() => {
  vi.clearAllMocks(); h.budget.mockResolvedValue({ blocked_at: null }); h.approved.mockResolvedValue(true);
  h.agent.mockResolvedValue({ enabled: true }); h.check.mockResolvedValue({ kind: 'allowed' });
  h.rpc.mockResolvedValue({ data: true }); h.run.mockResolvedValue({ status: 'ok' });
});
it('starts the selected agent with follow-up instruction on the same conversation', async () => {
  expect(await startStageFollowupAgent(db, input)).toEqual({ ok: true });
  expect(h.run).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'agent', conversationId: 'conv', trigger: 'followup', followup: expect.objectContaining({ instruction: input.instruction }) }));
});
it('never unlocks a consumed budget', async () => {
  h.budget.mockResolvedValue({ blocked_at: 'blocked' });
  expect((await startStageFollowupAgent(db, input)).ok).toBe(false);
  expect(h.rpc).not.toHaveBeenCalled(); expect(h.run).not.toHaveBeenCalled();
});
it('respects a human pause detected just before activation', async () => {
  h.rpc.mockResolvedValue({ data: false });
  expect((await startStageFollowupAgent(db, input)).ok).toBe(false); expect(h.run).not.toHaveBeenCalled();
});
it('does not activate a disabled agent', async () => {
  h.agent.mockResolvedValue({ enabled: false });
  expect((await startStageFollowupAgent(db, input)).ok).toBe(false); expect(h.rpc).not.toHaveBeenCalled();
});
it('returns deferral without activation if the calendar closes', async () => {
  h.check.mockResolvedValue({ kind: 'defer', until: '2026-11-09T13:00:00Z' });
  expect(await startStageFollowupAgent(db, input)).toMatchObject({ ok: false, deferredUntil: '2026-11-09T13:00:00Z' });
  expect(h.rpc).not.toHaveBeenCalled();
});
