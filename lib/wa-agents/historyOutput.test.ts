import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildHistoryMessages, normalizeAgentRow } from './context';
import { buildTestContext, toModelMessages } from './test';

const leaked = '{"dados":{"autorizacao":true}}';
describe('histórico usado pela IA', () => {
  it('omite apenas envelopes internos do agente, preservando cliente, equipe e o registro original', async () => {
    const rows = [
      { direction: 'in', body: 'Sim', source: 'inbound' },
      { direction: 'out', body: leaked, source: 'agent' },
      { direction: 'out', body: 'Qual o valor?', source: 'agent' },
      { direction: 'in', body: leaked, source: 'inbound' },
      { direction: 'out', body: leaked, source: 'crm' },
    ];
    const original = structuredClone(rows);
    const q = { select: () => q, eq: () => q, order: () => q, limit: async () => ({ data: [...rows].reverse() }) };
    const db = { from: () => q } as unknown as SupabaseClient;
    const ctx = buildTestContext({ organizationId: 'org', organizationName: 'Teste', agent: normalizeAgentRow({ id: 'agent', organization_id: 'org' }) });
    const messages = await buildHistoryMessages(db, ctx, 30);
    expect(messages).toEqual([
      { role: 'user', content: 'Sim' }, { role: 'assistant', content: 'Qual o valor?' },
      { role: 'user', content: leaked }, { role: 'assistant', content: '[Atendente humano]: ' + leaked },
    ]);
    expect(rows).toEqual(original);
  });
  it('aplica a mesma limpeza às respostas anteriores no simulador', () => {
    expect(toModelMessages([{ role: 'user', text: 'Sim' }, { role: 'assistant', text: leaked }]))
      .toEqual([{ role: 'user', content: 'Sim' }]);
    expect(toModelMessages([{ role: 'user', text: leaked }])).toEqual([{ role: 'user', content: leaked }]);
  });
});
