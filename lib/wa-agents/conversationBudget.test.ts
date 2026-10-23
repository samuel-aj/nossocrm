import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
const h = vi.hoisted(() => ({ budget: vi.fn(), update: vi.fn(), event: vi.fn() }));
vi.mock('@/lib/ai-usage/budget', () => ({ checkConversationBudget: h.budget }));
vi.mock('./webhooks', () => ({ dispatchAgentEvent: h.event }));
import { applyConversationAction } from './conversation';

function fakeDb() {
  const query = {
    select: () => query, eq: () => query,
    update: h.update,
    maybeSingle: async () => ({ data: { id: 'conv', organization_id: 'org', ai_status: 'paused', ai_agent_id: 'agent' }, error: null }),
  };
  return { from: () => query } as unknown as SupabaseClient;
}
beforeEach(() => { vi.clearAllMocks(); h.budget.mockReset().mockResolvedValue({ blocked_at: '2026-10-23T00:00:00Z' }); });
describe('persistent consumption block', () => {
  it.each(['start', 'resume', 'approve'] as const)('prevents %s before any conversation mutation or webhook', async action => {
    const result = await applyConversationAction(fakeDb(), { organizationId: 'org', conversationId: 'conv', agentId: 'another-agent', action, userId: 'user' });
    expect(result).toMatchObject({ ok: false, status: 409 });
    expect(h.update).not.toHaveBeenCalled(); expect(h.event).not.toHaveBeenCalled();
  });
  it('does not resume when the balance service fails', async () => {
    h.budget.mockRejectedValue(new Error('unavailable'));
    const result = await applyConversationAction(fakeDb(), { organizationId: 'org', conversationId: 'conv', action: 'resume' });
    expect(result.ok).toBe(false); expect(h.update).not.toHaveBeenCalled();
  });
});
