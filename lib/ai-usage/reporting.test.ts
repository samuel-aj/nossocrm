import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { canonicalizeUsageAccounts, readUsageAttempts, summarizeContractUsage, summarizeUsage, usageAccountRoots, usagePeriod, type UsageAttempt } from './reporting';

const period = usagePeriod('2026-10-01', '2026-10-31', 'America/Manaus');
const row = (patch: Partial<UsageAttempt> = {}): UsageAttempt => ({ id: 'one', account_id: 'account', conversation_id: 'chat', agent_id: 'agent', deal_id: 'deal', scope: 'conversation', operation: 'reply', provider: 'openai', model: 'model', unit: 'tokens', status: 'completed', reserved_amount: 150, actual_amount: 100, input_tokens: 70, output_tokens: 30, total_tokens: 100, estimated_cost_usd: null, created_at: '2026-10-10T14:00:00.000Z', ...patch });

describe('consumption reporting', () => {
  it('uses organization local dates and exclusive end; validates calendar days', () => {
    expect(usagePeriod('2026-10-19', '2026-10-19', 'America/Manaus')).toMatchObject({ start: '2026-10-19T04:00:00.000Z', end: '2026-10-20T04:00:00.000Z' });
    expect(() => usagePeriod('2026-02-30', '2026-03-01', 'UTC')).toThrow();
    const dst = usagePeriod('2026-03-08', '2026-03-08', 'America/New_York');
    expect(Date.parse(dst.end) - Date.parse(dst.start)).toBe(23 * 3600000);
    expect(summarizeUsage([row({ created_at: period.end })], period).tokens).toBe(0);
    expect(summarizeUsage([row({ created_at: '2026-10-01T04:00:00+00:00' })], period).tokens).toBe(100);
  });
  it('does not turn unknown consumption or absent prices into zero spending', () => {
    const result = summarizeUsage([row(), row({ id: 'pending', status: 'unknown', actual_amount: null, input_tokens: null, output_tokens: null, total_tokens: null, reserved_amount: 200 })], period);
    expect(result.tokens).toBe(100); expect(result.pendingTokens).toBe(200); expect(result.pendingOperations).toBe(1);
    expect(result.estimatedCostUsd).toBeNull(); expect(result.unpricedOperations).toBe(1); expect(result.conversations[0].costUsd).toBeNull();
  });
  it('divides only conversation tokens by distinct spending accounts, excludes test from average', () => {
    const result = summarizeUsage([row(), row({ id: 'two', conversation_id: 'other-number' }), row({ id: 'test', scope: 'test', account_id: null, actual_amount: 900, total_tokens: 900, input_tokens: 900, output_tokens: 0 })], period);
    expect(result.tokens).toBe(1100); expect(result.averageTokens).toBe(200); expect(result.conversationCount).toBe(1); expect(result.otherTokens).toBe(900);
  });
  it('does not double-count an attendance merged across connected numbers', () => {
    const roots = usageAccountRoots([{ id: 'a', merged_into: null }, { id: 'b', merged_into: 'a' }, { id: 'c', merged_into: 'b' }]);
    const input = [row({ account_id: 'a' }), row({ id: 'b', account_id: 'b' }), row({ id: 'c', account_id: 'c' })];
    const result = summarizeUsage(canonicalizeUsageAccounts(input, roots), period);
    expect(result.conversationCount).toBe(1); expect(result.averageTokens).toBe(300); expect(input[1].account_id).toBe('b');
    expect(() => usageAccountRoots([{ id: 'a', merged_into: 'b' }, { id: 'b', merged_into: 'a' }])).toThrow();
  });
  it('labels a per-conversation subtotal when any confirmed operation has no price', () => {
    const result = summarizeUsage([row({ estimated_cost_usd: 0.2 }), row({ id: 'unpriced' })], period);
    expect(result.conversations[0]).toMatchObject({ costUsd: 0.2, unpriced: 1 }); expect(result.unpricedOperations).toBe(1);
  });
  it('aggregates every page and fails rather than showing an incomplete total', async () => {
    const data = Array.from({ length: 1105 }, (_, i) => row({ id: String(i).padStart(5, '0') }));
    let cursor = '';
    const limit = vi.fn((size: number) => Promise.resolve({ data: data.filter(r => r.id > cursor).slice(0, size), error: null }));
    const gt = vi.fn((_key: string, value: string) => { cursor = value; return query; });
    const query = { select: () => query, eq: () => query, gte: () => query, lt: () => query, order: () => query, gt, limit };
    const admin = { from: () => { cursor = ''; return query; } } as unknown as SupabaseClient;
    expect((await readUsageAttempts(admin, 'org', period)).length).toBe(1105); expect(limit).toHaveBeenCalledTimes(3); expect(gt).toHaveBeenCalledTimes(2);
    limit.mockResolvedValueOnce({ data: [], error: { message: 'fail' } } as never);
    await expect(readUsageAttempts(admin, 'org', period)).rejects.toThrow();
  });
});

describe('consumption until first contract', () => {
  const coverage = '2026-10-01T04:00:00.000Z';
  const won = { deal_id: 'deal', occurred_at: '2026-10-15T12:00:00.000Z', deal_created_at: '2026-10-03T12:00:00.000Z' };
  it('counts multiple linked conversations once and ignores reopen/new gain and post-gain expense', () => {
    const result = summarizeContractUsage([row({ estimated_cost_usd: 0.1 }), row({ id: 'other', account_id: 'two', estimated_cost_usd: 0.2 }), row({ id: 'late', created_at: '2026-10-16T00:00:00.000Z' })], [won, { ...won, occurred_at: '2026-10-20T00:00:00.000Z' }], coverage, period);
    expect(result).toMatchObject({ wonDeals: 1, coveredDeals: 1, tokens: 200, averageTokens: 200, pricedDeals: 1 }); expect(result.averageCostUsd).toBeCloseTo(0.3);
  });
  it.each([
    { rows: [row({ status: 'unknown', actual_amount: null })] },
    { rows: [row(), row({ id: 'unknown-link', deal_id: null })] },
    { rows: [row(), row({ id: 'ambiguous', deal_id: 'another' })] },
  ])('excludes incomplete or ambiguous records (%j)', ({ rows }) => {
    expect(summarizeContractUsage(rows, [won], coverage, period)).toMatchObject({ coveredDeals: 0, excludedDeals: 1, averageCostUsd: null, averageTokens: null });
  });
  it('excludes old leads and prior-period first gains', () => {
    expect(summarizeContractUsage([row()], [{ ...won, deal_created_at: '2026-09-01T00:00:00Z' }], coverage, period).excludedDeals).toBe(1);
    expect(summarizeContractUsage([row()], [{ ...won, occurred_at: '2026-09-01T00:00:00Z' }, won], coverage, period).wonDeals).toBe(0);
  });
});
