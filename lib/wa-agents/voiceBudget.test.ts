// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { assertUsageHealthy, runWithUsageContext } from '@/lib/ai-usage/context';
import type { UsageContext } from '@/lib/ai-usage/types';
import { prepareVoiceFile } from './voice';
import type { AgentRow } from './types';

const h = vi.hoisted(() => ({ reserve: vi.fn(), dispatch: vi.fn(), settle: vi.fn(), block: vi.fn(), budget: vi.fn() }));
vi.mock('@/lib/ai-usage/budget', () => ({ reserveUsage: h.reserve, dispatchUsage: h.dispatch, settleUsage: h.settle, blockConversationBudget: h.block, checkConversationBudget: h.budget }));
vi.mock('./model', () => ({ getOrganizationApiKey: vi.fn() }));
const upload = vi.fn();
const admin = { storage: { from: () => ({ upload }) } } as unknown as SupabaseClient;
const context: UsageContext = { admin, organizationId: 'office', conversationId: 'conversation', accountId: 'account', agentId: 'agent', runId: null, dealId: null, scope: 'conversation', policyEnabled: true };
const agent = { organization_id: 'office', audio_api_key: 'offline-fixture-key' } as AgentRow;

beforeEach(() => {
  vi.clearAllMocks();
  h.reserve.mockResolvedValue({ allowed: true, replay: false, attempt_id: 'attempt' });
  h.dispatch.mockResolvedValue(true); h.settle.mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllGlobals());

describe('voice provider billing errors (offline)', () => {
  it.each([
    { name: 'billing', status: 429, body: JSON.stringify({ error: { code: 'credit_balance_exhausted', type: 'insufficient_quota', message: 'private response fixture' } }), expected: 'rejected' },
    { name: 'throttling', status: 429, body: JSON.stringify({ error: { code: 'rate_limit_exceeded' } }), expected: 'unknown' },
    { name: 'invalid code with a billing type', status: 429, body: JSON.stringify({ error: { code: 429, type: 'insufficient_quota' } }), expected: 'unknown' },
    { name: 'server failure', status: 503, body: JSON.stringify({ error: { code: 'credit_balance_exhausted' } }), expected: 'unknown' },
    { name: 'invalid body', status: 429, body: 'not JSON', expected: 'unknown' },
    { name: 'oversized body', status: 429, body: JSON.stringify({ error: { code: 'credit_balance_exhausted', message: 'x'.repeat(17000) } }), expected: 'unknown' },
  ])('$name does not send or upload audio and settles as $expected', async ({ status, body, expected }) => {
    const fetch = vi.fn(async () => new Response(body, { status }));
    vi.stubGlobal('fetch', fetch);
    await runWithUsageContext(context, async () => {
      await expect(prepareVoiceFile(admin, agent, 'Private spoken fixture')).rejects.toThrow();
      expect(() => assertUsageHealthy()).toThrow();
    });
    expect(h.settle).toHaveBeenCalledExactlyOnceWith(context, 'attempt', expect.objectContaining({ status: expected }));
    expect(JSON.stringify(h.settle.mock.calls)).not.toContain('private response fixture');
    expect(JSON.stringify(h.settle.mock.calls)).not.toContain('offline-fixture-key');
    expect(JSON.stringify(h.settle.mock.calls)).not.toContain('Private spoken fixture');
    expect(fetch).toHaveBeenCalledTimes(1); expect(upload).not.toHaveBeenCalled();
  });

  it('keeps a voice timeout reserved as unknown with no retry', async () => {
    const fetch = vi.fn(async () => { throw new Error('timeout'); });
    vi.stubGlobal('fetch', fetch);
    await runWithUsageContext(context, async () => {
      await expect(prepareVoiceFile(admin, agent, 'Offline fixture')).rejects.toThrow('timeout');
      expect(() => assertUsageHealthy()).toThrow('timeout');
    });
    expect(h.settle).toHaveBeenCalledExactlyOnceWith(context, 'attempt', expect.objectContaining({ status: 'unknown' }));
    expect(fetch).toHaveBeenCalledTimes(1); expect(upload).not.toHaveBeenCalled();
  });
});
