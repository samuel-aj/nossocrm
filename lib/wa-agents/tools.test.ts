import { describe, expect, it } from 'vitest';
import { buildAgentTools, buildUtilityTools, findByName, helperDisplayName, uniqueNames } from './tools';
import { DEFAULT_AGENT_TRIGGERS, type AgentDocumentRow, type AgentMediaRow, type AgentRow } from './types';

const ORG = '11111111-1111-1111-1111-111111111111';

function agent(overrides: Partial<AgentRow> = {}): AgentRow {
  return {
    id: '22222222-2222-2222-2222-222222222222',
    organization_id: ORG,
    name: 'Triagem',
    persona_name: 'Ana',
    enabled: true,
    connection_ids: [],
    provider: 'openai',
    model: 'gpt-4.1-mini',
    temperature: 0.5,
    api_key: null,
    system_prompt: '# PAPEL\nVocê é {{nome_agente}}.',
    buffer_seconds: 10,
    history_limit: 40,
    line_delay_ms: 1500,
    human_pause_minutes: 30,
    only_new_conversations: false,
    outcomes: [{ key: 'qualificado', label: 'Qualificado', description: '', actions: [] }],
    webhooks: [],
    custom_actions: [],
    triggers: DEFAULT_AGENT_TRIGGERS,
    helper_agent_ids: [],
    tools: { calculator: true },
    created_at: '2026-08-26T00:00:00.000Z',
    updated_at: '2026-08-26T00:00:00.000Z',
    ...overrides,
  };
}

const doc: AgentDocumentRow = {
  id: 'd1',
  organization_id: ORG,
  agent_id: 'a',
  name: 'Guia.pdf',
  mime: 'application/pdf',
  size_bytes: 10,
  storage_path: `${ORG}/agents/a/docs/x_Guia.pdf`,
  status: 'ready',
  error: null,
  chunk_count: 3,
  created_at: '',
  updated_at: '',
};

const media: AgentMediaRow = {
  id: 'm1',
  organization_id: ORG,
  agent_id: 'a',
  name: 'Vídeo de apresentação',
  description: 'o cliente perguntar como funciona',
  kind: 'video',
  mime: 'video/mp4',
  size_bytes: 10,
  storage_path: `${ORG}/agents/a/media/x_video.mp4`,
  created_at: '',
};

describe('buildAgentTools', () => {
  it('sem recursos só tem encerrar_atendimento, salvar_dados e calcular', () => {
    const tools = buildAgentTools(agent());
    expect(Object.keys(tools).sort()).toEqual(['calcular', 'encerrar_atendimento', 'salvar_dados']);
  });

  it('calculadora desligada remove calcular', () => {
    const tools = buildAgentTools(agent({ tools: { calculator: false } }));
    expect(tools.calcular).toBeUndefined();
  });

  it('executar_acao só com custom_actions', () => {
    const tools = buildAgentTools(
      agent({ custom_actions: [{ key: 'ja-tem-advogado', label: 'Já tem advogado', description: 'x', actions: [] }] })
    );
    expect(tools.executar_acao).toBeDefined();
  });

  it('consultar_documentos, enviar_midia e consultar_agente só com os recursos e os efeitos', () => {
    const helper = agent({ id: '33333333-3333-3333-3333-333333333333', name: 'Trabalhista', persona_name: null });
    const tools = buildAgentTools(agent(), {
      documents: [doc],
      media: [media],
      helpers: [helper],
      searchKnowledge: async () => [],
      sendMedia: async () => ({ ok: true }),
      consultHelper: async () => 'resposta',
    });
    expect(Object.keys(tools).sort()).toEqual([
      'calcular',
      'consultar_agente',
      'consultar_documentos',
      'encerrar_atendimento',
      'enviar_midia',
      'salvar_dados',
    ]);
    // sem os efeitos (callbacks) as ferramentas não entram
    const without = buildAgentTools(agent(), { documents: [doc], media: [media], helpers: [helper] });
    expect(without.consultar_documentos).toBeUndefined();
    expect(without.enviar_midia).toBeUndefined();
    expect(without.consultar_agente).toBeUndefined();
  });

  it('calcular avalia a expressão e devolve erro legível sem lançar', async () => {
    const tools = buildUtilityTools({ tools: { calculator: true } });
    const calcular = tools.calcular!;
    const exec = calcular.execute as (input: { expressao: string }, opts: unknown) => Promise<unknown>;
    expect(await exec({ expressao: 'round(1500 * 0.3, 2)' }, {})).toEqual({ ok: true, resultado: '450' });
    expect(await exec({ expressao: 'x + 1' }, {})).toEqual({ ok: false, erro: 'expressão inválida' });
  });

  it('enviar_midia acha a mídia pelo nome (sem acento/caixa) e devolve a nota do envio', async () => {
    const sent: string[] = [];
    const tools = buildAgentTools(agent(), {
      media: [media],
      sendMedia: async m => {
        sent.push(m.name);
        return { ok: true, note: `mídia ${m.name} enviada (simulado)` };
      },
    });
    const exec = tools.enviar_midia!.execute as (input: { nome: string; legenda?: string }, opts: unknown) => Promise<unknown>;
    expect(await exec({ nome: 'video de apresentacao' }, {})).toEqual({
      ok: true,
      midia: 'Vídeo de apresentação',
      mensagem: 'mídia Vídeo de apresentação enviada (simulado)',
    });
    expect(sent).toEqual(['Vídeo de apresentação']);
  });
});

describe('consultar_agente e salvar_dados', () => {
  it('identifica os auxiliares pelo nome do agente (duas personas iguais não colapsam) e aceita a persona como reserva', async () => {
    const asked: string[] = [];
    const trabalhista = agent({ id: '33333333-3333-3333-3333-333333333333', name: 'Triagem Trabalhista', persona_name: 'Ana' });
    const previdenciario = agent({ id: '44444444-4444-4444-4444-444444444444', name: 'Triagem Previdenciário', persona_name: 'Ana' });
    const tools = buildAgentTools(agent(), {
      helpers: [trabalhista, previdenciario],
      consultHelper: async h => {
        asked.push(h.name);
        return 'resposta';
      },
    });
    const exec = tools.consultar_agente!.execute as (input: { agente: string; pergunta: string }, opts: unknown) => Promise<unknown>;
    expect(await exec({ agente: 'Triagem Previdenciário', pergunta: 'x' }, {})).toEqual({
      ok: true,
      agente: 'Triagem Previdenciário',
      resposta: 'resposta',
    });
    expect(await exec({ agente: 'ana', pergunta: 'x' }, {})).toMatchObject({ ok: true, agente: 'Triagem Trabalhista' });
    expect(asked).toEqual(['Triagem Previdenciário', 'Triagem Trabalhista']);
  });

  it('salvar_dados só aceita valores primitivos curtos', () => {
    const tools = buildAgentTools(agent());
    const schema = tools.salvar_dados!.inputSchema as { safeParse: (v: unknown) => { success: boolean } };
    expect(schema.safeParse({ dados: { nome: 'Ana', idade: 30, urgente: true, obs: null } }).success).toBe(true);
    expect(schema.safeParse({ dados: { nome: 'x'.repeat(201) } }).success).toBe(false);
    expect(schema.safeParse({ dados: { aninhado: { a: 1 } } }).success).toBe(false);
    expect(schema.safeParse({ dados: { ['k'.repeat(41)]: 'v' } }).success).toBe(false);
  });
});

describe('utilitários de nomes', () => {
  it('uniqueNames mantém a primeira ocorrência (sem acento/caixa) e findByName acha exato ou normalizado', () => {
    const items = [{ name: 'Tabela' }, { name: 'tabela' }, { name: 'Vídeo' }];
    expect(uniqueNames(items).map(i => i.name)).toEqual(['Tabela', 'Vídeo']);
    expect(findByName(items, 'VIDEO')?.name).toBe('Vídeo');
    expect(findByName(items, 'tabela')?.name).toBe('tabela');
    expect(findByName(items, 'nada')).toBeNull();
  });

  it('helperDisplayName prefere a persona', () => {
    expect(helperDisplayName({ name: 'Trabalhista', persona_name: 'Carla' })).toBe('Carla');
    expect(helperDisplayName({ name: 'Trabalhista', persona_name: null })).toBe('Trabalhista');
  });
});
