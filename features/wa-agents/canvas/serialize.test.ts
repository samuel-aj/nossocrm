import { describe, expect, it } from 'vitest';
import type { BotRow, BotStep } from '@/lib/wa-agents/types';
import {
  botToFlow,
  cloneBubbles,
  createBlock,
  createBubble,
  flowToBot,
  formatKeywords,
  isBubbleNode,
  parseKeywords,
  pruneEdges,
  validateFlow,
} from './serialize';
import {
  HANDLE_IN,
  HANDLE_NEXT,
  HANDLE_TIMEOUT,
  PASTE_OFFSET,
  TRIGGER_NODE_ID,
  edgeIdFor,
  placementProblem,
  type BubbleNode,
  type FlowEdge,
  type FlowHeader,
  type FlowNode,
} from './types';

const HEADER: FlowHeader = { name: 'Robô', enabled: true, connection_id: '11111111-1111-4111-8111-111111111111' };
const DRAFT: FlowHeader = { ...HEADER, enabled: false };

function bot(steps: BotStep[], start_step_id: string | null | undefined, layout?: BotRow['layout']): BotRow {
  return {
    id: 'bot-1',
    organization_id: 'org-1',
    name: 'Robô',
    enabled: true,
    connection_id: HEADER.connection_id,
    trigger: { type: 'manual', board_id: null, stage_id: null },
    steps,
    start_step_id,
    layout: layout ?? { groups: [] },
  } as BotRow;
}

function edge(source: string, handle: string, target: string): FlowEdge {
  return { id: edgeIdFor(source, handle), source, sourceHandle: handle, target, targetHandle: HANDLE_IN };
}

function trigger(): FlowNode {
  return {
    id: TRIGGER_NODE_ID,
    type: 'trigger',
    position: { x: 0, y: 0 },
    data: { trigger_type: 'manual', board_id: '', stage_id: '' },
  };
}

function message(id: string, text: string) {
  const block = createBlock('send_text', id);
  if (block.type === 'send_text') block.data.text = text;
  return block;
}

function bubbles(nodes: FlowNode[]): BubbleNode[] {
  return nodes.filter(isBubbleNode);
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

  it('carrega palavras com vírgula entre aspas no bloco de condição', () => {
    const steps: BotStep[] = [
      { id: 'a', type: 'condition', rules: [{ keywords: ['sim, quero'], goto_step_id: 'b' }], else_step_id: 'b', ui: { x: 0, y: 0 } },
      { id: 'b', type: 'end', ui: { x: 0, y: 200 } },
    ];
    const { nodes } = botToFlow(bot(steps, 'a'), []);
    const block = bubbles(nodes).flatMap((b) => b.data.blocks).find((b) => b.id === 'a');
    expect(block?.type === 'condition' && block.data.rules[0].keywords).toBe('"sim, quero"');
  });
});

describe('botToFlow: modo lista x modo quadro', () => {
  const listSteps: BotStep[] = [
    { id: 'a', type: 'send_text', text: 'Oi' },
    { id: 'b', type: 'send_text', text: 'Tudo bem?' },
    { id: 'c', type: 'end' },
  ];

  it('robô em lista vira cadeia de balões a partir do gatilho', () => {
    const { nodes, edges } = botToFlow(bot(listSteps, null), []);
    expect(bubbles(nodes).map((b) => b.data.blocks.map((x) => x.id))).toEqual([['a'], ['b'], ['c']]);
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

  it('robô novo (sem passos) mostra só o gatilho', () => {
    const { nodes, edges } = botToFlow(null, []);
    expect(nodes.map((n) => n.type)).toEqual(['trigger']);
    expect(edges).toHaveLength(0);
  });
});

describe('balões com vários blocos (layout.groups)', () => {
  it('robô antigo sem layout vira um balão por passo, na posição salva', () => {
    const steps: BotStep[] = [
      { id: 'a', type: 'send_text', text: 'Oi', next_step_id: 'b', ui: { x: 10, y: 20 } },
      { id: 'b', type: 'wait_reply', timeout_minutes: 30, next_step_id: null, on_timeout_step_id: 'c', ui: { x: 400, y: 20 } },
      { id: 'c', type: 'end', ui: { x: 800, y: 20 } },
    ];
    const { nodes, edges } = botToFlow(bot(steps, 'a'), []);
    const list = bubbles(nodes);
    expect(list).toHaveLength(3);
    expect(list.map((b) => b.data.blocks.length)).toEqual([1, 1, 1]);
    expect(list.find((b) => b.data.blocks[0].id === 'b')?.position).toEqual({ x: 400, y: 20 });
    const targets = new Map(edges.map((e) => [e.id, e.target]));
    expect(targets.get(edgeIdFor('a', HANDLE_NEXT))).toBe('b');
    expect(targets.get(edgeIdFor('b', HANDLE_TIMEOUT))).toBe('c');
    // Ao salvar, o desenho passa a ser gravado em layout.groups
    const saved = flowToBot(nodes, edges, HEADER);
    expect(saved.layout.groups.map((g) => g.step_ids)).toEqual([['a'], ['b'], ['c']]);
  });

  it('balão com 3 blocos encadeia next_step_id e a saída do último vira a ligação do balão', () => {
    const g1 = createBubble([message('a', 'Oi'), createBlock('wait', 'b'), message('c', 'Ainda aí?')], { x: 0, y: 0 }, 'Boas-vindas', 'g1');
    const g2 = createBubble([createBlock('end', 'd')], { x: 400, y: 0 }, 'Fim', 'g2');
    const nodes: FlowNode[] = [trigger(), g1, g2];
    const edges = [edge(TRIGGER_NODE_ID, HANDLE_NEXT, 'g1'), edge('g1', HANDLE_NEXT, 'g2')];
    const saved = flowToBot(nodes, edges, HEADER);
    expect(saved.start_step_id).toBe('a');
    const next = new Map(saved.steps.map((s) => [s.id, s.next_step_id ?? null]));
    expect(next.get('a')).toBe('b');
    expect(next.get('b')).toBe('c');
    expect(next.get('c')).toBe('d');
    expect(saved.layout.groups).toEqual([
      { id: 'g1', name: 'Boas-vindas', x: 0, y: 0, step_ids: ['a', 'b', 'c'] },
      { id: 'g2', name: 'Fim', x: 400, y: 0, step_ids: ['d'] },
    ]);
    // Reabrir devolve os mesmos balões, na mesma ordem de blocos
    const again = botToFlow({ ...bot(saved.steps, saved.start_step_id, saved.layout), ...saved } as BotRow, []);
    expect(bubbles(again.nodes).map((b) => [b.id, b.data.name, b.data.blocks.map((x) => x.id)])).toEqual([
      ['g1', 'Boas-vindas', ['a', 'b', 'c']],
      ['g2', 'Fim', ['d']],
    ]);
    expect(again.edges.map((e) => e.id).sort()).toEqual(edges.map((e) => e.id).sort());
  });

  it('colar preserva as ligações entre os balões copiados e descarta as externas', () => {
    const g1 = createBubble([message('a', 'Oi'), createBlock('wait_reply', 'b')], { x: 0, y: 0 }, 'Pergunta', 'g1');
    const g2 = createBubble([createBlock('end', 'c')], { x: 400, y: 0 }, '', 'g2');
    const g3 = createBubble([createBlock('end', 'd')], { x: 400, y: 200 }, '', 'g3');
    const edges = [edge('g1', HANDLE_NEXT, 'g2'), edge('g1', HANDLE_TIMEOUT, 'g3')];
    const pasted = cloneBubbles([g1, g2], edges, { x: PASTE_OFFSET, y: PASTE_OFFSET });
    expect(pasted.nodes).toHaveLength(2);
    const [p1, p2] = pasted.nodes;
    expect(p1.id).not.toBe('g1');
    expect(p1.data.name).toBe('Pergunta');
    expect(p1.data.blocks.map((b) => b.type)).toEqual(['send_text', 'wait_reply']);
    expect(p1.data.blocks.map((b) => b.id)).not.toContain('a');
    expect(p1.position).toEqual({ x: PASTE_OFFSET, y: PASTE_OFFSET });
    expect(p1.selected).toBe(true);
    // Só a ligação interna (Respondeu -> g2) sobrevive; a externa (Sem resposta -> g3) é descartada
    expect(pasted.edges).toHaveLength(1);
    expect(pasted.edges[0]).toMatchObject({ source: p1.id, sourceHandle: HANDLE_NEXT, target: p2.id });
  });

  it('colar uma condição renomeia as saídas das regras junto com as regras', () => {
    const cond = createBlock('condition', 'k');
    const ruleId = cond.type === 'condition' ? cond.data.rules[0].id : '';
    const g1 = createBubble([cond], { x: 0, y: 0 }, '', 'g1');
    const g2 = createBubble([createBlock('end', 'e')], { x: 400, y: 0 }, '', 'g2');
    const pasted = cloneBubbles([g1, g2], [edge('g1', `rule:${ruleId}`, 'g2')], { x: 0, y: 0 });
    const newRule = pasted.nodes[0].data.blocks[0];
    const newRuleId = newRule.type === 'condition' ? newRule.data.rules[0].id : '';
    expect(newRuleId).not.toBe(ruleId);
    expect(pasted.edges[0].sourceHandle).toBe(`rule:${newRuleId}`);
  });

  it('bloco de várias saídas ou terminal só pode ser o último do balão', () => {
    expect(placementProblem(['send_text'], 'wait_reply', 1)).toBeNull();
    expect(placementProblem(['send_text'], 'wait_reply', 0)).toContain('último bloco');
    expect(placementProblem(['send_text', 'end'], 'send_text', 2)).toContain('Nada pode vir depois');
    expect(placementProblem(['send_text', 'condition'], 'wait', 2)).toContain('mais de uma saída');
    expect(placementProblem(['send_text', 'wait'], 'send_text', 1)).toBeNull();

    const bad = createBubble([createBlock('wait_reply', 'a'), message('b', 'Oi')], { x: 0, y: 0 }, '', 'g1');
    const nodes: FlowNode[] = [trigger(), bad];
    const { errors } = validateFlow(nodes, [edge(TRIGGER_NODE_ID, HANDLE_NEXT, 'g1')], HEADER);
    expect(errors.map((e) => e.message)).toContain('Esperar resposta: tem mais de uma saída, por isso precisa ser o último bloco do balão');
    expect(errors.find((e) => e.blockId === 'a')?.nodeId).toBe('g1');
  });

  it('pruneEdges tira a ligação de uma saída que deixou de existir', () => {
    const g1 = createBubble([message('a', 'Oi')], { x: 0, y: 0 }, '', 'g1');
    const g2 = createBubble([createBlock('end', 'b')], { x: 400, y: 0 }, '', 'g2');
    const edges = [edge(TRIGGER_NODE_ID, HANDLE_NEXT, 'g1'), edge('g1', HANDLE_NEXT, 'g2'), edge('g1', HANDLE_TIMEOUT, 'g2')];
    const kept = pruneEdges([trigger(), g1, g2], edges);
    expect(kept.map((e) => e.id)).toEqual([edgeIdFor(TRIGGER_NODE_ID, HANDLE_NEXT), edgeIdFor('g1', HANDLE_NEXT)]);
    expect(pruneEdges([trigger(), g1, g2], kept)).toBe(kept);
  });
});

describe('validateFlow', () => {
  it('gatilho solto com balões é erro no robô ligado e aviso no desligado', () => {
    const steps: BotStep[] = [{ id: 'a', type: 'send_text', text: 'Oi', next_step_id: null, ui: { x: 0, y: 0 } }];
    const { nodes, edges } = botToFlow(bot(steps, null), []);
    const on = validateFlow(nodes, edges, HEADER);
    expect(on.errors.map((e) => e.message)).toContain(
      'Ligue a saída "Então" do gatilho ao primeiro balão (ou desligue o robô para salvar como rascunho)'
    );
    expect(on.warnings).toHaveLength(0);
    const off = validateFlow(nodes, edges, DRAFT);
    expect(off.errors).toHaveLength(0);
    expect(off.warnings.map((w) => w.message)).toEqual([
      'O gatilho não está ligado a nenhum balão: o robô não vai fazer nada até isso ser ligado.',
    ]);
  });

  it('robô sem balões: rascunho só avisa, ligado é erro', () => {
    const { nodes, edges } = botToFlow(bot([], null), []);
    const off = validateFlow(nodes, edges, DRAFT);
    expect(off.errors).toHaveLength(0);
    expect(off.warnings.map((w) => w.message)).toEqual(['O robô ainda não tem balões: fica salvo como rascunho.']);
    const on = validateFlow(nodes, edges, HEADER);
    expect(on.errors.map((e) => e.message)).toContain(
      'O robô está vazio: adicione um balão ligado ao gatilho ou desligue o robô para salvar como rascunho'
    );
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

  it('prefixa com o nome do balão e aponta o bloco com problema', () => {
    const g1 = createBubble([message('a', 'Oi'), message('b', '')], { x: 0, y: 0 }, 'Boas-vindas', 'g1');
    const { errors } = validateFlow([trigger(), g1], [edge(TRIGGER_NODE_ID, HANDLE_NEXT, 'g1')], HEADER);
    const issue = errors.find((e) => e.blockId === 'b');
    expect(issue?.message).toBe('Boas-vindas › Mensagem 2: a mensagem está vazia');
    expect(issue?.nodeId).toBe('g1');
  });
});
