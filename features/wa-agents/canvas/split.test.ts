import { describe, expect, it } from 'vitest';
import { BotInputSchema, BotStepSchema, type BotRow } from '@/lib/wa-agents/types';
import { validateBotSteps } from '@/app/api/wa-agents/_shared';
import { createBotTemplate, parseBotTemplate } from '@/lib/wa-agents/botTemplates';
import { botToFlow, cloneBubbles, createBlock, createBubble, flowToBot, isBubbleNode, pruneEdges, validateFlow } from './serialize';
import { branchHandleId, edgeIdFor, placementProblem, type BlockOfType, type FlowEdge, type FlowHeader, type FlowNode } from './types';

const header: FlowHeader = { name: 'Teste A/B/C/D', enabled: true, connection_ids: ['33333333-3333-4333-8333-333333333333'] };
const split: BlockOfType<'split'> = { id: 'split', type: 'split', data: { mode: 'random', branches: [
  { id: 'route-a', label: 'Mensagem curta', weight: 40 },
  { id: 'route-b', label: 'Mensagem longa', weight: 30 },
  { id: 'route-c', label: 'Com pergunta', weight: 20 },
  { id: 'route-d', label: 'Sem pergunta', weight: 10 },
] } };
const edge = (source: string, sourceHandle: string, target: string): FlowEdge => ({ id: edgeIdFor(source, sourceHandle), source, sourceHandle, target, targetHandle: 'in' });
function graph() {
  const nodes: FlowNode[] = [
    { id: 'gatilho', type: 'trigger', position: { x: 0, y: 0 }, data: { trigger_type: 'manual', board_id: '', stage_id: '', connection_id: '' } },
    createBubble([structuredClone(split)], { x: 300, y: 0 }, 'Distribuição', 'distribution'),
    ...split.data.branches.map((branch, i) => createBubble([{ id: `end-${i}`, type: 'end', data: {} }], { x: 700, y: i * 100 }, branch.label, `destination-${i}`)),
  ];
  const edges = [edge('gatilho', 'next', 'distribution'), ...split.data.branches.map((branch, i) => edge('distribution', branchHandleId(branch.id), `destination-${i}`))];
  return { nodes, edges };
}
const row = (input: ReturnType<typeof flowToBot>) => ({ ...input, id: '11111111-1111-4111-8111-111111111111', organization_id: '22222222-2222-4222-8222-222222222222', created_at: '', updated_at: '' }) as BotRow;

describe('multiple-path distribution editor', () => {
  it('preserves branch identities, weights and destinations across save, reload and template export', () => {
    const { nodes, edges } = graph();
    const input = flowToBot(nodes, edges, header);
    expect(BotInputSchema.safeParse(input).success).toBe(true);
    expect(validateFlow(nodes, edges, header).errors).toEqual([]);
    expect(validateBotSteps(input.steps, input.start_step_id, input.layout, true)).toBeNull();
    const reopened = botToFlow(row(input), []);
    const restored = flowToBot(reopened.nodes, reopened.edges, header);
    expect(restored.steps.find(step => step.id === 'split')).toEqual(input.steps.find(step => step.id === 'split'));
    const imported = parseBotTemplate(createBotTemplate(input)).bot;
    expect(imported.steps.find(step => step.type === 'split')).toEqual(input.steps.find(step => step.type === 'split'));
    expect(imported.enabled).toBe(false);
  });

  it('duplicates all branch handles and destinations without linking the copy to the original', () => {
    const { nodes, edges } = graph();
    const copy = cloneBubbles(nodes.filter(isBubbleNode), edges, { x: 40, y: 40 });
    const copiedSplit = copy.nodes[0].data.blocks[0] as BlockOfType<'split'>;
    expect(copiedSplit.id).not.toBe(split.id);
    expect(copiedSplit.data.branches.map(branch => branch.id)).not.toEqual(split.data.branches.map(branch => branch.id));
    copiedSplit.data.branches.forEach((branch, i) => {
      expect(copy.edges[i]).toMatchObject({ source: copy.nodes[0].id, target: copy.nodes[i + 1].id, sourceHandle: branchHandleId(branch.id) });
      expect(branch.weight).toBe(split.data.branches[i].weight);
    });
  });

  it('renaming a branch keeps its wire; deleting one removes only its wire', () => {
    const { nodes, edges } = graph();
    const bubble = nodes[1];
    if (!isBubbleNode(bubble)) throw new Error('fixture');
    const block = bubble.data.blocks[0] as BlockOfType<'split'>;
    block.data.branches[0].label = 'Nova mensagem';
    expect(pruneEdges(nodes, edges)).toEqual(edges);
    block.data.branches.splice(1, 1);
    expect(pruneEdges(nodes, edges).map(item => item.sourceHandle)).toEqual(['next', 'branch:route-a', 'branch:route-c', 'branch:route-d']);
  });

  it('rejects invalid percentages and missing destinations, but permits a disconnected disabled draft', () => {
    const { nodes, edges } = graph();
    const input = flowToBot(nodes, edges, header);
    const step = input.steps.find(item => item.type === 'split')!;
    if (step.type !== 'split') throw new Error('fixture');
    expect(BotStepSchema.safeParse({ ...step, branches: step.branches.map((branch, i) => ({ ...branch, weight: i ? branch.weight : 39 })) }).success).toBe(false);
    expect(BotStepSchema.safeParse({ ...step, branches: [step.branches[0], step.branches[0]] }).success).toBe(false);
    step.branches[0].goto_step_id = null;
    expect(validateBotSteps(input.steps, input.start_step_id, input.layout, true)?.status).toBe(400);
    expect(validateBotSteps(input.steps, input.start_step_id, input.layout, false)).toBeNull();
    step.branches[0].goto_step_id = 'nonexistent';
    expect(validateBotSteps(input.steps, input.start_step_id, input.layout, false)?.status).toBe(400);
  });

  it('starts with two evenly weighted alternatives and is always the final block in its balloon', () => {
    const block = createBlock('split');
    expect(block).toMatchObject({ type: 'split', data: { mode: 'round_robin', branches: [
      { label: 'A', weight: 50 }, { label: 'B', weight: 50 },
    ] } });
    expect(placementProblem(['send_text'], 'split', 1)).toBeNull();
    expect(placementProblem(['split'], 'send_text', 1)).not.toBeNull();
  });

  it('keeps distinct branches that converge on the same balloon', () => {
    const { nodes, edges } = graph();
    edges.filter(item => item.source === 'distribution').forEach(item => { item.target = 'destination-0'; });
    const saved = flowToBot(nodes, edges, header);
    const loaded = botToFlow(row(saved), []);
    expect(loaded.edges.filter(item => item.source === 'distribution')).toHaveLength(4);
    expect(new Set(loaded.edges.filter(item => item.source === 'distribution').map(item => item.sourceHandle)).size).toBe(4);
  });
});
