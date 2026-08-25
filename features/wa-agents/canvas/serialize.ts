/**
 * Serialização entre o quadro (nós e arestas do React Flow) e o formato salvo
 * do robô (BotInput: passos com next_step_id / goto_step_id / else_step_id /
 * on_timeout_step_id, posição em `ui` e `start_step_id`).
 *
 * Robôs antigos (sem start_step_id) são convertidos em cadeia: cada passo liga
 * ao seguinte da lista, com layout vertical automático (x fixo, y = índice * 170).
 */
import type { XYPosition } from '@xyflow/react';
import type { BotInput, BotRow, BotStep } from '@/lib/wa-agents/types';
import { newId } from '../ui';
import {
  HANDLE_ELSE,
  HANDLE_IN,
  HANDLE_NEXT,
  HANDLE_TIMEOUT,
  MAX_REPLY_MINUTES,
  MAX_WAIT_SECONDS,
  STEP_LABELS,
  TRIGGER_NODE_ID,
  WAIT_UNIT_SECONDS,
  edgeIdFor,
  isStepType,
  ruleHandleId,
  unitFor,
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
/** O gatilho fica à esquerda do primeiro passo. */
const TRIGGER_OFFSET_X = 360;

/** "sim, quero, pode" -> ['sim', 'quero', 'pode'] (sem repetidos e sem vazios). */
export function parseKeywords(text: string): string[] {
  return Array.from(
    new Set(
      text
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    )
  );
}

export function clampInt(value: number, min: number, max: number): number {
  const n = Math.round(value);
  if (Number.isNaN(n)) return min;
  return Math.max(min, Math.min(max, n));
}

/** Segundos de um passo Esperar a partir do que foi digitado (quantidade + unidade). */
export function waitSeconds(data: WaitData): number {
  return Math.round(data.amount * WAIT_UNIT_SECONDS[data.unit]);
}

export function isTriggerNode(node: FlowNode): node is TriggerNode {
  return node.type === 'trigger';
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Rótulo curto de um nó para mensagens ("Mensagem", "Condição"...). */
export function nodeLabel(node: FlowNode): string {
  if (node.type === 'trigger') return 'Gatilho';
  return node.type && isStepType(node.type) ? STEP_LABELS[node.type] : 'Passo';
}

// ---------------------------------------------------------------- Criação de nós

/** Nó novo com os dados padrão do tipo. */
export function createStepNode(type: StepType, position: XYPosition, id: string = newId()): FlowNode {
  switch (type) {
    case 'send_text':
      return { id, type, position, data: { text: '' } };
    case 'wait':
      return { id, type, position, data: { amount: 1, unit: 'h' } };
    case 'wait_reply':
      return { id, type, position, data: { timeout_minutes: 60 } };
    case 'condition':
      return { id, type, position, data: { rules: [{ id: newId(), keywords: '' }] } };
    case 'move_stage':
      return { id, type, position, data: { stage_id: '' } };
    case 'add_tag':
      return { id, type, position, data: { tag: '' } };
    case 'webhook':
      return { id, type, position, data: { url: '', secret: '', body_template: '' } };
    case 'handoff_agent':
      return { id, type, position, data: { agent_id: '' } };
    case 'end':
      return { id, type, position, data: {} };
  }
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
    },
  };
}

/** Passo salvo -> nó do quadro. */
function stepToNode(step: BotStep, position: XYPosition): FlowNode {
  const id = step.id;
  switch (step.type) {
    case 'send_text':
      return { id, type: 'send_text', position, data: { text: step.text } };
    case 'wait': {
      const unit = unitFor(step.seconds);
      return {
        id,
        type: 'wait',
        position,
        data: { amount: Math.max(1, Math.round(step.seconds / WAIT_UNIT_SECONDS[unit])), unit },
      };
    }
    case 'wait_reply':
      return { id, type: 'wait_reply', position, data: { timeout_minutes: step.timeout_minutes } };
    case 'condition':
      return {
        id,
        type: 'condition',
        position,
        data: { rules: step.rules.map((r) => ({ id: newId(), keywords: r.keywords.join(', ') })) },
      };
    case 'move_stage':
      return { id, type: 'move_stage', position, data: { stage_id: step.stage_id } };
    case 'add_tag':
      return { id, type: 'add_tag', position, data: { tag: step.tag } };
    case 'webhook':
      return {
        id,
        type: 'webhook',
        position,
        data: { url: step.url, secret: step.secret ?? '', body_template: step.body_template ?? '' },
      };
    case 'handoff_agent':
      return { id, type: 'handoff_agent', position, data: { agent_id: step.agent_id } };
    case 'end':
      return { id, type: 'end', position, data: {} };
  }
}

function makeEdge(source: string, sourceHandle: string, target: string): FlowEdge {
  return { id: edgeIdFor(source, sourceHandle), source, sourceHandle, target, targetHandle: HANDLE_IN };
}

// ---------------------------------------------------------------- Robô -> quadro

/**
 * Converte um robô salvo (ou os passos padrão de um robô novo) em nós e arestas.
 * Sem `start_step_id` (robô em lista), a ordem da lista vira a cadeia de ligações.
 */
export function botToFlow(bot: BotRow | null, fallbackSteps: BotStep[]): FlowGraph {
  const steps: BotStep[] = bot ? bot.steps : fallbackSteps;
  const canvasMode = !!bot?.start_step_id;
  const stepIds = new Set(steps.map((s) => s.id));

  const stepNodes: FlowNode[] = steps.map((step, index) =>
    stepToNode(step, step.ui ? { x: step.ui.x, y: step.ui.y } : { x: LEGACY_X, y: index * LEGACY_GAP_Y })
  );

  const startId = canvasMode ? (bot?.start_step_id ?? null) : (steps[0]?.id ?? null);
  const startNode = startId ? stepNodes.find((n) => n.id === startId) : undefined;
  const triggerPosition: XYPosition = startNode
    ? { x: startNode.position.x - TRIGGER_OFFSET_X, y: startNode.position.y }
    : { x: LEGACY_X - TRIGGER_OFFSET_X, y: 0 };

  const nodes: FlowNode[] = [createTriggerNode(bot?.trigger ?? null, triggerPosition), ...stepNodes];
  const edges: FlowEdge[] = [];
  const link = (source: string, handle: string, target: string | null | undefined) => {
    if (!target || target === source || !stepIds.has(target)) return;
    edges.push(makeEdge(source, handle, target));
  };

  if (startId) link(TRIGGER_NODE_ID, HANDLE_NEXT, startId);

  steps.forEach((step, index) => {
    // Em lista, o passo seguinte é o próximo do array; no quadro, só o que está ligado.
    const listNext = canvasMode ? null : (steps[index + 1]?.id ?? null);
    const next = canvasMode ? (step.next_step_id ?? null) : listNext;
    switch (step.type) {
      case 'send_text':
      case 'wait':
      case 'move_stage':
      case 'add_tag':
      case 'webhook':
        link(step.id, HANDLE_NEXT, next);
        break;
      case 'wait_reply':
        link(step.id, HANDLE_NEXT, next);
        link(step.id, HANDLE_TIMEOUT, step.on_timeout_step_id);
        break;
      case 'condition': {
        const node = stepNodes[index];
        const ruleIds = node.type === 'condition' ? node.data.rules.map((r) => r.id) : [];
        step.rules.forEach((rule, i) => {
          const ruleId = ruleIds[i];
          if (ruleId) link(step.id, ruleHandleId(ruleId), rule.goto_step_id);
        });
        link(step.id, HANDLE_ELSE, step.else_step_id ?? listNext);
        break;
      }
      default:
        // handoff_agent e end não têm saída.
        break;
    }
  });

  return { nodes, edges };
}

// ---------------------------------------------------------------- Quadro -> robô

/** Mapa "origem__handle" -> destino, só com arestas válidas. */
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
 * Ordem dos passos no array salvo: primeiro os alcançáveis a partir do início
 * (largura), depois os soltos, de cima para baixo. Só afeta `step_index` e os logs.
 */
export function orderStepNodes(nodes: FlowNode[], edges: FlowEdge[], startId: string | null): FlowNode[] {
  const byId = new Map<string, FlowNode>();
  for (const n of nodes) if (!isTriggerNode(n)) byId.set(n.id, n);
  const outgoing = new Map<string, string[]>();
  for (const e of edges) {
    if (!byId.has(e.source) || !byId.has(e.target)) continue;
    outgoing.set(e.source, [...(outgoing.get(e.source) ?? []), e.target]);
  }
  const visited = new Set<string>();
  const result: FlowNode[] = [];
  const queue: string[] = startId && byId.has(startId) ? [startId] : [];
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

/** Nó do quadro -> passo salvo (null para o gatilho). */
function nodeToStep(node: FlowNode, to: (source: string, handle: string) => string | null): BotStep | null {
  const id = node.id;
  const ui = { x: Math.round(node.position.x), y: Math.round(node.position.y) };
  switch (node.type) {
    case 'send_text':
      return { id, type: 'send_text', text: node.data.text.trim(), next_step_id: to(id, HANDLE_NEXT), ui };
    case 'wait':
      return { id, type: 'wait', seconds: waitSeconds(node.data), next_step_id: to(id, HANDLE_NEXT), ui };
    case 'wait_reply':
      return {
        id,
        type: 'wait_reply',
        timeout_minutes: node.data.timeout_minutes,
        on_timeout_step_id: to(id, HANDLE_TIMEOUT),
        next_step_id: to(id, HANDLE_NEXT),
        ui,
      };
    case 'condition':
      return {
        id,
        type: 'condition',
        rules: node.data.rules.map((r) => ({
          keywords: parseKeywords(r.keywords),
          goto_step_id: to(id, ruleHandleId(r.id)) ?? '',
        })),
        else_step_id: to(id, HANDLE_ELSE),
        ui,
      };
    case 'move_stage':
      return { id, type: 'move_stage', stage_id: node.data.stage_id, next_step_id: to(id, HANDLE_NEXT), ui };
    case 'add_tag':
      return { id, type: 'add_tag', tag: node.data.tag.trim(), next_step_id: to(id, HANDLE_NEXT), ui };
    case 'webhook':
      return {
        id,
        type: 'webhook',
        url: node.data.url.trim(),
        secret: node.data.secret.trim() || null,
        body_template: node.data.body_template.trim() || null,
        next_step_id: to(id, HANDLE_NEXT),
        ui,
      };
    case 'handoff_agent':
      return { id, type: 'handoff_agent', agent_id: node.data.agent_id, ui };
    case 'end':
      return { id, type: 'end', ui };
    default:
      return null;
  }
}

/** Monta o BotInput a partir do quadro e do cabeçalho. */
export function flowToBot(nodes: FlowNode[], edges: FlowEdge[], header: FlowHeader): BotInput {
  const targets = edgeTargets(nodes, edges);
  const to = (source: string, handle: string): string | null => targets.get(edgeIdFor(source, handle)) ?? null;
  const trigger = nodes.find(isTriggerNode);
  const startId = to(TRIGGER_NODE_ID, HANDLE_NEXT);
  const steps: BotStep[] = [];
  for (const node of orderStepNodes(nodes, edges, startId)) {
    const step = nodeToStep(node, to);
    if (step) steps.push(step);
  }
  const triggerType = trigger?.data.trigger_type ?? 'manual';
  return {
    name: header.name.trim(),
    enabled: header.enabled,
    connection_id: header.connection_id || null,
    trigger: {
      type: triggerType,
      board_id: triggerType === 'manual' ? null : trigger?.data.board_id || null,
      stage_id: triggerType === 'deal_stage_entered' ? trigger?.data.stage_id || null : null,
    },
    steps,
    start_step_id: startId,
  };
}

// ---------------------------------------------------------------- Validação

export type FlowIssue = { nodeId?: string; message: string };
export type FlowValidation = { errors: FlowIssue[]; warnings: FlowIssue[] };

/**
 * Confere o quadro antes de salvar. `errors` impedem o salvamento; `warnings`
 * pedem confirmação (gatilho solto, passos fora do fluxo).
 */
export function validateFlow(nodes: FlowNode[], edges: FlowEdge[], header: FlowHeader): FlowValidation {
  const errors: FlowIssue[] = [];
  const warnings: FlowIssue[] = [];
  const targets = edgeTargets(nodes, edges);
  const to = (source: string, handle: string): string | null => targets.get(edgeIdFor(source, handle)) ?? null;

  if (!header.name.trim()) errors.push({ message: 'Dê um nome ao robô' });
  if (!header.connection_id) errors.push({ message: 'Escolha o número que envia as mensagens' });

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
      message: 'Há uma ligação apontando para um passo que não existe',
    });
  }

  const startId = to(TRIGGER_NODE_ID, HANDLE_NEXT);
  const ordered = orderStepNodes(nodes, edges, startId);
  if (!startId) {
    warnings.push({
      nodeId: TRIGGER_NODE_ID,
      message: ordered.length
        ? 'O gatilho não está ligado a nenhum passo: ao disparar, o robô não faz nada.'
        : 'O robô não tem passos.',
    });
  }

  ordered.forEach((node, index) => {
    const label = `${nodeLabel(node)} ${index + 1}`;
    const fail = (message: string) => errors.push({ nodeId: node.id, message: `${label}: ${message}` });
    switch (node.type) {
      case 'send_text':
        if (!node.data.text.trim()) fail('a mensagem está vazia');
        else if (node.data.text.length > 4000) fail('a mensagem passa de 4000 caracteres');
        break;
      case 'wait': {
        const seconds = waitSeconds(node.data);
        if (!(node.data.amount >= 1) || !(seconds >= 1) || seconds > MAX_WAIT_SECONDS) {
          fail('informe um tempo entre 1 minuto e 7 dias');
        }
        break;
      }
      case 'wait_reply': {
        const minutes = node.data.timeout_minutes;
        if (!(minutes >= 1) || minutes > MAX_REPLY_MINUTES) {
          fail('o prazo precisa ficar entre 1 e 43200 minutos (30 dias)');
        }
        break;
      }
      case 'condition':
        if (node.data.rules.length === 0) fail('adicione ao menos uma regra');
        node.data.rules.forEach((rule, i) => {
          if (parseKeywords(rule.keywords).length === 0) fail(`a regra ${i + 1} está sem palavras-chave`);
          else if (!to(node.id, ruleHandleId(rule.id))) fail(`ligue a regra ${i + 1} a um passo`);
        });
        break;
      case 'move_stage':
        if (!node.data.stage_id) fail('escolha a etapa de destino');
        break;
      case 'add_tag':
        if (!node.data.tag.trim()) fail('informe o rótulo');
        else if (node.data.tag.trim().length > 60) fail('o rótulo passa de 60 caracteres');
        break;
      case 'webhook':
        if (!isHttpUrl(node.data.url.trim())) fail('informe uma URL válida, começando com http:// ou https://');
        break;
      case 'handoff_agent':
        if (!node.data.agent_id) fail('escolha o agente de IA');
        break;
      default:
        break;
    }
  });

  // Passos que existem no quadro mas não são alcançados a partir do gatilho.
  if (startId) {
    const reachable = new Set<string>();
    const queue = [startId];
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
            ? '1 passo não está ligado ao fluxo e nunca será executado.'
            : `${loose.length} passos não estão ligados ao fluxo e nunca serão executados.`,
      });
    }
  }

  return { errors, warnings };
}
