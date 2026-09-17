/**
 * Blocos novos e campos novos sobrevivem a salvar e reabrir o robô, e robôs
 * salvos antes das mudanças continuam abrindo igual.
 */
import { describe, expect, it } from 'vitest';
import type { BotRow, BotStep } from '@/lib/wa-agents/types';
import { BotStepSchema } from '@/lib/wa-agents/types';
import { botToFlow, createBlock, createBubble, flowToBot, isBubbleNode, validateFlow } from './serialize';
import { HANDLE_IN, HANDLE_NEXT, TRIGGER_NODE_ID, edgeIdFor, type Block, type FlowHeader, type FlowNode } from './types';

const NUMERO = '11111111-1111-4111-8111-111111111111';
const BOARD = '22222222-2222-4222-8222-222222222222';
const STAGE = '33333333-3333-4333-8333-333333333333';
const HEADER: FlowHeader = { name: 'Robô', enabled: true, connection_ids: [NUMERO] };

const trigger = (): FlowNode => ({
  id: TRIGGER_NODE_ID,
  type: 'trigger',
  position: { x: 0, y: 0 },
  data: { trigger_type: 'manual', board_id: '', stage_id: '', connection_id: '' },
});
const edge = (source: string, handle: string, target: string) => ({
  id: edgeIdFor(source, handle),
  source,
  sourceHandle: handle,
  target,
  targetHandle: HANDLE_IN,
});

function asBot(saved: ReturnType<typeof flowToBot>): BotRow {
  return { id: 'b', organization_id: 'o', ...saved } as unknown as BotRow;
}

function roundTrip(blocks: Block[]) {
  const nodes: FlowNode[] = [trigger(), createBubble(blocks, { x: 100, y: 0 }, 'Balão', 'g1')];
  const saved = flowToBot(nodes, [edge(TRIGGER_NODE_ID, HANDLE_NEXT, 'g1')], HEADER);
  // tudo que o editor grava passa no esquema do servidor
  for (const step of saved.steps) expect(BotStepSchema.safeParse(step).success).toBe(true);
  const reopened = botToFlow(asBot(saved), []);
  const bubble = reopened.nodes.find(isBubbleNode)!;
  return { saved, blocks: bubble.data.blocks };
}

describe('blocos novos: salvar e reabrir sem perder nada', () => {
  it('mensagem com digitando e espera de resposta em segundos', () => {
    const msg = createBlock('send_text', 'm');
    if (msg.type === 'send_text') msg.data = { text: 'Oi', typing_seconds: 4 };
    const wait = createBlock('wait_reply', 'w');
    if (wait.type === 'wait_reply') wait.data = { amount: 45, unit: 's' };
    const { saved, blocks } = roundTrip([msg, wait]);
    const stepW = saved.steps.find((s) => s.id === 'w') as Extract<BotStep, { type: 'wait_reply' }>;
    expect(stepW.timeout_seconds).toBe(45);
    expect(blocks[0].data).toEqual({ text: 'Oi', typing_seconds: 4 });
    expect(blocks[1].data).toEqual({ amount: 45, unit: 's' });
  });

  it('mover etapa guarda pipeline, motivo e classificação da perda', () => {
    const mv = createBlock('move_stage', 'mv');
    if (mv.type === 'move_stage') {
      mv.data = { stage_id: STAGE, board_id: BOARD, loss_reason: 'Sem interesse real', loss_category: 'disqualified' };
    }
    const { blocks } = roundTrip([mv]);
    expect(blocks[0].data).toEqual({ stage_id: STAGE, board_id: BOARD, loss_reason: 'Sem interesse real', loss_category: 'disqualified' });
  });

  it('remover tag, criar lead e editar lead (substituir, acrescentar, limpar)', () => {
    const rm = createBlock('remove_tag', 'rm');
    if (rm.type === 'remove_tag') rm.data = { tag: 'frio' };
    const cr = createBlock('create_lead', 'cr');
    if (cr.type === 'create_lead') {
      cr.data = { board_id: BOARD, stage_id: STAGE, changes: [{ id: 'x', field: 'title', key: '', mode: 'replace', value: '{{nome}}' }] };
    }
    const up = createBlock('update_lead', 'up');
    if (up.type === 'update_lead') {
      up.data = {
        changes: [
          { id: '1', field: 'description', key: '', mode: 'append', value: 'veio do robô' },
          { id: '2', field: 'custom_field', key: 'origem', mode: 'replace', value: 'Google' },
          { id: '3', field: 'custom_field', key: 'cidade', mode: 'clear', value: '' },
        ],
      };
    }
    const { saved, blocks } = roundTrip([rm, cr, up]);
    const stepUp = saved.steps.find((s) => s.id === 'up') as Extract<BotStep, { type: 'update_lead' }>;
    expect(stepUp.changes).toEqual([
      { field: 'description', mode: 'append', value: 'veio do robô' },
      { field: 'custom_field', key: 'origem', mode: 'replace', value: 'Google' },
      { field: 'custom_field', key: 'cidade', mode: 'clear' },
    ]);
    expect(blocks.map((b) => b.type)).toEqual(['remove_tag', 'create_lead', 'update_lead']);
    const reUp = blocks[2];
    const rows = reUp.type === 'update_lead' ? reUp.data.changes.map((c) => ({ field: c.field, key: c.key, mode: c.mode, value: c.value })) : [];
    expect(rows).toEqual([
      { field: 'description', key: '', mode: 'append', value: 'veio do robô' },
      { field: 'custom_field', key: 'origem', mode: 'replace', value: 'Google' },
      { field: 'custom_field', key: 'cidade', mode: 'clear', value: '' },
    ]);
  });

  it('robô salvo antes (prazo em minutos, sem digitando) abre com a unidade certa', () => {
    const steps = [
      { id: 'a', type: 'send_text', text: 'Oi', next_step_id: 'b', ui: { x: 0, y: 0 } },
      { id: 'b', type: 'wait_reply', timeout_minutes: 1440, next_step_id: null, ui: { x: 0, y: 0 } },
      { id: 'c', type: 'move_stage', stage_id: STAGE, ui: { x: 0, y: 0 } },
    ] as BotStep[];
    const legacy = { id: 'b', steps, start_step_id: 'a', layout: { groups: [] }, trigger: { type: 'manual' } } as unknown as BotRow;
    const { nodes } = botToFlow(legacy, []);
    const all = nodes.filter(isBubbleNode).flatMap((n) => n.data.blocks);
    expect(all.find((b) => b.id === 'a')?.data).toEqual({ text: 'Oi', typing_seconds: 0 });
    expect(all.find((b) => b.id === 'b')?.data).toEqual({ amount: 1, unit: 'd' });
    expect(all.find((b) => b.id === 'c')?.data).toEqual({ stage_id: STAGE, board_id: '', loss_reason: '', loss_category: '' });
  });

  it('validação aponta criar lead sem etapa e alteração sem valor', () => {
    const cr = createBlock('create_lead', 'cr');
    const up = createBlock('update_lead', 'up');
    const nodes: FlowNode[] = [trigger(), createBubble([cr, up], { x: 0, y: 0 }, '', 'g1')];
    const { errors } = validateFlow(nodes, [edge(TRIGGER_NODE_ID, HANDLE_NEXT, 'g1')], HEADER);
    const text = errors.map((e) => e.message).join(' | ');
    expect(text).toContain('escolha o pipeline e a etapa');
    expect(text).toContain('informe o valor');
  });

  it('modelo apagado, não aprovado ou com botões mudados impede salvar', () => {
    const tpl = createBlock('send_template', 't');
    if (tpl.type === 'send_template') {
      tpl.data = { ...tpl.data, template_id: 'tpl-1', template_name: 'Boas-vindas', buttons: ['Sim', 'Não'] };
    }
    const nodes: FlowNode[] = [trigger(), createBubble([tpl], { x: 0, y: 0 }, '', 'g1')];
    const edges = [edge(TRIGGER_NODE_ID, HANDLE_NEXT, 'g1')];
    const msgs = (templates: Parameters<typeof validateFlow>[3]) =>
      validateFlow(nodes, edges, HEADER, templates).errors.map((e) => e.message).join(' | ');
    expect(msgs([])).toContain('não existe mais');
    expect(msgs([{ id: 'tpl-1', type: 'whatsapp_api', meta_status: 'PENDING', buttons: [] }])).toContain('não foi aprovado');
    expect(
      msgs([{ id: 'tpl-1', type: 'general', buttons: [{ type: 'QUICK_REPLY', text: 'Sim' }] }])
    ).toContain('os botões do modelo mudaram');
    expect(
      msgs([
        { id: 'tpl-1', type: 'general', buttons: [{ type: 'QUICK_REPLY', text: 'Sim' }, { type: 'QUICK_REPLY', text: 'Não' }, { type: 'URL', text: 'Site' }] },
      ])
    ).not.toContain('modelo');
    // lista ainda carregando: não acusa nada
    expect(msgs(undefined)).not.toContain('modelo');
  });
});
