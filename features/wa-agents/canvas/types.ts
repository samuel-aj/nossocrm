/**
 * Tipos e constantes do quadro visual do robô (React Flow).
 *
 * Cada passo do robô vira um nó; as ligações entre passos viram arestas.
 * O nó "Gatilho" é fixo (não é um passo) e sua saída define o primeiro passo.
 */
import type { Edge, Node } from '@xyflow/react';
import type { BotInput, BotStep } from '@/lib/wa-agents/types';

export type BotTriggerType = BotInput['trigger']['type'];
export type StepType = BotStep['type'];

/** Rótulos do gatilho (usados também na lista de robôs). */
export const TRIGGER_LABELS: Record<BotTriggerType, string> = {
  deal_created: 'Cadastro no pipeline',
  deal_stage_entered: 'Entrou na etapa',
  manual: 'Manual',
};

/** Rótulos dos tipos de passo. */
export const STEP_LABELS: Record<StepType, string> = {
  send_text: 'Mensagem',
  wait: 'Esperar',
  wait_reply: 'Esperar resposta',
  condition: 'Condição',
  move_stage: 'Mover etapa',
  add_tag: 'Rótulo',
  webhook: 'Webhook',
  handoff_agent: 'Entregar a agente',
  end: 'Encerrar',
};

/** Ordem dos tipos na paleta. */
export const STEP_TYPES: StepType[] = [
  'send_text',
  'wait',
  'wait_reply',
  'condition',
  'move_stage',
  'add_tag',
  'webhook',
  'handoff_agent',
  'end',
];

export function isStepType(value: string): value is StepType {
  return (STEP_TYPES as string[]).includes(value);
}

/** Variáveis aceitas no texto das mensagens do robô. */
export const BOT_VARIABLES: Array<{ key: string; description: string }> = [
  { key: '{{nome}}', description: 'nome completo do contato' },
  { key: '{{primeiro_nome}}', description: 'primeiro nome do contato' },
  { key: '{{telefone}}', description: 'telefone do contato' },
  { key: '{{negocio.titulo}}', description: 'título do negócio' },
  { key: '{{negocio.etapa}}', description: 'etapa atual do negócio' },
];

export type WaitUnit = 'min' | 'h' | 'd';
export const WAIT_UNIT_SECONDS: Record<WaitUnit, number> = { min: 60, h: 3600, d: 86400 };
export const WAIT_UNIT_LABELS: Record<WaitUnit, string> = { min: 'minutos', h: 'horas', d: 'dias' };
export const MAX_WAIT_SECONDS = 604800;
export const MAX_REPLY_MINUTES = 43200;

/** Unidade mais natural para um total de segundos. */
export function unitFor(seconds: number): WaitUnit {
  if (seconds > 0 && seconds % 86400 === 0) return 'd';
  if (seconds > 0 && seconds % 3600 === 0) return 'h';
  return 'min';
}

// ---------------------------------------------------------------- Dados dos nós

export type TriggerData = { trigger_type: BotTriggerType; board_id: string; stage_id: string };
export type MessageData = { text: string };
export type WaitData = { amount: number; unit: WaitUnit };
export type WaitReplyData = { timeout_minutes: number };
/** Regra em edição: as palavras-chave ficam como texto (separadas por vírgula). */
export type ConditionRuleDraft = { id: string; keywords: string };
export type ConditionData = { rules: ConditionRuleDraft[] };
export type MoveStageData = { stage_id: string };
export type TagData = { tag: string };
export type WebhookData = { url: string; secret: string; body_template: string };
export type HandoffData = { agent_id: string };
export type EndData = Record<string, never>;

export type TriggerNode = Node<TriggerData, 'trigger'>;
export type MessageNode = Node<MessageData, 'send_text'>;
export type WaitNode = Node<WaitData, 'wait'>;
export type WaitReplyNode = Node<WaitReplyData, 'wait_reply'>;
export type ConditionNode = Node<ConditionData, 'condition'>;
export type MoveStageNode = Node<MoveStageData, 'move_stage'>;
export type TagNode = Node<TagData, 'add_tag'>;
export type WebhookNode = Node<WebhookData, 'webhook'>;
export type HandoffNode = Node<HandoffData, 'handoff_agent'>;
export type EndNode = Node<EndData, 'end'>;

export type FlowNode =
  | TriggerNode
  | MessageNode
  | WaitNode
  | WaitReplyNode
  | ConditionNode
  | MoveStageNode
  | TagNode
  | WebhookNode
  | HandoffNode
  | EndNode;

export type FlowEdge = Edge;

export type FlowGraph = { nodes: FlowNode[]; edges: FlowEdge[] };

/** Campos do cabeçalho do editor (fora do quadro). */
export type FlowHeader = { name: string; enabled: boolean; connection_id: string };

// ---------------------------------------------------------------- Identificadores

export const TRIGGER_NODE_ID = 'gatilho';
/** Handle de entrada (único por nó). */
export const HANDLE_IN = 'in';
/** Saída padrão ("Então" / "Depois" / "Respondeu"). */
export const HANDLE_NEXT = 'next';
/** Saída "Sem resposta" do passo Esperar resposta. */
export const HANDLE_TIMEOUT = 'timeout';
/** Saída "Senão" da Condição. */
export const HANDLE_ELSE = 'else';
const RULE_HANDLE_PREFIX = 'rule:';

export function ruleHandleId(ruleId: string): string {
  return `${RULE_HANDLE_PREFIX}${ruleId}`;
}

export function ruleIdFromHandle(handleId: string | null | undefined): string | null {
  if (!handleId || !handleId.startsWith(RULE_HANDLE_PREFIX)) return null;
  return handleId.slice(RULE_HANDLE_PREFIX.length);
}

/** Id determinístico da aresta: uma por handle de saída. */
export function edgeIdFor(source: string, sourceHandle: string): string {
  return `${source}__${sourceHandle}`;
}

/** Largura fixa dos nós (px). */
export const NODE_WIDTH = 300;

/** Tipo MIME usado ao arrastar um passo da paleta para o quadro. */
export const DND_MIME = 'application/x-wa-bot-step';
