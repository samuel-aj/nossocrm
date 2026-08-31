/**
 * Serialização entre o quadro (balões e arestas do React Flow) e o formato salvo
 * do robô (BotInput: passos planos com next_step_id / goto_step_id / else_step_id /
 * on_timeout_step_id, posição em `ui`, `start_step_id` e o desenho em `layout.groups`).
 *
 * Um balão = lista ORDENADA de blocos (passos). Dentro do balão cada passo liga
 * ao seguinte (`next_step_id`); as saídas do ÚLTIMO bloco viram as ligações do
 * balão. O motor não muda: continua lendo os passos planos.
 *
 * Compatibilidade ao abrir:
 * - robô salvo sem `layout.groups` (um passo por nó, `ui` em cada passo): vira
 *   um balão por passo, na posição salva;
 * - robô antigo em lista (sem start_step_id, sem `ui` e sem next_step_id): cada
 *   passo liga ao seguinte da lista, com layout vertical automático.
 */
import type { XYPosition } from '@xyflow/react';
import type { BotInput, BotLayoutGroup, BotRow, BotStep ,
  BotConditionRule,
} from '@/lib/wa-agents/types';
import { newId } from '../ui';
import {
  BLOCK_KIND,
  HANDLE_ELSE,
  HANDLE_IN,
  HANDLE_NEXT,
  HANDLE_TIMEOUT,
  MAX_REPLY_MINUTES,
  MAX_WAIT_SECONDS,
  STEP_LABELS,
  TRIGGER_NODE_ID,
  WAIT_UNIT_SECONDS,
  bubbleOutputs,
  edgeIdFor,
  buttonHandleId,
  isLinearType,
  newConditionClause,
  newConditionRule,
  opNeedsValue,
  ruleHandleId,
  unitFor,
  type Block,
  type BubbleData,
  type ConditionClauseDraft,
  type BubbleNode,
  type FlowEdge,
  type FlowGraph,
  type FlowHeader,
  type FlowNode,
  type StepType,
  type TriggerNode,
  type WaitData,
} from './types';

/** Layout automático dos robôs em lista: coluna fixa, um passo abaixo do outro. */
const LEGACY_X = 80;
const LEGACY_GAP_Y = 170;
/** O gatilho fica à esquerda do primeiro balão. */
export const TRIGGER_OFFSET_X = 360;

/**
 * "sim, quero, pode" -> ['sim', 'quero', 'pode'] (sem repetidos e sem vazios).
 * Aspas duplas protegem a vírgula: '"sim, quero", pode' -> ['sim, quero', 'pode'].
 * Uma aspa no meio de uma palavra (5" de tela) é texto comum.
 */
export function parseKeywords(text: string): string[] {
  const parts: string[] = [];
  let current = '';
  let quoted = false;
  for (const ch of text) {
    if (ch === '"' && (quoted || current.trim() === '')) {
      quoted = !quoted;
      continue;
    }
    if (ch === ',' && !quoted) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return Array.from(new Set(parts.map((s) => s.trim()).filter(Boolean)));
}

/** Inverso de parseKeywords: palavras com vírgula voltam entre aspas para sobreviver ao próximo parse. */
export function formatKeywords(keywords: string[]): string {
  return keywords.map((k) => (k.includes(',') ? `"${k}"` : k)).join(', ');
}

export function clampInt(value: number, min: number, max: number): number {
  const n = Math.round(value);
  if (Number.isNaN(n)) return min;
  return Math.max(min, Math.min(max, n));
}

/** Segundos de um bloco Esperar a partir do que foi digitado (quantidade + unidade). */
export function waitSeconds(data: WaitData): number {
  return Math.round(data.amount * WAIT_UNIT_SECONDS[data.unit]);
}

export function isTriggerNode(node: FlowNode): node is TriggerNode {
  return node.type === 'trigger';
}

export function isBubbleNode(node: FlowNode): node is BubbleNode {
  return node.type === 'bubble';
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Nome mostrado do balão: o nome dado ou o rótulo do primeiro bloco. */
export function bubbleTitle(data: BubbleData): string {
  const name = data.name.trim();
  if (name) return name;
  const first = data.blocks[0];
  return first ? STEP_LABELS[first.type] : 'Balão';
}

// ---------------------------------------------------------------- Criação

/** Bloco novo com os dados padrão do tipo. */
export function createBlock(type: StepType, id: string = newId()): Block {
  switch (type) {
    case 'send_text':
      return { id, type, data: { text: '' } };
    case 'send_template':
      return { id, type, data: { template_id: '', template_name: '', template_body: '', buttons: [], timeout_minutes: 1440 } };
    case 'wait':
      return { id, type, data: { amount: 1, unit: 'h' } };
    case 'wait_reply':
      return { id, type, data: { timeout_minutes: 60 } };
    case 'condition':
      return { id, type, data: { rules: [newConditionRule(newId())] } };
    case 'move_stage':
      return { id, type, data: { stage_id: '' } };
    case 'add_tag':
      return { id, type, data: { tag: '' } };
    case 'webhook':
      return { id, type, data: { url: '', secret: '', body_template: '' } };
    case 'handoff_agent':
      return { id, type, data: { agent_id: '' } };
    case 'typing':
      return { id, type, data: { seconds: 3 } };
    case 'start_bot':
      return { id, type, data: { bot_id: '', bot_name: '' } };
    case 'end':
      return { id, type, data: {} };
  }
}

/** Nó Balão novo. */
export function createBubble(blocks: Block[], position: XYPosition, name = '', id: string = newId()): BubbleNode {
  return { id, type: 'bubble', position, data: { name, blocks } };
}

function createTriggerNode(trigger: BotRow['trigger'] | null, position: XYPosition): TriggerNode {
  return {
    id: TRIGGER_NODE_ID,
    type: 'trigger',
    position,
    deletable: false,
    data: {
      trigger_type: trigger?.type ?? 'deal_stage_entered',
      board_id: trigger?.board_id ?? '',
      stage_id: trigger?.stage_id ?? '',
      connection_id: trigger?.connection_id ?? '',
    },
  };
}

/**
 * Cópia de um bloco com ids novos (do bloco e das regras da condição).
 * `handleMap` recebe "handle antigo -> handle novo" das regras, para as
 * ligações copiadas continuarem apontando para a regra certa.
 */
export function cloneBlock(block: Block, handleMap?: Map<string, string>): Block {
  const id = newId();
  if (block.type === 'condition') {
    const rules = block.data.rules.map((rule) => {
      const ruleId = newId();
      handleMap?.set(ruleHandleId(rule.id), ruleHandleId(ruleId));
      return { ...rule, id: ruleId };
    });
    return { id, type: 'condition', data: { rules } };
  }
  return { ...block, id, data: { ...block.data } } as Block;
}

/** Regra salva -> condições do quadro. Regras antigas (kind/keywords/tag/stage_id) viram condições equivalentes. */
function ruleToClauses(r: BotConditionRule): ConditionClauseDraft[] {
  if (r.clauses && r.clauses.length > 0) {
    return r.clauses.map((c) => ({ id: newId(), field: c.field, key: c.key ?? '', op: c.op, value: c.value ?? '' }));
  }
  const kind = r.kind ?? 'reply_contains';
  if (kind === 'reply_contains' || kind === 'reply_not_contains') {
    const keywords = r.keywords ?? [];
    if (keywords.length === 0) return [newConditionClause(newId())];
    return keywords.map((k) => ({ id: newId(), field: 'reply' as const, key: '', op: kind === 'reply_contains' ? ('contains' as const) : ('not_contains' as const), value: k }));
  }
  if (kind === 'tag_has' || kind === 'tag_not_has') {
    return [{ id: newId(), field: 'tags', key: '', op: kind === 'tag_has' ? 'contains' : 'not_contains', value: r.tag ?? '' }];
  }
  return [{ id: newId(), field: 'stage', key: '', op: kind === 'stage_is' ? 'equals' : 'not_equals', value: r.stage_id ?? '' }];
}

/** Passo salvo -> bloco do balão. */
function stepToBlock(step: BotStep): Block {
  const id = step.id;
  switch (step.type) {
    case 'send_text':
      return { id, type: 'send_text', data: { text: step.text } };
    case 'send_template':
      return {
        id,
        type: 'send_template',
        data: {
          template_id: step.template_id,
          template_name: step.template_name ?? '',
          template_body: step.template_body ?? '',
          buttons: [...(step.buttons ?? [])],
          timeout_minutes: step.timeout_minutes ?? 1440,
        },
      };
    case 'wait': {
      const unit = unitFor(step.seconds);
      return {
        id,
        type: 'wait',
        data: { amount: Math.max(1, Math.round(step.seconds / WAIT_UNIT_SECONDS[unit])), unit },
      };
    }
    case 'wait_reply':
      return { id, type: 'wait_reply', data: { timeout_minutes: step.timeout_minutes } };
    case 'condition':
      return {
        id,
        type: 'condition',
        data: {
          rules: step.rules.map((r) => ({
            id: newId(),
            label: r.label ?? '',
            // várias palavras-chave antigas = qualquer uma (OU); regras novas trazem o próprio match
            match: r.match ?? ((r.clauses ?? []).length === 0 && (r.kind ?? 'reply_contains') === 'reply_contains' ? 'any' : 'all'),
            clauses: ruleToClauses(r),
          })),
        },
      };
    case 'move_stage':
      return { id, type: 'move_stage', data: { stage_id: step.stage_id } };
    case 'add_tag':
      return { id, type: 'add_tag', data: { tag: step.tag } };
    case 'webhook':
      return {
        id,
        type: 'webhook',
        data: { url: step.url, secret: step.secret ?? '', body_template: step.body_template ?? '' },
      };
    case 'handoff_agent':
      return { id, type: 'handoff_agent', data: { agent_id: step.agent_id } };
    case 'typing':
      return { id, type: 'typing', data: { seconds: step.seconds } };
    case 'start_bot':
      return { id, type: 'start_bot', data: { bot_id: step.bot_id, bot_name: step.bot_name ?? '' } };
    case 'end':
      return { id, type: 'end', data: {} };
  }
}

function makeEdge(source: string, sourceHandle: string, target: string): FlowEdge {
  return { id: edgeIdFor(source, sourceHandle), source, sourceHandle, target, targetHandle: HANDLE_IN };
}

// ---------------------------------------------------------------- Robô -> quadro

/**
 * Converte um robô salvo (ou os passos padrão de um robô novo) em balões e arestas.
 * Balões vêm de `layout.groups`; passos fora de qualquer balão viram um balão
 * cada (na posição `ui` ou, no robô em lista, empilhados na vertical). Em modo
 * lista (sem `start_step_id`, sem `ui`, sem `next_step_id` e sem balões) a ordem
 * da lista vira a cadeia de ligações.
 */
export function botToFlow(bot: BotRow | null, fallbackSteps: BotStep[]): FlowGraph {
  const steps: BotStep[] = bot ? bot.steps : fallbackSteps;
  const rawGroups = bot?.layout?.groups;
  const groups: BotLayoutGroup[] = Array.isArray(rawGroups) ? rawGroups : [];
  const canvasMode =
    !!bot?.start_step_id || groups.length > 0 || steps.some((s) => s.ui !== undefined || s.next_step_id !== undefined);
  const stepById = new Map(steps.map((s) => [s.id, s]));
  const indexById = new Map(steps.map((s, i) => [s.id, i]));

  const bubbles: BubbleNode[] = [];
  const usedSteps = new Set<string>();
  const usedIds = new Set<string>([TRIGGER_NODE_ID]);
  const uniqueId = (wanted: string): string => {
    let id = wanted;
    while (usedIds.has(id)) id = newId();
    usedIds.add(id);
    return id;
  };

  // 1) Balões salvos: ids de passos que não existem são ignorados; passo repetido fica no primeiro balão.
  for (const group of groups) {
    const blocks: Block[] = [];
    for (const stepId of group.step_ids ?? []) {
      const step = stepById.get(stepId);
      if (!step || usedSteps.has(stepId)) continue;
      usedSteps.add(stepId);
      blocks.push(stepToBlock(step));
    }
    if (blocks.length === 0) continue;
    bubbles.push(createBubble(blocks, { x: group.x, y: group.y }, group.name ?? '', uniqueId(group.id)));
  }

  // 2) Passos fora de qualquer balão: um balão por passo (robô salvo antes dos balões ou em lista).
  steps.forEach((step, index) => {
    if (usedSteps.has(step.id)) return;
    usedSteps.add(step.id);
    const position = step.ui ? { x: step.ui.x, y: step.ui.y } : { x: LEGACY_X, y: index * LEGACY_GAP_Y };
    bubbles.push(createBubble([stepToBlock(step)], position, '', uniqueId(step.id)));
  });

  const bubbleOfStep = new Map<string, string>();
  for (const bubble of bubbles) for (const block of bubble.data.blocks) bubbleOfStep.set(block.id, bubble.id);

  const startStepId = canvasMode ? (bot?.start_step_id ?? null) : (steps[0]?.id ?? null);
  const startBubbleId = startStepId ? (bubbleOfStep.get(startStepId) ?? null) : null;
  const startBubble = startBubbleId ? bubbles.find((b) => b.id === startBubbleId) : undefined;
  // Posição salva do gatilho tem prioridade; sem ela, fica à esquerda do primeiro balão
  const triggerPosition: XYPosition = bot?.trigger?.ui
    ? { x: bot.trigger.ui.x, y: bot.trigger.ui.y }
    : startBubble
      ? { x: startBubble.position.x - TRIGGER_OFFSET_X, y: startBubble.position.y }
      : { x: LEGACY_X - TRIGGER_OFFSET_X, y: 0 };

  const nodes: FlowNode[] = [createTriggerNode(bot?.trigger ?? null, triggerPosition), ...bubbles];
  const edges: FlowEdge[] = [];
  const link = (source: string, handle: string, targetStepId: string | null | undefined) => {
    const target = targetStepId ? bubbleOfStep.get(targetStepId) : undefined;
    if (!target || target === source) return;
    edges.push(makeEdge(source, handle, target));
  };

  if (startStepId) link(TRIGGER_NODE_ID, HANDLE_NEXT, startStepId);

  // As saídas de cada balão são as do último bloco (o encadeamento interno é a ordem do balão).
  for (const bubble of bubbles) {
    const last = bubble.data.blocks[bubble.data.blocks.length - 1];
    const step = stepById.get(last.id);
    if (!step) continue;
    const index = indexById.get(step.id) ?? -1;
    // Em lista, o passo seguinte é o próximo do array (salvo se o passo já disser outro); no quadro, só o que está ligado.
    const listNext = canvasMode ? null : (steps[index + 1]?.id ?? null);
    const next = canvasMode ? (step.next_step_id ?? null) : (step.next_step_id ?? listNext);
    switch (step.type) {
      case 'send_text':
      case 'wait':
      case 'typing':
      case 'move_stage':
      case 'add_tag':
      case 'webhook':
        link(bubble.id, HANDLE_NEXT, next);
        break;
      case 'send_template':
        link(bubble.id, HANDLE_NEXT, next);
        link(bubble.id, HANDLE_TIMEOUT, step.on_timeout_step_id);
        (step.buttons ?? []).forEach((_, i) => link(bubble.id, buttonHandleId(i), (step.button_step_ids ?? [])[i] ?? null));
        break;
      case 'wait_reply':
        link(bubble.id, HANDLE_NEXT, next);
        link(bubble.id, HANDLE_TIMEOUT, step.on_timeout_step_id);
        break;
      case 'condition': {
        const ruleIds = last.type === 'condition' ? last.data.rules.map((r) => r.id) : [];
        step.rules.forEach((rule, i) => {
          const ruleId = ruleIds[i];
          if (ruleId) link(bubble.id, ruleHandleId(ruleId), rule.goto_step_id);
        });
        link(bubble.id, HANDLE_ELSE, step.else_step_id ?? listNext);
        break;
      }
      default:
        // handoff_agent e end não têm saída.
        break;
    }
  }

  return { nodes, edges };
}

// ---------------------------------------------------------------- Quadro -> robô

/** Mapa "origem__handle" -> balão de destino, só com arestas válidas. */
function edgeTargets(nodes: FlowNode[], edges: FlowEdge[]): Map<string, string> {
  const ids = new Set(nodes.map((n) => n.id));
  const map = new Map<string, string>();
  for (const e of edges) {
    if (!e.sourceHandle || !ids.has(e.source) || !ids.has(e.target) || e.source === e.target) continue;
    map.set(edgeIdFor(e.source, e.sourceHandle), e.target);
  }
  return map;
}

/**
 * Ordem dos balões no array salvo: primeiro os alcançáveis a partir do início
 * (largura), depois os soltos, de cima para baixo. Só afeta `step_index` e os logs.
 */
export function orderBubbles(nodes: FlowNode[], edges: FlowEdge[], startBubbleId: string | null): BubbleNode[] {
  const byId = new Map<string, BubbleNode>();
  for (const n of nodes) if (isBubbleNode(n)) byId.set(n.id, n);
  const outgoing = new Map<string, string[]>();
  for (const e of edges) {
    if (!byId.has(e.source) || !byId.has(e.target)) continue;
    outgoing.set(e.source, [...(outgoing.get(e.source) ?? []), e.target]);
  }
  const visited = new Set<string>();
  const result: BubbleNode[] = [];
  const queue: string[] = startBubbleId && byId.has(startBubbleId) ? [startBubbleId] : [];
  while (queue.length) {
    const id = queue.shift() as string;
    if (visited.has(id)) continue;
    const node = byId.get(id);
    if (!node) continue;
    visited.add(id);
    result.push(node);
    for (const t of outgoing.get(id) ?? []) if (!visited.has(t)) queue.push(t);
  }
  const loose = [...byId.values()]
    .filter((n) => !visited.has(n.id))
    .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);
  return [...result, ...loose];
}

/** Bloco -> passo salvo. `to(handle)` devolve o id do passo ligado àquela saída. */
function blockToStep(block: Block, to: (handle: string) => string | null, ui: { x: number; y: number }): BotStep {
  const id = block.id;
  switch (block.type) {
    case 'send_text':
      return { id, type: 'send_text', text: block.data.text.trim(), next_step_id: to(HANDLE_NEXT), ui };
    case 'send_template':
      return {
        id,
        type: 'send_template',
        template_id: block.data.template_id,
        template_name: block.data.template_name.trim() || undefined,
        template_body: block.data.template_body.trim().slice(0, 2000) || undefined,
        buttons: block.data.buttons.map((b) => b.trim()),
        button_step_ids: block.data.buttons.map((_, i) => to(buttonHandleId(i))),
        timeout_minutes: block.data.timeout_minutes,
        on_timeout_step_id: to(HANDLE_TIMEOUT),
        next_step_id: to(HANDLE_NEXT),
        ui,
      };
    case 'wait':
      return { id, type: 'wait', seconds: waitSeconds(block.data), next_step_id: to(HANDLE_NEXT), ui };
    case 'wait_reply':
      return {
        id,
        type: 'wait_reply',
        timeout_minutes: block.data.timeout_minutes,
        on_timeout_step_id: to(HANDLE_TIMEOUT),
        next_step_id: to(HANDLE_NEXT),
        ui,
      };
    case 'condition':
      return {
        id,
        type: 'condition',
        rules: block.data.rules.map((r) => ({
          kind: 'reply_contains' as const,
          keywords: [],
          match: r.match,
          label: r.label.trim() || undefined,
          clauses: r.clauses.map((c) => ({
            field: c.field,
            key: c.field === 'custom_field' ? c.key.trim() || undefined : undefined,
            op: c.op,
            value: opNeedsValue(c.op) ? c.value.trim() : '',
          })),
          goto_step_id: to(ruleHandleId(r.id)) ?? '',
        })),
        else_step_id: to(HANDLE_ELSE),
        ui,
      };
    case 'move_stage':
      return { id, type: 'move_stage', stage_id: block.data.stage_id, next_step_id: to(HANDLE_NEXT), ui };
    case 'add_tag':
      return { id, type: 'add_tag', tag: block.data.tag.trim(), next_step_id: to(HANDLE_NEXT), ui };
    case 'webhook':
      return {
        id,
        type: 'webhook',
        url: block.data.url.trim(),
        secret: block.data.secret.trim() || null,
        body_template: block.data.body_template.trim() || null,
        next_step_id: to(HANDLE_NEXT),
        ui,
      };
    case 'typing':
      return { id, type: 'typing', seconds: block.data.seconds, next_step_id: to(HANDLE_NEXT), ui };
    case 'start_bot':
      return { id, type: 'start_bot', bot_id: block.data.bot_id, bot_name: block.data.bot_name.trim() || undefined, ui };
    case 'handoff_agent':
      return { id, type: 'handoff_agent', agent_id: block.data.agent_id, ui };
    case 'end':
      return { id, type: 'end', ui };
  }
}

/**
 * Monta o BotInput a partir do quadro e do cabeçalho: passos planos (cada bloco
 * liga ao seguinte do balão; o último liga ao primeiro bloco do balão de
 * destino), `start_step_id` = primeiro bloco do balão ligado ao gatilho e
 * `layout.groups` com o desenho. Balões vazios são ignorados.
 */
export function flowToBot(nodes: FlowNode[], edges: FlowEdge[], header: FlowHeader): BotInput {
  const targets = edgeTargets(nodes, edges);
  const byId = new Map<string, BubbleNode>();
  for (const n of nodes) if (isBubbleNode(n)) byId.set(n.id, n);
  const firstStepOf = (bubbleId: string | null | undefined): string | null => {
    const bubble = bubbleId ? byId.get(bubbleId) : undefined;
    return bubble?.data.blocks[0]?.id ?? null;
  };
  const to = (source: string, handle: string): string | null => firstStepOf(targets.get(edgeIdFor(source, handle)));
  const trigger = nodes.find(isTriggerNode);
  const startBubbleId = targets.get(edgeIdFor(TRIGGER_NODE_ID, HANDLE_NEXT)) ?? null;
  const startId = firstStepOf(startBubbleId);

  const steps: BotStep[] = [];
  const groups: BotLayoutGroup[] = [];
  for (const bubble of orderBubbles(nodes, edges, startBubbleId)) {
    const blocks = bubble.data.blocks;
    if (blocks.length === 0) continue;
    const ui = { x: Math.round(bubble.position.x), y: Math.round(bubble.position.y) };
    blocks.forEach((block, i) => {
      const isLast = i === blocks.length - 1;
      const link = isLast
        ? (handle: string) => to(bubble.id, handle)
        : (handle: string) => (handle === HANDLE_NEXT ? blocks[i + 1].id : null);
      steps.push(blockToStep(block, link, ui));
    });
    groups.push({
      id: bubble.id,
      name: bubble.data.name.trim().slice(0, 80),
      x: ui.x,
      y: ui.y,
      step_ids: blocks.map((b) => b.id),
    });
  }

  const triggerType = trigger?.data.trigger_type ?? 'manual';
  return {
    name: header.name.trim(),
    enabled: header.enabled,
    // connection_id continua gravado (primeiro da lista) para o que ainda lê a coluna antiga
    connection_id: (header.connection_ids ?? [])[0] ?? null,
    connection_ids: header.connection_ids ?? [],
    trigger: {
      type: triggerType,
      board_id: triggerType === 'manual' || triggerType === 'agent_followup' ? null : trigger?.data.board_id || null,
      stage_id: triggerType === 'deal_stage_entered' ? trigger?.data.stage_id || null : null,
      // Número que inicia a conversa quando o gatilho dispara (vazio = primeiro do robô)
      connection_id: trigger?.data.connection_id || null,
      ...(trigger ? { ui: { x: Math.round(trigger.position.x), y: Math.round(trigger.position.y) } } : {}),
    },
    steps,
    start_step_id: startId,
    layout: { groups },
  };
}

// ---------------------------------------------------------------- Copiar / colar / limpeza

/**
 * Cópias dos balões com ids novos (balões, blocos e regras), deslocadas por
 * `offset` e já selecionadas. As ligações ENTRE os balões copiados são
 * preservadas (apontando para as cópias); ligações com o resto do quadro são
 * descartadas. Base do copiar/colar e do duplicar.
 */
export function cloneBubbles(bubbles: BubbleNode[], edges: FlowEdge[], offset: XYPosition): { nodes: BubbleNode[]; edges: FlowEdge[] } {
  const idMap = new Map<string, string>();
  const handleMaps = new Map<string, Map<string, string>>();
  const nodes: BubbleNode[] = bubbles.map((bubble) => {
    const id = newId();
    idMap.set(bubble.id, id);
    const handleMap = new Map<string, string>();
    handleMaps.set(bubble.id, handleMap);
    const blocks = bubble.data.blocks.map((block) => cloneBlock(block, handleMap));
    return {
      ...bubble,
      id,
      position: { x: Math.round(bubble.position.x + offset.x), y: Math.round(bubble.position.y + offset.y) },
      selected: true,
      dragging: false,
      data: { name: bubble.data.name, blocks },
    };
  });
  const clonedEdges: FlowEdge[] = [];
  for (const e of edges) {
    const source = idMap.get(e.source);
    const target = idMap.get(e.target);
    if (!source || !target || !e.sourceHandle) continue;
    const handle = handleMaps.get(e.source)?.get(e.sourceHandle) ?? e.sourceHandle;
    clonedEdges.push(makeEdge(source, handle, target));
  }
  return { nodes, edges: clonedEdges };
}

/** Handles de saída válidos de um balão (só o último bloco tem saídas). */
export function bubbleHandleIds(blocks: Block[]): Set<string> {
  return new Set(bubbleOutputs(blocks).map((o) => o.handleId));
}

/**
 * Tira as arestas que perderam a origem, o destino ou a saída (bloco removido
 * ou movido, regra apagada, balão excluído). Devolve o mesmo array quando nada muda.
 */
export function pruneEdges(nodes: FlowNode[], edges: FlowEdge[]): FlowEdge[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const kept = edges.filter((e) => {
    const source = byId.get(e.source);
    const target = byId.get(e.target);
    if (!source || !target || !isBubbleNode(target) || !e.sourceHandle || e.source === e.target) return false;
    if (isTriggerNode(source)) return e.sourceHandle === HANDLE_NEXT;
    return bubbleHandleIds(source.data.blocks).has(e.sourceHandle);
  });
  return kept.length === edges.length ? edges : kept;
}

// ---------------------------------------------------------------- Validação

export type FlowIssue = { nodeId?: string; blockId?: string; message: string };
export type FlowValidation = { errors: FlowIssue[]; warnings: FlowIssue[] };

/**
 * Confere o quadro antes de salvar (e a cada mudança, para a marcação inline).
 * `errors` impedem o salvamento; `warnings` pedem confirmação (rascunho sem
 * balões, gatilho solto com o robô desligado, balões fora do fluxo).
 * Ligar o robô (enabled) exige o gatilho ligado a um balão.
 */
export function validateFlow(nodes: FlowNode[], edges: FlowEdge[], header: FlowHeader): FlowValidation {
  const errors: FlowIssue[] = [];
  const warnings: FlowIssue[] = [];
  const targets = edgeTargets(nodes, edges);
  const to = (source: string, handle: string): string | null => targets.get(edgeIdFor(source, handle)) ?? null;

  if (!header.name.trim()) errors.push({ message: 'Dê um nome ao robô' });
  const numerosDoRobo = header.connection_ids ?? [];
  if (numerosDoRobo.length === 0) errors.push({ message: 'Escolha em quais números este robô atende' });
  // O número que inicia pelo gatilho precisa ser um dos números do robô
  const gatilho = nodes.find(isTriggerNode);
  const inicia = gatilho?.data.connection_id;
  if (inicia && numerosDoRobo.length > 0 && !numerosDoRobo.includes(inicia)) {
    errors.push({
      nodeId: gatilho?.id,
      message: 'O número que inicia a conversa no gatilho não está entre os números do robô',
    });
  }

  const trigger = nodes.find(isTriggerNode);
  if (trigger && trigger.data.trigger_type === 'deal_stage_entered') {
    if (!trigger.data.board_id) errors.push({ nodeId: trigger.id, message: 'Gatilho: escolha o quadro' });
    else if (!trigger.data.stage_id) {
      errors.push({ nodeId: trigger.id, message: 'Gatilho: escolha a etapa que dispara o robô' });
    }
  }

  const ids = new Set(nodes.map((n) => n.id));
  const broken = edges.find((e) => !ids.has(e.source) || !ids.has(e.target));
  if (broken) {
    errors.push({
      nodeId: ids.has(broken.source) ? broken.source : undefined,
      message: 'Há uma ligação apontando para um balão que não existe',
    });
  }

  const bubbles = nodes.filter(isBubbleNode);
  const startBubbleId = to(TRIGGER_NODE_ID, HANDLE_NEXT);
  const ordered = orderBubbles(nodes, edges, startBubbleId);
  if (!startBubbleId) {
    if (bubbles.length === 0) {
      if (header.enabled) {
        errors.push({
          nodeId: TRIGGER_NODE_ID,
          message: 'O robô está vazio: adicione um balão ligado ao gatilho ou desligue o robô para salvar como rascunho',
        });
      } else {
        warnings.push({ nodeId: TRIGGER_NODE_ID, message: 'O robô ainda não tem balões: fica salvo como rascunho.' });
      }
    } else if (header.enabled) {
      errors.push({
        nodeId: TRIGGER_NODE_ID,
        message: 'Ligue a saída "Então" do gatilho ao primeiro balão (ou desligue o robô para salvar como rascunho)',
      });
    } else {
      warnings.push({
        nodeId: TRIGGER_NODE_ID,
        message: 'O gatilho não está ligado a nenhum balão: o robô não vai fazer nada até isso ser ligado.',
      });
    }
  }

  // Numeração por tipo, na ordem do fluxo ("Mensagem 2"); sem número quando há só um bloco do tipo.
  const totalByType = new Map<string, number>();
  for (const bubble of ordered) {
    for (const block of bubble.data.blocks) totalByType.set(block.type, (totalByType.get(block.type) ?? 0) + 1);
  }
  const seenByType = new Map<string, number>();
  for (const bubble of ordered) {
    const title = bubble.data.name.trim();
    const blocks = bubble.data.blocks;
    if (blocks.length === 0) {
      errors.push({ nodeId: bubble.id, message: `${title || 'Balão'}: está vazio. Adicione um bloco ou exclua o balão` });
      continue;
    }
    blocks.forEach((block, index) => {
      const ordinal = (seenByType.get(block.type) ?? 0) + 1;
      seenByType.set(block.type, ordinal);
      const numbered = (totalByType.get(block.type) ?? 0) > 1 ? `${STEP_LABELS[block.type]} ${ordinal}` : STEP_LABELS[block.type];
      const label = title ? `${title} › ${numbered}` : numbered;
      const isLast = index === blocks.length - 1;
      const fail = (message: string) => errors.push({ nodeId: bubble.id, blockId: block.id, message: `${label}: ${message}` });
      if (!isLast && !isLinearType(block.type)) {
        fail(
          BLOCK_KIND[block.type] === 'terminal'
            ? 'encerra o robô, por isso precisa ser o último bloco do balão'
            : 'tem mais de uma saída, por isso precisa ser o último bloco do balão'
        );
      }
      switch (block.type) {
        case 'send_text':
          if (!block.data.text.trim()) fail('a mensagem está vazia');
          else if (block.data.text.length > 4000) fail('a mensagem passa de 4000 caracteres');
          break;
        case 'send_template':
          if (!block.data.template_id) fail('escolha o modelo de mensagem');
          if (!(block.data.timeout_minutes >= 1) || block.data.timeout_minutes > MAX_REPLY_MINUTES) {
            fail('o prazo de resposta precisa ficar entre 1 e 43200 minutos (30 dias)');
          }
          break;
        case 'wait': {
          const seconds = waitSeconds(block.data);
          if (!(block.data.amount >= 1) || !(seconds >= 1) || seconds > MAX_WAIT_SECONDS) {
            fail('informe um tempo entre 1 segundo e 7 dias');
          }
          break;
        }
        case 'wait_reply': {
          const minutes = block.data.timeout_minutes;
          if (!(minutes >= 1) || minutes > MAX_REPLY_MINUTES) {
            fail('o prazo precisa ficar entre 1 e 43200 minutos (30 dias)');
          }
          break;
        }
        case 'condition':
          if (block.data.rules.length === 0) fail('adicione ao menos uma regra');
          block.data.rules.forEach((rule, i) => {
            let incomplete: string | null = rule.clauses.length === 0 ? `o caminho ${i + 1} está sem condição` : null;
            for (const c of rule.clauses) {
              if (incomplete) break;
              if (c.field === 'custom_field' && !c.key.trim()) incomplete = `o caminho ${i + 1}: informe a chave do campo personalizado`;
              else if (opNeedsValue(c.op) && !c.value.trim()) incomplete = `o caminho ${i + 1}: informe o valor da condição`;
            }
            if (incomplete) fail(incomplete);
            else if (isLast && !to(bubble.id, ruleHandleId(rule.id))) fail(`ligue a regra ${i + 1} a um balão`);
          });
          break;
        case 'move_stage':
          if (!block.data.stage_id) fail('escolha a etapa de destino');
          break;
        case 'add_tag':
          if (!block.data.tag.trim()) fail('informe o rótulo');
          else if (block.data.tag.trim().length > 60) fail('o rótulo passa de 60 caracteres');
          break;
        case 'webhook':
          if (!isHttpUrl(block.data.url.trim())) fail('informe uma URL válida, começando com http:// ou https://');
          break;
        case 'typing':
          if (!(block.data.seconds >= 1) || block.data.seconds > 60) fail('informe de 1 a 60 segundos');
          break;
        case 'start_bot':
          if (!block.data.bot_id) fail('escolha o robô');
          break;
        case 'handoff_agent':
          if (!block.data.agent_id) fail('escolha o agente de IA');
          break;
        default:
          break;
      }
    });
  }

  // Balões que existem no quadro mas não são alcançados a partir do gatilho.
  if (startBubbleId) {
    const reachable = new Set<string>();
    const queue = [startBubbleId];
    while (queue.length) {
      const id = queue.shift() as string;
      if (reachable.has(id)) continue;
      reachable.add(id);
      for (const e of edges) if (e.source === id && !reachable.has(e.target)) queue.push(e.target);
    }
    const loose = ordered.filter((n) => !reachable.has(n.id));
    if (loose.length > 0) {
      warnings.push({
        nodeId: loose[0].id,
        message:
          loose.length === 1
            ? '1 balão não está ligado ao fluxo e nunca será executado.'
            : `${loose.length} balões não estão ligados ao fluxo e nunca serão executados.`,
      });
    }
  }

  return { errors, warnings };
}
