import { describe, expect, it } from 'vitest';
import { pickInboundAgent } from './triggers';
import { DEFAULT_AGENT_TRIGGERS, type AgentRow, type AgentTriggers } from './types';

function agent(id: string, triggers?: Partial<AgentTriggers>): AgentRow {
  return {
    id,
    organization_id: 'org',
    name: id,
    persona_name: null,
    enabled: true,
    connection_ids: [],
    provider: 'openai',
    model: 'gpt-4.1-mini',
    temperature: 0.5,
    api_key: null,
    system_prompt: '',
    buffer_seconds: 0,
    history_limit: 40,
    line_delay_ms: 0,
    human_pause_minutes: 30,
    only_new_conversations: false,
    stop_rules: '',
    max_replies: 0,
    outcomes: [],
    webhooks: [],
    custom_actions: [],
    triggers: { ...DEFAULT_AGENT_TRIGGERS, ...(triggers ?? {}) },
    created_at: '',
    updated_at: '',
  };
}

describe('pickInboundAgent', () => {
  it('prefere o agente por palavra-chave ao agente "qualquer mensagem"', () => {
    const any = agent('any');
    const kw = agent('kw', { inbound: { mode: 'keywords', keywords: ['Trabalhista'] } });
    expect(pickInboundAgent([any, kw], 'Preciso de ajuda trabalhista')?.id).toBe('kw');
    expect(pickInboundAgent([any, kw], 'Oi, tudo bem?')?.id).toBe('any');
  });

  it('nunca escolhe agente com modo "none" e devolve null sem candidato', () => {
    const none = agent('none', { inbound: { mode: 'none', keywords: [] } });
    const kw = agent('kw', { inbound: { mode: 'keywords', keywords: ['contrato'] } });
    expect(pickInboundAgent([none], 'qualquer coisa')).toBeNull();
    expect(pickInboundAgent([none, kw], 'bom dia')).toBeNull();
    expect(pickInboundAgent([none, kw], 'revisão de CONTRATO')?.id).toBe('kw');
  });

  it('modo "keywords" sem palavras-chave não casa; o primeiro "any" é o reserva', () => {
    const empty = agent('empty', { inbound: { mode: 'keywords', keywords: [] } });
    const a1 = agent('a1');
    const a2 = agent('a2');
    expect(pickInboundAgent([empty, a1, a2], 'oi')?.id).toBe('a1');
  });

  it('trata linhas antigas sem triggers como "qualquer mensagem"', () => {
    const legacy = { ...agent('legacy'), triggers: undefined as unknown as AgentTriggers };
    expect(pickInboundAgent([legacy], 'oi')?.id).toBe('legacy');
  });

  it('com keywordsOnly (conversa parada) ignora o modo "qualquer mensagem" e só casa por palavra-chave', () => {
    const any = agent('any');
    const kw = agent('kw', { inbound: { mode: 'keywords', keywords: ['contrato'] } });
    expect(pickInboundAgent([any, kw], 'oi, tudo bem?', { keywordsOnly: true })).toBeNull();
    expect(pickInboundAgent([any], 'oi, tudo bem?', { keywordsOnly: true })).toBeNull();
    expect(pickInboundAgent([any, kw], 'revisão de CONTRATO', { keywordsOnly: true })?.id).toBe('kw');
    // sem a opção, o comportamento de conversa nova continua o mesmo
    expect(pickInboundAgent([any, kw], 'oi, tudo bem?')?.id).toBe('any');
  });
});
