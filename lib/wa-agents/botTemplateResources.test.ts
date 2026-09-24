import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { BotInputSchema } from './types';
import { botResourceError } from './botTemplateResources';
import { applyBotTemplate, createBotTemplate } from './botTemplates';
const orgA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const orgB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const id = '11111111-1111-4111-8111-111111111111';
const number = '22222222-2222-4222-8222-222222222222';
const source = () => BotInputSchema.parse({ name: 'Fluxo', enabled: false, connection_id: number, connection_ids: [number], trigger: { type: 'manual' }, steps: [{ type: 'handoff_agent', id: 'handoff', agent_id: id }] });
function db(rows: Record<string, Array<Record<string, unknown>>>) {
  const queried: string[] = [];
  return { queried, client: { from: (table: string) => {
    queried.push(table); let found = rows[table] ?? [];
    const q = { select: () => q, eq: (k: string, v: unknown) => { found = found.filter(r => r[k] === v); return q; }, in: (k: string, vs: unknown[]) => { found = found.filter(r => vs.includes(r[k])); return q; }, is: (k: string, v: unknown) => { found = found.filter(r => (r[k] ?? null) === v); return q; }, maybeSingle: async () => ({ data: found[0] ?? null }), then: (resolve: (result: unknown) => unknown) => resolve({ data: found, error: null }) }; return q;
  } } as unknown as SupabaseClient };
}
describe('bot model resource authorization and activation', () => {
  it('refuses foreign resources even for disabled imports', async () => {
    const { client } = db({ wa_connections: [{ id: number, organization_id: orgB }], wa_ai_agents: [{ id, organization_id: orgA }] });
    expect(await botResourceError(client, orgB, source(), false)).toContain('Agente não encontrado');
  });
  it('accepts mapped resources only in the destination org', async () => {
    const template = createBotTemplate(source());
    const bot = applyBotTemplate(template, Object.fromEntries(template.dependencies.map(d => [d.ref, d.kind === 'connection' ? number : id])));
    const { client } = db({ wa_connections: [{ id: number, organization_id: orgB }], wa_ai_agents: [{ id, organization_id: orgB }] });
    expect(await botResourceError(client, orgB, bot, true)).toBeNull();
  });
  it('blocks unresolved bindings on activation before any resource query', async () => {
    const bot = applyBotTemplate(createBotTemplate(source()), {}); const { client, queried } = db({});
    expect(await botResourceError(client, orgB, bot, true)).toContain('Vínculos pendentes'); expect(queried).toEqual([]);
  });
  it('preserves number-free CRM flows and excludes superadmin owners', async () => {
    const bot = source(); bot.connection_id = null; bot.connection_ids = []; bot.steps = [{ id: 'end', type: 'end' }];
    expect(await botResourceError(db({}).client, orgB, bot, true)).toBeNull();
    bot.steps = [{ id: 'owner', type: 'update_lead', changes: [{ field: 'owner_id', mode: 'replace', value: id }] }];
    const { client } = db({ profiles: [{ id, role: 'super_admin', organization_id: orgB }], user_organizations: [{ user_id: id, organization_id: orgB }] });
    expect(await botResourceError(client, orgB, bot, true)).toContain('Superadmin');
  });
  it('blocks empty number lists and cross-board stage assignments', async () => {
    const empty = source(); empty.steps = [{ id: 'message', type: 'send_text', text: 'Olá' }]; empty.connection_id = null; empty.connection_ids = [];
    expect(await botResourceError(db({}).client, orgB, empty, true)).toContain('números');
    empty.trigger = { type: 'deal_stage_entered', board_id: id, stage_id: number };
    const { client } = db({ boards: [{ id, organization_id: orgB }], board_stages: [{ id: number, board_id: number, organization_id: orgB }] });
    expect(await botResourceError(client, orgB, empty, false)).toContain('não pertence ao quadro');
  });
});
