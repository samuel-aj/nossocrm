import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AgentRow } from './types';
import type { ConversationContext } from './context';

const h = vi.hoisted(() => ({ client: null as unknown, writes: [] as Array<Record<string, unknown>>, filters: [] as unknown[][] }));
vi.mock('@/lib/supabase/server', () => ({ createStaticAdminClient: () => h.client }));
vi.mock('@/lib/supabase/actorClient', () => ({ withActor: (client: unknown) => client }));
import { executeOutcomeActions } from './actions';

// Mesmo formato dos ids que o lead automático do WhatsApp grava (versão 8).
const autoLeadDealId = 'a1b2c3d4-e5f6-8a7b-9c0d-1e2f3a4b5c6d';
const boardId = '00000000-0000-4000-8000-000000000002';
const stageId = '00000000-0000-4000-8000-000000000003';

function fakeDb() {
  return { from: (table: string) => {
    let patch: Record<string, unknown> | undefined;
    const row = () => table === 'boards' ? { id: boardId, lost_stage_id: null }
      : table === 'board_stages' ? { id: stageId, label: 'Proposta' }
      : { id: autoLeadDealId, board_id: boardId, stage_id: 'antes', is_lost: false, contact_id: null, ...patch };
    const q = {
      select: () => q, is: () => q, limit: () => q,
      eq: (...args: unknown[]) => { h.filters.push([table, ...args]); return q; },
      update: (value: Record<string, unknown>) => { patch = value; h.writes.push(value); return q; },
      maybeSingle: async () => ({ data: row(), error: null }),
    };
    return q;
  } };
}

beforeEach(() => { h.writes = []; h.filters = []; h.client = fakeDb(); });

describe('ação de mover de etapa do agente de IA', () => {
  it('move o negócio criado pelo lead automático, cujo id é UUID versão 8', async () => {
    const ctx = { org: { name: 'Teste' }, conversation: { id: 'conversa', organization_id: 'org', contact_id: null }, deal: { id: autoLeadDealId }, contact: null } as unknown as ConversationContext;
    const agent = { id: 'agente', name: 'Triagem', persona_name: null, ai_vars: [] } as unknown as AgentRow;
    const runEvents: unknown[] = [];
    await executeOutcomeActions(h.client as SupabaseClient, {
      agent, ctx, summary: '', runEvents,
      outcome: { key: 'qualificado', label: 'Qualificado', description: '', actions: [{ type: 'move_stage', stage_id: stageId }] },
    });
    expect(runEvents).toContainEqual(expect.objectContaining({ type: 'action', action: 'move_stage', ok: true }));
    expect(h.writes[0]).toMatchObject({ stage_id: stageId });
    expect(h.filters).toContainEqual(['deals', 'id', autoLeadDealId]);
  });
});
