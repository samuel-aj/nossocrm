import { beforeEach, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { OrgUser } from '@/lib/whatsapp/api';
const m = vi.hoisted(() => ({ blocks: vi.fn() }));
vi.mock('@/lib/ai-usage/loadUsageBlocks', () => ({ loadUsageBlocks: m.blocks }));
vi.mock('@/lib/permissions/server', () => ({
  getVisibilityRules: async () => null,
  connectionAllowed: (_rules: unknown, connection: string) => connection !== 'hidden',
  filterConversationsByOwner: async (_admin: unknown, _org: string, _rules: unknown, _user: string, rows: unknown[]) => rows,
}));
import { loadAutomationState } from './loadAutomationState';

type Row = Record<string, unknown>;
let tables: Record<string, Row[]>;
let conversationIdReads: string[][];
const admin = { from(table: string) {
  let rows = tables[table] ?? [];
  const q = { select: () => q, order: () => q,
    or: (filter: string) => {
      const clauses = [...filter.matchAll(/([a-z_]+)\.in\.\(([^)]*)\)/g)];
      rows = rows.filter(row => clauses.some(([, key, values]) => values.split(',').includes(String(row[key])))); return q;
    },
    eq: (key: string, val: unknown) => { rows = rows.filter(r => r[key] === val); return q; },
    is: (key: string, val: unknown) => { rows = rows.filter(r => r[key] === val); return q; },
    in: (key: string, vals: string[]) => { if (table === 'wa_conversations' && key === 'id') conversationIdReads.push(vals); rows = rows.filter(r => vals.includes(String(r[key]))); return q; },
    range: async (from: number, to: number) => ({ data: rows.slice(from, to + 1), error: null }),
  }; return q;
} } as unknown as SupabaseClient;
const user = { id: 'user', organizationId: 'org' } as OrgUser;
const conv = (id: string, deal_id: string | null, extra: Row = {}) => ({ id, deal_id, organization_id: 'org', contact_id: 'contact', connection_id: 'visible', label_ids: [], ai_status: 'paused', ai_agent_id: 'agent', ...extra });
const block = (conversationId: string) => ({ conversationId, blockedAt: '2026-10-23T13:00:00Z', reason: 'conversation_token_limit' });
const run = (conversation_id: string, deal_id = 'lead') => ({ id: 'run', organization_id: 'org', deal_id, conversation_id, contact_id: 'contact', bot_id: 'bot', status: 'running', wake_at: null });
beforeEach(() => {
  vi.clearAllMocks();
  conversationIdReads = [];
  tables = {
    wa_conversations: [conv('explicit', 'lead'), conv('fallback', null), conv('other-deal', 'outside-board'), conv('hidden', 'lead', { connection_id: 'hidden' })],
    wa_bot_runs: [], wa_bots: [], wa_ai_agents: [{ id: 'agent', organization_id: 'org', name: 'Bia' }],
    deals: [{ id: 'newest-open', contact_id: 'contact', organization_id: 'org', deleted_at: null, is_won: false, is_lost: false }],
  };
  m.blocks.mockImplementation(async (_admin, _org, ids: string[]) => Object.fromEntries(ids.map(id => [id, block(id)])));
});

it('keeps usage blocks separate from active-automation filters and projects only visible conversations', async () => {
  const state = await loadAutomationState(admin, user, [{ id: 'lead', contact_id: 'contact' }, { id: 'newest-open', contact_id: 'contact' }]);
  expect(state.automations).toEqual({ lead: null, 'newest-open': null });
  expect(state.usageBlocks).toEqual({ lead: block('explicit'), 'newest-open': block('fallback') });
  expect(m.blocks).toHaveBeenCalledWith(admin, 'org', ['explicit', 'fallback', 'other-deal']);
  expect(state.usageBlocksUnavailable).toBe(false);
});

it('never falls back to the contact when a conversation explicitly belongs to a different lead', async () => {
  tables.wa_conversations = [conv('other-deal', 'outside-board')];
  expect((await loadAutomationState(admin, user, [{ id: 'newest-open', contact_id: 'contact' }])).usageBlocks).toEqual({});
});

it('preserves automation results and reports supplemental failure when usage tables are unavailable', async () => {
  tables.wa_conversations = [conv('explicit', 'lead', { ai_status: 'active' })];
  m.blocks.mockRejectedValue(new Error('unavailable'));
  const state = await loadAutomationState(admin, user, [{ id: 'lead', contact_id: 'contact' }]);
  expect(state.automations.lead).toEqual({ kind: 'ai', name: 'Bia', state: 'active' });
  expect(state.usageBlocks).toEqual({}); expect(state.usageBlocksUnavailable).toBe(true);
});

it('does not query usage for an empty set of authorized leads', async () => {
  expect(await loadAutomationState(admin, user, [])).toEqual({ automations: {}, usageBlocks: {}, usageBlocksUnavailable: false });
  expect(m.blocks).not.toHaveBeenCalled();
});

it('projects an orphan conversation loaded through a running robot explicit authorized deal', async () => {
  tables.wa_conversations = [conv('extra', null, { contact_id: null })];
  tables.wa_bot_runs = [run('extra')];
  const state = await loadAutomationState(admin, user, [{ id: 'lead', contact_id: 'contact' }]);
  expect(conversationIdReads).toEqual([['extra']]);
  expect(m.blocks).toHaveBeenCalledWith(admin, 'org', ['extra']);
  expect(state.usageBlocks).toEqual({ lead: block('extra') });
});

it('never replaces an explicit different conversation deal with the robot target', async () => {
  tables.wa_conversations = [conv('extra', 'other-deal', { contact_id: null })];
  tables.wa_bot_runs = [run('extra')];
  const state = await loadAutomationState(admin, user, [{ id: 'lead', contact_id: 'contact' }]);
  expect(conversationIdReads).toEqual([['extra']]);
  expect(state.usageBlocks).toEqual({});
});

it('does not project an orphan to a robot target outside the authorized batch', async () => {
  tables.wa_conversations = [conv('extra', null, { contact_id: null })];
  tables.wa_bot_runs = [run('extra', 'other-deal'), { ...run('extra'), id: 'older-run' }];
  const state = await loadAutomationState(admin, user, [{ id: 'lead', contact_id: 'contact' }]);
  expect(conversationIdReads).toEqual([['extra']]);
  expect(state.usageBlocks).toEqual({});
});

it('still filters conversation access before projecting a robot-linked orphan', async () => {
  tables.wa_conversations = [conv('extra', null, { contact_id: null, connection_id: 'hidden' })];
  tables.wa_bot_runs = [run('extra')];
  const state = await loadAutomationState(admin, user, [{ id: 'lead', contact_id: 'contact' }]);
  expect(conversationIdReads).toEqual([['extra']]);
  expect(m.blocks).toHaveBeenCalledWith(admin, 'org', []);
  expect(state.usageBlocks).toEqual({});
});
