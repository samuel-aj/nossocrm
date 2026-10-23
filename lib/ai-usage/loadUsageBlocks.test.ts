import { beforeEach, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadUsageBlocks } from './loadUsageBlocks';

type Row = Record<string, unknown>;
const org = 'org';
let tables: Record<string, Row[]>;
let reads: Array<{ table: string; organization?: string; ids?: string[] }>;
let failure: string | undefined;
const admin = { from(table: string) {
  const read = { table } as typeof reads[number]; reads.push(read);
  let rows = tables[table] ?? [];
  const q = {
    select: () => q,
    eq: (key: string, value: unknown) => { if (key === 'organization_id') read.organization = String(value); rows = rows.filter(r => r[key] === value); return q; },
    in: (key: string, values: string[]) => { read.ids = values; rows = rows.filter(r => values.includes(String(r[key]))); return q; },
    is: (key: string, value: unknown) => { rows = rows.filter(r => r[key] === value); return q; },
    order: () => q,
    range: async (from: number, to: number) => ({ data: rows.slice(from, to + 1), error: table === failure ? { message: 'unavailable' } : null }),
  };
  return q;
}, rpc: vi.fn() } as unknown as SupabaseClient;
const account = (id: string, blocked_at: string | null = '2026-10-23T13:00:00Z', extra: Row = {}) => ({ id, organization_id: org, merged_into: null, blocked_at, blocked_reason: 'conversation_token_limit', ...extra });
const conversation = (id: string, extra: Row = {}) => ({ id, organization_id: org, contact_id: null, wa_phone: `phone-${id}`, is_group: false, ...extra });
beforeEach(() => { reads = []; failure = undefined; vi.clearAllMocks(); tables = { wa_conversations: [conversation('c')], contacts: [], ai_usage_identities: [], ai_usage_memberships: [], ai_usage_accounts: [] }; });

it('follows merged membership accounts and ignores stale blocks once the canonical account is released', async () => {
  tables.ai_usage_memberships = [{ organization_id: org, conversation_id: 'c', account_id: 'old' }];
  tables.ai_usage_accounts = [account('old', '2026-10-20T00:00:00Z', { merged_into: 'root' }), account('root')];
  expect(await loadUsageBlocks(admin, org, ['c'])).toEqual({ c: { conversationId: 'c', blockedAt: '2026-10-23T13:00:00Z', reason: 'conversation_token_limit' } });
  tables.ai_usage_accounts[1].blocked_at = null;
  expect(await loadUsageBlocks(admin, org, ['c'])).toEqual({});
  expect(admin.rpc).not.toHaveBeenCalled();
});

it('detects exact-phone and verified-contact blocks before context has created a membership', async () => {
  tables.wa_conversations = [conversation('c', { contact_id: 'contact' })];
  tables.contacts = [{ organization_id: org, id: 'contact', deleted_at: null }];
  tables.ai_usage_identities = [
    { organization_id: org, identity_key: 'contact:contact', account_id: 'contact-account' },
    { organization_id: org, identity_key: 'phone:phone-c', account_id: 'phone-account' },
  ];
  tables.ai_usage_accounts = [account('contact-account'), account('phone-account', '2026-10-22T12:00:00Z', { blocked_reason: 'AI_USAGE_UNKNOWN' })];
  expect((await loadUsageBlocks(admin, org, ['c'])).c).toMatchObject({ blockedAt: '2026-10-22T12:00:00Z', reason: 'AI_USAGE_UNKNOWN' });
  expect(admin.rpc).not.toHaveBeenCalled();
});

it('does not infer blocks from a manual pause or a deleted/foreign contact', async () => {
  tables.wa_conversations = [conversation('c', { contact_id: 'gone', ai_status: 'paused' }), conversation('d', { contact_id: 'foreign' })];
  tables.contacts = [{ organization_id: org, id: 'gone', deleted_at: 'yesterday' }, { organization_id: 'other', id: 'foreign', deleted_at: null }];
  tables.ai_usage_identities = [
    { organization_id: org, identity_key: 'contact:gone', account_id: 'a' },
    { organization_id: org, identity_key: 'contact:foreign', account_id: 'a' },
  ];
  tables.ai_usage_accounts = [account('a')];
  expect(await loadUsageBlocks(admin, org, ['c', 'd'])).toEqual({});
});

it('matches SQL nullable group semantics: contact primary excludes a phone alias unless explicitly non-group', async () => {
  tables.wa_conversations = [conversation('c', { contact_id: 'contact', is_group: null })];
  tables.contacts = [{ organization_id: org, id: 'contact', deleted_at: null }];
  tables.ai_usage_identities = [
    { organization_id: org, identity_key: 'contact:contact', account_id: 'contact-account' },
    { organization_id: org, identity_key: 'phone:phone-c', account_id: 'phone-account' },
  ];
  tables.ai_usage_accounts = [account('contact-account', null), account('phone-account')];
  expect(await loadUsageBlocks(admin, org, ['c'])).toEqual({});
  tables.wa_conversations[0].is_group = false;
  expect((await loadUsageBlocks(admin, org, ['c'])).c).toMatchObject({ reason: 'conversation_token_limit' });
  tables.wa_conversations[0].is_group = null;
  tables.wa_conversations[0].contact_id = null;
  expect((await loadUsageBlocks(admin, org, ['c'])).c).toMatchObject({ reason: 'conversation_token_limit' });
});

it('uses group identity rather than a shared phone and never returns unauthorized or foreign conversations', async () => {
  tables.wa_conversations = [conversation('c', { is_group: true }), conversation('hidden'), conversation('foreign', { organization_id: 'other' })];
  tables.ai_usage_identities = [
    { organization_id: org, identity_key: 'phone:phone-c', account_id: 'phone' },
    { organization_id: org, identity_key: 'group:c', account_id: 'group' },
    { organization_id: 'other', identity_key: 'group:c', account_id: 'foreign' },
  ];
  tables.ai_usage_accounts = [account('phone', '2026-10-20T00:00:00Z'), account('group'), account('foreign', '2026-10-19T00:00:00Z', { organization_id: 'other' })];
  expect(Object.keys(await loadUsageBlocks(admin, org, ['c', 'foreign']))).toEqual(['c']);
  expect(reads.every(r => r.organization === org)).toBe(true);
});

it('batches large lists instead of querying once per card and deduplicates input', async () => {
  tables.wa_conversations = Array.from({ length: 205 }, (_, i) => conversation(`c${i}`));
  const ids = tables.wa_conversations.map(c => String(c.id));
  expect(await loadUsageBlocks(admin, org, [...ids, ...ids])).toEqual({});
  expect(reads.filter(r => r.table === 'wa_conversations')).toHaveLength(3);
  expect(reads.every(r => (r.ids?.length ?? 0) <= 100)).toBe(true);
});

it('reports unavailable state on broken or cyclic links rather than claiming an unblocked account', async () => {
  tables.ai_usage_memberships = [{ organization_id: org, conversation_id: 'c', account_id: 'a' }];
  await expect(loadUsageBlocks(admin, org, ['c'])).rejects.toThrow('Conta de consumo indisponível');
  tables.ai_usage_accounts = [account('a', null, { merged_into: 'b' }), account('b', null, { merged_into: 'a' })];
  await expect(loadUsageBlocks(admin, org, ['c'])).rejects.toThrow('circular');
  failure = 'ai_usage_memberships';
  await expect(loadUsageBlocks(admin, org, ['c'])).rejects.toThrow('unavailable');
});
