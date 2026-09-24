import { describe, expect, it } from 'vitest';
import { automationLabel, buildAutomationMap, matchesAutomation, type AutomationConversation, type AutomationRun } from './automationState';
const conv: AutomationConversation = { id: 'conversation', deal_id: 'lead', contact_id: 'contact', ai_status: 'active', ai_agent_id: 'agent' };
const run: AutomationRun = { id: 'run', deal_id: 'lead', contact_id: 'contact', conversation_id: 'conversation', bot_id: 'bot', status: 'running', wake_at: null };
const base = { dealIds: ['lead', 'other'], conversations: [conv], runs: [] as AutomationRun[], latestOpenDealByContact: new Map([['contact', 'other']]), botNames: new Map([['bot', 'Recuperação']]), agentNames: new Map([['agent', 'Bia']]), now: 1_000 };
describe('exclusive automation projection', () => {
  it('uses explicit AI target instead of marking every lead of a contact', () => {
    expect(buildAutomationMap(base)).toEqual({ lead: { kind: 'ai', state: 'active', name: 'Bia' }, other: null });
  });
  it.each(['paused', 'stopped', 'awaiting_approval', null])('does not call AI %s active', ai_status => {
    expect(buildAutomationMap({ ...base, conversations: [{ ...conv, ai_status }] }).lead).toBeNull();
  });
  it('uses the latest open lead across boards only without an explicit target', () => {
    expect(buildAutomationMap({ ...base, conversations: [{ ...conv, deal_id: null }] }).other?.kind).toBe('ai');
    expect(buildAutomationMap({ ...base, conversations: [{ ...conv, deal_id: 'outside-board' }] })).toEqual({ lead: null, other: null });
  });
  it('keeps waiting replies and scheduled delays active, with distinct explanations', () => {
    const reply = buildAutomationMap({ ...base, runs: [{ ...run, status: 'waiting_reply' }] }).lead!;
    expect(reply.kind).toBe('bot'); expect(automationLabel(reply)).toContain('aguardando resposta');
    const timer = buildAutomationMap({ ...base, runs: [{ ...run, wake_at: new Date(2_000).toISOString() }] }).lead!;
    expect(automationLabel(timer)).toContain('aguardando prazo');
  });
  it.each(['done', 'error', 'cancelled'])('returns to tasks after bot %s', status => {
    expect(buildAutomationMap({ ...base, conversations: [{ ...conv, ai_status: 'stopped' }], runs: [{ ...run, status }] }).lead).toBeNull();
  });
  it('does not reveal a run whose conversation is not accessible', () => {
    expect(buildAutomationMap({ ...base, conversations: [], runs: [run] }).lead).toBeNull();
  });
  it('uses explicit run target and one bot icon even with several channels', () => {
    const result = buildAutomationMap({ ...base, runs: [{ ...run, deal_id: 'other' }, run] });
    expect(result.lead?.kind).toBe('bot'); expect(result.other?.kind).toBe('bot');
  });
  it('filters by the same exclusive state and never treats unknown as inactive', () => {
    const bot = buildAutomationMap({ ...base, runs: [run] }).lead;
    expect(matchesAutomation(bot, 'bot')).toBe(true);
    expect(matchesAutomation(bot, 'ai')).toBe(false);
    expect(matchesAutomation(bot, 'none')).toBe(false);
    expect(matchesAutomation(null, 'none')).toBe(true);
    expect(matchesAutomation(undefined, 'none')).toBe(false);
    expect(matchesAutomation(undefined, 'all')).toBe(true);
  });
});
