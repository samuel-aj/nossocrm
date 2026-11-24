import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import type { AgentRow } from './types';
import type { ConversationContext } from './context';
import { ensureAutoLead } from './autoLead';

vi.mock('./context', () => ({ loadDealContext: async (_db: unknown, _org: string, input: { dealId: string }) => ({ id: input.dealId }) }));

type Row = Record<string, unknown>;
function setup() {
  const deals: Row[] = [];
  const ctx = { conversation: { id: 'conv', organization_id: 'org', contact_id: 'contact', wa_phone: '5500' }, deal: null } as ConversationContext;
  const agent = { auto_lead: { enabled: true, board_id: 'board', stage_id: 'stage' } } as AgentRow;
  let loseInsertResponse = true;
  let hideFirstDeal = false;
  let manualDeal: string | null = null;
  const insertedIds: unknown[] = [];
  const db = { from: (table: string) => {
    let insert: Row | undefined;
    let update: Row | undefined;
    const query = {
      select: () => query, is: () => query, eq: () => query, limit: () => query, order: () => query,
      maybeSingle: () => query, single: () => query,
      insert: (row: Row) => { insert = row; return query; },
      update: (row: Row) => { update = row; return query; },
      then: (resolve: (value: unknown) => unknown) => {
        if (table === 'deals' && insert) {
          insertedIds.push(insert.id);
          if (deals.some(row => row.id === insert!.id)) return resolve({ error: { code: '23505' } });
          deals.push(insert);
          if (loseInsertResponse) { loseInsertResponse = false; return resolve({ error: { message: 'network timeout' } }); }
          return resolve({ data: insert });
        }
        if (table === 'deals') return resolve({ data: hideFirstDeal ? null : deals[0] });
        if (table === 'wa_conversations' && manualDeal) {
          return resolve({ data: update ? null : { deal_id: manualDeal, contact_id: ctx.conversation.contact_id } });
        }
        if (table === 'wa_conversations' && update) Object.assign(ctx.conversation, update);
        return resolve({ data: { id: table === 'boards' ? 'board' : 'stage' } });
      },
    };
    return query;
  } } as unknown as SupabaseClient;
  const run = () => ensureAutoLead(db, { agent, ctx, inboundId: 'message', pushEvent: vi.fn() });
  return { run, deals, insertedIds, ctx, relink: (id: string) => { manualDeal = id; }, hideDeal: (v: boolean) => { hideFirstDeal = v; } };
}

describe('lead automático de entrada sem negócio vinculado', () => {
  it('recarrega o vínculo em colisão e preserva a escolha manual', async () => {
    const { run, relink, deals, ctx } = setup();
    await expect(run()).rejects.toThrow('network timeout');
    relink('escolha-da-equipe');
    await expect(run()).rejects.toThrow('vínculo de negócio mudou');
    expect(deals).toHaveLength(1);
    expect(ctx.deal).toBeNull();
  });

  it('reconcilia um INSERT que teve timeout, sem duplicar negócio mesmo quando uma leitura perdeu o registro', async () => {
    const { run, deals, insertedIds, ctx, hideDeal } = setup();
    await expect(run()).rejects.toThrow('network timeout');
    hideDeal(true);
    await expect(run()).rejects.toThrow('reconciliar o negócio');
    hideDeal(false);
    await run();
    expect(deals).toHaveLength(1);
    expect(insertedIds).toEqual([deals[0].id, deals[0].id]);
    expect(ctx.deal?.id).toBe(deals[0].id);
    expect(ctx.conversation.deal_id).toBe(deals[0].id);
  });
});
