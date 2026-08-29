import { describe, expect, it } from 'vitest';
import { agentWithDraft } from './test';
import { DEFAULT_AGENT_TOOLS, DEFAULT_AGENT_TRIGGERS, DEFAULT_AGENT_TYPING, type AgentRow } from './types';

const salvo: AgentRow = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  organization_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  name: 'Lia',
  persona_name: 'Lia',
  enabled: true,
  connection_ids: [],
  provider: 'openai',
  model: 'gpt-4.1',
  temperature: 0.5,
  api_key: 'sk-chave-salva',
  system_prompt: 'roteiro salvo',
  buffer_seconds: 10,
  history_limit: 40,
  line_delay_ms: 1500,
  human_pause_minutes: 30,
  only_new_conversations: false,
  stop_rules: '',
  max_replies: 0,
  start_mode: 'speak_first',
  followups: [],
  outcomes: [],
  webhooks: [],
  custom_actions: [],
  triggers: DEFAULT_AGENT_TRIGGERS,
  helper_agent_ids: [],
  tools: DEFAULT_AGENT_TOOLS,
  typing: DEFAULT_AGENT_TYPING,
  created_by: null,
  created_at: '',
  updated_at: '',
};

describe('agentWithDraft', () => {
  it('sem rascunho devolve o agente salvo', () => {
    expect(agentWithDraft(salvo, undefined)).toBe(salvo);
    expect(agentWithDraft(salvo, null)).toBe(salvo);
  });

  it('usa o que está na tela por cima do salvo', () => {
    const r = agentWithDraft(salvo, { system_prompt: 'roteiro da tela', temperature: 1 });
    expect(r.system_prompt).toBe('roteiro da tela');
    expect(r.temperature).toBe(1);
    expect(r.model).toBe('gpt-4.1');
  });

  it('só aplica as chaves realmente enviadas', () => {
    const r = agentWithDraft(salvo, { system_prompt: 'novo', model: 'gpt-5.2' }, { presentKeys: ['system_prompt'] });
    expect(r.system_prompt).toBe('novo');
    expect(r.model).toBe('gpt-4.1');
  });

  it('não deixa a tela trocar id nem organização', () => {
    const r = agentWithDraft(salvo, {
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      organization_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      name: 'outro',
    } as Partial<AgentRow>);
    expect(r.id).toBe(salvo.id);
    expect(r.organization_id).toBe(salvo.organization_id);
    expect(r.name).toBe('outro');
  });

  it('mantém a chave salva quando a tela não manda chave nova', () => {
    const r = agentWithDraft(salvo, { system_prompt: 'x', api_key: '••••••••' } as Partial<AgentRow>);
    expect(r.api_key).toBe('sk-chave-salva');
  });

  it('usa a chave digitada agora e aceita limpar', () => {
    expect(agentWithDraft(salvo, { system_prompt: 'x' }, { apiKey: 'sk-nova' }).api_key).toBe('sk-nova');
    expect(agentWithDraft(salvo, { system_prompt: 'x' }, { apiKey: null }).api_key).toBeNull();
  });

  it('não altera o agente salvo recebido', () => {
    agentWithDraft(salvo, { system_prompt: 'outro' });
    expect(salvo.system_prompt).toBe('roteiro salvo');
  });
});
