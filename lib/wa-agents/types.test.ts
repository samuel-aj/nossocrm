import { describe, expect, it } from 'vitest';
import {
  AGENT_EVENTS,
  AGENT_EVENT_LABELS,
  AgentInputSchema,
  AgentTriggersSchema,
  BotInputSchema,
  BotStepSchema,
  CustomActionSchema,
  DEFAULT_AGENT_TRIGGERS,
  EndActionSchema,
  isAllowedMediaMime,
  isMaskedSecret,
  SECRET_MASK,
  toAgentPublic,
  normalizeBotLayout,
  toBotPublic,
  type AgentRow,
  type BotRow,
} from './types';

describe('segredos mascarados e mimes de mídia', () => {
  it('toAgentPublic tira a chave e mascara os segredos de webhook (só quando existem)', () => {
    const row = {
      ...AgentInputSchema.parse({
        name: 'Ana',
        provider: 'openai',
        model: 'gpt-4.1-mini',
        webhooks: [
          { id: 'w1', event: 'finished', url: 'https://exemplo.com/a', secret: 'segredo-1', active: true },
          { id: 'w2', event: 'finished', url: 'https://exemplo.com/b', secret: null, active: true },
        ],
        outcomes: [
          { key: 'ok', label: 'Ok', actions: [{ type: 'webhook', url: 'https://exemplo.com/c', secret: 'segredo-2' }, { type: 'stop' }] },
        ],
        custom_actions: [
          { key: 'x', label: 'X', description: 'quando x', actions: [{ type: 'webhook', url: 'https://exemplo.com/d', secret: '' }] },
        ],
      }),
      id: 'a',
      organization_id: 'o',
      api_key: 'sk-123',
      created_at: '',
      updated_at: '',
    } as AgentRow;
    const pub = toAgentPublic(row);
    expect('api_key' in pub).toBe(false);
    expect(pub.has_api_key).toBe(true);
    expect(pub.webhooks[0].secret).toBe(SECRET_MASK);
    expect(pub.webhooks[1].secret).toBeNull();
    const act = pub.outcomes[0].actions[0];
    expect(act.type === 'webhook' ? act.secret : null).toBe(SECRET_MASK);
    const custom = pub.custom_actions[0].actions[0];
    expect(custom.type === 'webhook' ? custom.secret : 'x').toBeNull();
    expect(isMaskedSecret(SECRET_MASK)).toBe(true);
    expect(isMaskedSecret('segredo')).toBe(false);
    // a linha original não muda
    expect(row.webhooks[0].secret).toBe('segredo-1');
  });

  it('toBotPublic mascara o segredo do passo webhook', () => {
    const bot = {
      id: 'b',
      organization_id: 'o',
      name: 'Robô',
      enabled: true,
      connection_id: null,
      trigger: { type: 'manual' },
      steps: [
        { id: 's1', type: 'webhook', url: 'https://exemplo.com/x', secret: 'abc' },
        { id: 's2', type: 'send_text', text: 'oi' },
      ],
      created_at: '',
      updated_at: '',
    } as BotRow;
    const pub = toBotPublic(bot);
    const step = pub.steps[0];
    expect(step.type === 'webhook' ? step.secret : null).toBe(SECRET_MASK);
    expect(pub.steps[1]).toEqual(bot.steps[1]);
  });

  it('isAllowedMediaMime usa a lista fechada por categoria', () => {
    expect(isAllowedMediaMime('image', 'image/png')).toBe(true);
    expect(isAllowedMediaMime('image', 'IMAGE/JPEG; charset=x')).toBe(true);
    expect(isAllowedMediaMime('image', 'image/svg+xml')).toBe(false);
    expect(isAllowedMediaMime('document', 'application/pdf')).toBe(true);
    expect(isAllowedMediaMime('document', 'application/x-msdownload')).toBe(false);
    expect(isAllowedMediaMime('document', 'text/html')).toBe(false);
    expect(isAllowedMediaMime('video', '')).toBe(false);
  });
});

describe('esquemas do agente (adendo)', () => {
  it('AgentInputSchema aplica os padrões de custom_actions e triggers', () => {
    const parsed = AgentInputSchema.parse({ name: 'Ana', provider: 'openai', model: 'gpt-4.1-mini' });
    expect(parsed.custom_actions).toEqual([]);
    expect(parsed.triggers).toEqual(DEFAULT_AGENT_TRIGGERS);
  });

  it('AgentTriggersSchema completa blocos parciais com os padrões', () => {
    const parsed = AgentTriggersSchema.parse({ inbound: { mode: 'keywords', keywords: ['contrato'] } });
    expect(parsed.inbound).toEqual({ mode: 'keywords', keywords: ['contrato'] });
    expect(parsed.deal).toEqual(DEFAULT_AGENT_TRIGGERS.deal);
    const partialDeal = AgentTriggersSchema.parse({ deal: { enabled: true } });
    expect(partialDeal.deal.event).toBe('deal_created');
    expect(partialDeal.deal.connection_id).toBeNull();
  });

  it('EndActionSchema aceita webhook e CustomActionSchema exige descrição', () => {
    expect(
      EndActionSchema.safeParse({ type: 'webhook', url: 'https://exemplo.com/hook', secret: null, body_template: null })
        .success
    ).toBe(true);
    expect(EndActionSchema.safeParse({ type: 'webhook', url: 'não é url' }).success).toBe(false);
    expect(
      CustomActionSchema.safeParse({ key: 'ja-tem-advogado', label: 'Já tem advogado', description: '' }).success
    ).toBe(false);
    const ok = CustomActionSchema.parse({
      key: 'ja-tem-advogado',
      label: 'Já tem advogado',
      description: 'o cliente informar que já tem advogado',
    });
    expect(ok.actions).toEqual([]);
  });

  it('AgentInputSchema aplica os padrões de helper_agent_ids e tools', () => {
    const parsed = AgentInputSchema.parse({ name: 'Ana', provider: 'openai', model: 'gpt-4.1-mini' });
    expect(parsed.helper_agent_ids).toEqual([]);
    expect(parsed.tools).toEqual({ calculator: true });
    const off = AgentInputSchema.parse({ name: 'Ana', provider: 'openai', model: 'x', tools: { calculator: false } });
    expect(off.tools.calculator).toBe(false);
    expect(AgentInputSchema.safeParse({ name: 'Ana', provider: 'openai', model: 'x', helper_agent_ids: ['abc'] }).success).toBe(false);
  });

  it('AgentInputSchema aplica os padrões de stop_rules e max_replies e limita o teto a 500', () => {
    const parsed = AgentInputSchema.parse({ name: 'Ana', provider: 'openai', model: 'gpt-4.1-mini' });
    expect(parsed.stop_rules).toBe('');
    expect(parsed.max_replies).toBe(0);
    const withLimit = AgentInputSchema.parse({ name: 'Ana', provider: 'openai', model: 'x', stop_rules: 'Encerre quando tiver a cidade.', max_replies: 30 });
    expect(withLimit.stop_rules).toBe('Encerre quando tiver a cidade.');
    expect(withLimit.max_replies).toBe(30);
    expect(AgentInputSchema.safeParse({ name: 'Ana', provider: 'openai', model: 'x', max_replies: 501 }).success).toBe(false);
    expect(AgentInputSchema.safeParse({ name: 'Ana', provider: 'openai', model: 'x', max_replies: -1 }).success).toBe(false);
    expect(AgentInputSchema.safeParse({ name: 'Ana', provider: 'openai', model: 'x', max_replies: 2.5 }).success).toBe(false);
  });

  it('eventos novos têm rótulo em pt-BR', () => {
    expect(AGENT_EVENTS).toContain('custom_action');
    expect(AGENT_EVENTS).toContain('deal_started');
    expect(AGENT_EVENT_LABELS.custom_action).toBe('Ação durante a conversa');
    expect(AGENT_EVENT_LABELS.deal_started).toBe('Iniciado pelo pipeline');
  });
});

describe('esquemas do robô (quadro)', () => {
  it('passos aceitam next_step_id e ui; passo webhook existe', () => {
    const step = BotStepSchema.parse({
      id: 'a',
      type: 'send_text',
      text: 'Oi',
      next_step_id: 'b',
      ui: { x: 10, y: 20 },
    });
    expect(step.next_step_id).toBe('b');
    expect(step.ui).toEqual({ x: 10, y: 20 });
    const hook = BotStepSchema.parse({ id: 'w', type: 'webhook', url: 'https://exemplo.com/x', next_step_id: null });
    expect(hook.type).toBe('webhook');
  });

  it('robôs antigos (sem start_step_id, sem next_step_id) continuam válidos', () => {
    const bot = BotInputSchema.parse({
      name: 'Boas-vindas',
      connection_id: null,
      trigger: { type: 'manual' },
      steps: [
        { id: 'p1', type: 'send_text', text: 'Oi' },
        { id: 'p2', type: 'end' },
      ],
    });
    expect(bot.start_step_id).toBeUndefined();
    expect(bot.steps).toHaveLength(2);
  });

  it('start_step_id aceita texto ou null', () => {
    expect(BotInputSchema.parse({ name: 'x', connection_id: null, trigger: { type: 'manual' }, start_step_id: 'p1' }).start_step_id).toBe('p1');
    expect(BotInputSchema.parse({ name: 'x', connection_id: null, trigger: { type: 'manual' }, start_step_id: null }).start_step_id).toBeNull();
  });

  it('layout (balões) tem padrão vazio, aceita grupos e é normalizado ao devolver o robô', () => {
    const empty = BotInputSchema.parse({ name: 'x', connection_id: null, trigger: { type: 'manual' } });
    expect(empty.layout).toEqual({ groups: [] });
    const withGroups = BotInputSchema.parse({
      name: 'x',
      connection_id: null,
      trigger: { type: 'manual' },
      steps: [{ id: 'a', type: 'send_text', text: 'Oi', next_step_id: 'b' }, { id: 'b', type: 'end' }],
      start_step_id: 'a',
      layout: { groups: [{ id: 'g1', x: 10, y: 20, step_ids: ['a', 'b'] }] },
    });
    expect(withGroups.layout.groups[0]).toEqual({ id: 'g1', name: '', x: 10, y: 20, step_ids: ['a', 'b'] });
    expect(normalizeBotLayout({})).toEqual({ groups: [] });
    expect(normalizeBotLayout(null)).toEqual({ groups: [] });
    expect(normalizeBotLayout({ groups: 'x' })).toEqual({ groups: [] });
    const pub = toBotPublic({ steps: [], layout: {} } as unknown as BotRow);
    expect(pub.layout).toEqual({ groups: [] });
  });
});
