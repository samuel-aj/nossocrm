import { describe, expect, it } from 'vitest';
import type { BotRow, BotStep } from '@/lib/wa-agents/types';
import { botToFlow, flowToBot, formatKeywords, parseKeywords, validateFlow } from './serialize';
import { HANDLE_NEXT, TRIGGER_NODE_ID, edgeIdFor, type FlowHeader } from './types';

const HEADER: FlowHeader = { name: 'Robô', enabled: true, connection_id: '11111111-1111-4111-8111-111111111111' };

function bot(steps: BotStep[], start_step_id: string | null | undefined): BotRow {
  return {
    id: 'bot-1',
    organization_id: 'org-1',
    name: 'Robô',
    enabled: true,
    connection_id: HEADER.connection_id,
    trigger: { type: 'manual', board_id: null, stage_id: null },
    steps,
    start_step_id,
  } as BotRow;
}

describe('parseKeywords / formatKeywords', () => {
  it('separa por vírgula, sem repetidos e sem vazios', () => {
    expect(parseKeywords(' sim, quero ,, pode, sim ')).toEqual(['sim', 'quero', 'pode']);
  });

  it('respeita aspas para palavras com vírgula', () => {
    expect(parseKeywords('"sim, quero", pode')).toEqual(['sim, quero', 'pode']);
    expect(parseKeywords('pode, "sim, quero"')).toEqual(['pode', 'sim, quero']);
  });

  it('aspa no meio da palavra é texto comum', () => {
    expect(parseKeywords('5" de tela, ok')).toEqual(['5" de tela', 'ok']);
  });

  it('faz o round-trip de palavras com vírgula', () => {
    const keywords = ['sim, quero', 'pode'];
    expect(formatKeywords(keywords)).toBe('"sim, quero", pode');
    expect(parseKeywords(formatKeywords(keywords))).toEqual(keywords);
  });

  it('carrega palavras com vírgula entre aspas no nó de condição', () => {
    const steps: BotStep[] = [
      { id: 'a', type: 'condition', rules: [{ keywords: ['sim, quero'], goto_step_id: 'b' }], else_step_id: 'b', ui: { x: 0, y: 0 } },
      { id: 'b', type: 'end', ui: { x: 0, y: 200 } },
    ];
    const { nodes } = botToFlow(bot(steps, 'a'), []);
    const condition = nodes.find((n) => n.id === 'a');
    expect(condition?.type === 'condition' && condition.data.rules[0].keywords).toBe('"sim, quero"');
  });
});

describe('botToFlow: modo lista x modo quadro', () => {
  const listSteps: BotStep[] = [
    { id: 'a', type: 'send_text', text: 'Oi' },
    { id: 'b', type: 'send_text', text: 'Tudo bem?' },
    { id: 'c', type: 'end' },
  ];

  it('robô em lista vira cadeia a partir do gatilho', () => {
    const { edges } = botToFlow(bot(listSteps, null), []);
    const targets = new Map(edges.map((e) => [e.id, e.target]));
    expect(targets.get(edgeIdFor(TRIGGER_NODE_ID, HANDLE_NEXT))).toBe('a');
    expect(targets.get(edgeIdFor('a', HANDLE_NEXT))).toBe('b');
    expect(targets.get(edgeIdFor('b', HANDLE_NEXT))).toBe('c');
  });

  it('passos com posição ou next_step_id não são reescritos em cadeia mesmo sem start_step_id', () => {
    const canvasSteps: BotStep[] = [
      { id: 'a', type: 'send_text', text: 'Oi', next_step_id: 'c', ui: { x: 0, y: 0 } },
      { id: 'b', type: 'send_text', text: 'Solto', next_step_id: null, ui: { x: 400, y: 0 } },
      { id: 'c', type: 'end', ui: { x: 0, y: 200 } },
    ];
    const { nodes, edges } = botToFlow(bot(canvasSteps, null), []);
    const targets = new Map(edges.map((e) => [e.id, e.target]));
    expect(targets.has(edgeIdFor(TRIGGER_NODE_ID, HANDLE_NEXT))).toBe(false);
    expect(targets.get(edgeIdFor('a', HANDLE_NEXT))).toBe('c');
    expect(targets.has(edgeIdFor('b', HANDLE_NEXT))).toBe(false);
    expect(nodes.find((n) => n.id === 'b')?.position).toEqual({ x: 400, y: 0 });
  });

  it('salvar e reabrir preserva as ligações do quadro', () => {
    const first = botToFlow(bot(listSteps, null), []);
    const saved = flowToBot(first.nodes, first.edges, HEADER);
    expect(saved.start_step_id).toBe('a');
    const again = botToFlow({ ...bot(saved.steps, saved.start_step_id), ...saved } as BotRow, []);
    expect(again.edges.map((e) => e.id).sort()).toEqual(first.edges.map((e) => e.id).sort());
  });
});

describe('validateFlow', () => {
  it('gatilho solto com passos é erro, não aviso', () => {
    const steps: BotStep[] = [{ id: 'a', type: 'send_text', text: 'Oi', next_step_id: null, ui: { x: 0, y: 0 } }];
    const { nodes, edges } = botToFlow(bot(steps, null), []);
    const { errors, warnings } = validateFlow(nodes, edges, HEADER);
    expect(errors.map((e) => e.message)).toContain('Ligue a saída Então do gatilho ao primeiro passo');
    expect(warnings).toHaveLength(0);
  });

  it('robô sem passos só avisa', () => {
    const { nodes, edges } = botToFlow(bot([], null), []);
    const { errors, warnings } = validateFlow(nodes, edges, HEADER);
    expect(errors).toHaveLength(0);
    expect(warnings.map((w) => w.message)).toEqual(['O robô não tem passos.']);
  });

  it('numera as mensagens por tipo e omite o número quando há só uma do tipo', () => {
    const steps: BotStep[] = [
      { id: 'a', type: 'wait', seconds: 60 },
      { id: 'b', type: 'send_text', text: 'Oi' },
      { id: 'c', type: 'send_text', text: '' },
      { id: 'd', type: 'add_tag', tag: '' },
    ];
    const { nodes, edges } = botToFlow(bot(steps, null), []);
    const messages = validateFlow(nodes, edges, HEADER).errors.map((e) => e.message);
    expect(messages).toContain('Mensagem 2: a mensagem está vazia');
    expect(messages).toContain('Rótulo: informe o rótulo');
  });
});
