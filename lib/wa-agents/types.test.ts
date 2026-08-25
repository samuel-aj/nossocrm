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
} from './types';

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
});
