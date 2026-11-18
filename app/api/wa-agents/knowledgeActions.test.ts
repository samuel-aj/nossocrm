import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import type { CustomAction } from '@/lib/wa-agents/types';
import { validateKnowledgeActions } from './_shared';

const lookup: CustomAction = {
  key: 'precos', label: 'Preços', description: 'Quando o cliente perguntar o valor',
  actions: [{ type: 'consult_knowledge', knowledgeId: 'tabela', description: 'Tabela de preços' }],
};

function database(ids: string[]) {
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockResolvedValue({ data: ids.map(id => ({ id })), error: null }),
  };
  const from = vi.fn(() => query);
  return { client: { from } as unknown as SupabaseClient, from, query };
}

describe('validação das fontes de uma ação', () => {
  it('valida as fontes distintas na organização, no agente e entre os documentos prontos', async () => {
    const { client, from, query } = database(['tabela']);
    expect(await validateKnowledgeActions(client, 'org', 'agente', [lookup, lookup])).toBeNull();
    expect(from).toHaveBeenCalledWith('wa_ai_agent_documents');
    expect(query.eq.mock.calls).toEqual([['organization_id', 'org'], ['agent_id', 'agente'], ['status', 'ready']]);
    expect(query.in).toHaveBeenCalledWith('id', ['tabela']);
  });

  it.each([null, 'agente'])('recusa fonte indisponível para %s e aponta o campo no editor', async agentId => {
    const { client } = database([]);
    const response = await validateKnowledgeActions(client, 'org', agentId, [lookup]);
    expect(response?.status).toBe(400);
    expect((await response?.json()).issues[0].path).toEqual(['custom_actions', '0', 'actions', '0', 'knowledgeId']);
  });

  it('preserva ações existentes sem consultar documentos', async () => {
    const { client, from } = database([]);
    expect(await validateKnowledgeActions(client, 'org', null, [{ ...lookup, actions: [{ type: 'note' }] }])).toBeNull();
    expect(from).not.toHaveBeenCalled();
  });
});
