import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AgentRow, EndAction } from './types';
import type { ConversationContext } from './context';
import { memoryDb } from '@/test/helpers/mcpMemoryDb';
import { executeOutcomeActions } from './actions';

const generate = vi.hoisted(() => vi.fn());
vi.mock('ai', async original => ({ ...await original<typeof import('ai')>(), generateText: generate }));
vi.mock('./model', () => ({ resolveAgentModel: async () => ({ model: {}, modelId: 'teste' }), supportsTemperature: () => false }));
vi.mock('./context', async original => ({
  ...await original<typeof import('./context')>(),
  buildHistoryMessages: async () => [{ role: 'user', content: 'Assinei ontem. Obrigada!' }],
}));

function fixture(concurrentEdit = false) {
  const deal = { id: 'lead', organization_id: 'org', updated_at: '2026-11-22T14:00:00Z', custom_fields: { campo_telefone: 'Preenchido pela equipe' } };
  const names = ['nome', 'cpf', 'endereco', 'telefone', 'email', 'profissao', 'sem_fonte'];
  const ctx = { org: { name: 'Teste' }, deal, contact: { id: 'contato' },
    conversation: { id: 'conversa', deal_id: 'lead', contact_id: 'contato', organization_id: 'org',
      ai_state: { memoria_desde: '2026-11-01', dados: { profissao: 'Professora', cpf: '11111111111' } } },
  } as unknown as ConversationContext;
  const agent = { id: 'agente', tools: { zapsign_template_token: 'modelo' }, history_limit: 5,
    ai_vars: names.map(name => ({ name: name + '_ficha', instruction: name, example: 'exemplo fictício' })) } as AgentRow;
  const db = memoryDb({ deals: [deal], custom_field_definitions: names.map(name => ({
    organization_id: 'org', entity_type: 'deal', type: 'text', key: 'campo_' + name,
  })) });
  const signature = {
    select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(), contains: vi.fn().mockReturnThis(), gte: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: { request: {
      agent_signer: { name: 'Cliente de Exemplo', phone: '11988887777', email: '' },
      values: [{ de: '{{NOME COMPLETO}}', para: 'Cliente de Exemplo' }, { de: '{{CPF}}', para: '52998224725' },
        { de: '{{ENDEREÇO COMPLETO}}', para: 'Sítio Exemplo, zona rural' }, { de: '{{TELEFONE}}', para: '11988887777' }, { de: '{{E-MAIL}}', para: ' ' }],
    } }, error: null }),
  };
  let dealQueries = 0;
  const admin = { from: (table: string) => {
    if (table === 'deal_signatures') return signature;
    if (table === 'deals' && ++dealQueries === 2 && concurrentEdit) {
      Object.assign(deal.custom_fields, { campo_endereco: 'Endereço corrigido pela equipe' });
      deal.updated_at = '2026-11-23T09:00:00Z';
    }
    return db.from(table);
  } } as unknown as SupabaseClient;
  const actions: EndAction[] = [{ type: 'update_lead', changes: names.map(name => ({
    field: 'custom_field', mode: 'replace', key: 'campo_' + name, value: '{{ia:' + name + '_ficha}}',
  })) }];
  const finish = async () => {
    const runEvents: unknown[] = [];
    await executeOutcomeActions(admin, { agent, ctx, outcome: { key: 'encerrar', label: 'Ficha pronta', description: '', actions }, summary: '', runEvents });
    return runEvents;
  };
  return { deal, signature, finish };
}

describe('ficha pronta após a assinatura', () => {
  it('recupera a ficha confirmada mesmo fora do histórico, preserva o preenchimento manual e o e-mail ausente', async () => {
    const { deal, signature, finish } = fixture();
    generate.mockResolvedValue({ text: '{}' });
    const events = await finish();
    expect(deal.custom_fields).toEqual({ campo_nome: 'Cliente de Exemplo', campo_cpf: '529.982.247-25', campo_endereco: 'Sítio Exemplo, zona rural',
      campo_telefone: 'Preenchido pela equipe', campo_profissao: 'Professora' });
    expect(events).toContainEqual(expect.objectContaining({ error: expect.stringContaining('campo_sem_fonte: valor vazio') }));
    for (const [k, v] of [['organization_id', 'org'], ['deal_id', 'lead'], ['contact_id', 'contato'], ['origin', 'agent'], ['template_token', 'modelo']]) {
      expect(signature.eq).toHaveBeenCalledWith(k, v);
    }
    expect(signature.contains).toHaveBeenCalledWith('request', { conversation_id: 'conversa', agent_id: 'agente', agent_delivery: 'conversation' });
    expect(signature.gte).toHaveBeenCalledWith('created_at', '2026-11-01');
    expect(signature.in).toHaveBeenCalledWith('status', ['pending', 'signed']);
    expect(signature.not).toHaveBeenCalledWith('doc_token', 'is', null);
  });

  it('se o extrator falhar, usa dados da ficha e nunca grava exemplos da configuração', async () => {
    const { deal, finish } = fixture();
    generate.mockRejectedValue(new Error('falha simulada'));
    await finish();
    expect(deal.custom_fields).toMatchObject({ campo_cpf: '529.982.247-25', campo_profissao: 'Professora' });
    expect(deal.custom_fields).not.toHaveProperty('campo_sem_fonte');
  });

  it('recupera o e-mail válido do signatário sem confundi-lo com o do representante', async () => {
    const { deal, signature, finish } = fixture();
    signature.maybeSingle.mockResolvedValue({ data: { request: {
      agent_signer: { email: 'cliente@example.test' },
      values: [{ de: '{{E-MAIL DO REPRESENTANTE}}', para: 'representante@example.test' }],
    } }, error: null });
    generate.mockResolvedValue({ text: '{}' });
    await finish();
    expect(deal.custom_fields).toMatchObject({ campo_email: 'cliente@example.test' });
  });

  it('respeita a correção recente e utiliza a memória da conversa se a consulta do contrato falhar', async () => {
    const { deal, signature, finish } = fixture();
    signature.maybeSingle.mockResolvedValue({ data: null, error: { message: 'falha simulada' } });
    generate.mockResolvedValue({ text: JSON.stringify({ endereco_ficha: 'Rua Atual, 10' }) });
    const events = await finish();
    expect(deal.custom_fields).toMatchObject({ campo_endereco: 'Rua Atual, 10', campo_profissao: 'Professora' });
    expect(events).toContainEqual(expect.objectContaining({ type: 'ficha_contrato_indisponivel' }));
  });

  it('relê o cadastro quando uma pessoa preenche o endereço durante o encerramento', async () => {
    const { deal, finish } = fixture(true);
    generate.mockResolvedValue({ text: '{}' });
    await finish();
    expect(deal.custom_fields).toMatchObject({ campo_endereco: 'Endereço corrigido pela equipe', campo_cpf: '529.982.247-25' });
  });
});
