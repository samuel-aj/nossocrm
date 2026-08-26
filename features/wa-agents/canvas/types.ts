/**
 * Tipos e constantes do quadro visual do robô (React Flow).
 *
 * O quadro tem dois tipos de nó: o Gatilho (fixo, não é um passo) e o Balão,
 * que empilha vários blocos (cada bloco é um passo do robô, estilo Typebot).
 * As ligações (arestas) saem das saídas do ÚLTIMO bloco de um balão e entram
 * na entrada de outro balão.
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

/** Rótulos dos tipos de bloco. */
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

/**
 * Como o bloco se comporta dentro do balão:
 * - linear: uma saída ("Depois"); pode ficar em qualquer posição;
 * - branch: mais de uma saída (Esperar resposta, Condição); só pode ser o último;
 * - terminal: sem saída (Entregar a agente, Encerrar); só pode ser o último.
 */
export type BlockKind = 'linear' | 'branch' | 'terminal';

export const BLOCK_KIND: Record<StepType, BlockKind> = {
  send_text: 'linear',
  wait: 'linear',
  wait_reply: 'branch',
  condition: 'branch',
  move_stage: 'linear',
  add_tag: 'linear',
  webhook: 'linear',
  handoff_agent: 'terminal',
  end: 'terminal',
};

export function isLinearType(type: StepType): boolean {
  return BLOCK_KIND[type] === 'linear';
}

/** true quando a ordem é válida: só o último bloco pode ter várias saídas ou ser terminal. */
export function isValidBlockOrder(types: StepType[]): boolean {
  return types.slice(0, -1).every(isLinearType);
}

/**
 * Motivo (pt-BR) de um bloco do tipo `type` não poder entrar na posição
 * `index` da lista `types`, ou null quando pode. Usado pela UI (botão
 * desabilitado com o porquê) e pelo editor (arrastar e soltar).
 */
export function placementProblem(types: StepType[], type: StepType, index: number): string | null {
  const at = Math.max(0, Math.min(types.length, index));
  const next = [...types.slice(0, at), type, ...types.slice(at)];
  if (isValidBlockOrder(next)) return null;
  const last = types[types.length - 1];
  if (at === types.length && last && !isLinearType(last)) {
    return BLOCK_KIND[last] === 'terminal'
      ? `Nada pode vir depois de "${STEP_LABELS[last]}". Crie outro balão.`
      : `"${STEP_LABELS[last]}" tem mais de uma saída, por isso é o último bloco. Ligue as saídas a outro balão.`;
  }
  if (!isLinearType(type)) {
    return BLOCK_KIND[type] === 'terminal'
      ? `"${STEP_LABELS[type]}" encerra o robô, por isso só pode ser o último bloco do balão.`
      : `"${STEP_LABELS[type]}" tem mais de uma saída, por isso só pode ser o último bloco do balão.`;
  }
  return 'Só o último bloco do balão pode ter várias saídas ou encerrar o robô.';
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

// ---------------------------------------------------------------- Dados dos blocos

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

/** Um bloco dentro do balão (= um passo do robô). O id do bloco é o id do passo. */
export type Block =
  | { id: string; type: 'send_text'; data: MessageData }
  | { id: string; type: 'wait'; data: WaitData }
  | { id: string; type: 'wait_reply'; data: WaitReplyData }
  | { id: string; type: 'condition'; data: ConditionData }
  | { id: string; type: 'move_stage'; data: MoveStageData }
  | { id: string; type: 'add_tag'; data: TagData }
  | { id: string; type: 'webhook'; data: WebhookData }
  | { id: string; type: 'handoff_agent'; data: HandoffData }
  | { id: string; type: 'end'; data: EndData };

export type BlockOfType<T extends StepType> = Extract<Block, { type: T }>;

/** Dados do nó Balão: nome (editável) e blocos empilhados, na ordem de execução. */
export type BubbleData = { name: string; blocks: Block[] };

export type TriggerNode = Node<TriggerData, 'trigger'>;
export type BubbleNode = Node<BubbleData, 'bubble'>;

export type FlowNode = TriggerNode | BubbleNode;

export type FlowEdge = Edge;

export type FlowGraph = { nodes: FlowNode[]; edges: FlowEdge[] };

/** Campos do cabeçalho do editor (fora do quadro). */
export type FlowHeader = { name: string; enabled: boolean; connection_id: string };

/** Bloco apontado no quadro (painel de propriedades). */
export type BlockRef = { bubbleId: string; blockId: string };

// ---------------------------------------------------------------- Identificadores

export const TRIGGER_NODE_ID = 'gatilho';
/** Handle de entrada (único por balão). */
export const HANDLE_IN = 'in';
/** Saída padrão ("Então" / "Depois" / "Respondeu"). */
export const HANDLE_NEXT = 'next';
/** Saída "Sem resposta" do bloco Esperar resposta. */
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

// ---------------------------------------------------------------- Saídas do balão

export type OutputTone = 'slate' | 'green' | 'amber';
/** Uma saída do balão: handle do último bloco, com rótulo. */
export type BubbleOutput = { handleId: string; label: string; tone: OutputTone };

const RULE_PREVIEW_LENGTH = 22;

/** Saídas de um bloco (vazio para os terminais). */
export function blockOutputs(block: Block): BubbleOutput[] {
  switch (block.type) {
    case 'send_text':
    case 'wait':
    case 'move_stage':
    case 'add_tag':
    case 'webhook':
      return [{ handleId: HANDLE_NEXT, label: 'Depois', tone: 'slate' }];
    case 'wait_reply':
      return [
        { handleId: HANDLE_NEXT, label: 'Respondeu', tone: 'green' },
        { handleId: HANDLE_TIMEOUT, label: 'Sem resposta', tone: 'amber' },
      ];
    case 'condition':
      return [
        ...block.data.rules.map((rule, i) => {
          const preview = rule.keywords.trim();
          const short = preview.length > RULE_PREVIEW_LENGTH ? `${preview.slice(0, RULE_PREVIEW_LENGTH)}...` : preview;
          return {
            handleId: ruleHandleId(rule.id),
            label: short ? `Regra ${i + 1}: ${short}` : `Regra ${i + 1}`,
            tone: 'slate' as const,
          };
        }),
        { handleId: HANDLE_ELSE, label: 'Senão', tone: 'amber' },
      ];
    case 'handoff_agent':
    case 'end':
      return [];
  }
}

/** Saídas do balão = saídas do último bloco (nenhuma num balão vazio). */
export function bubbleOutputs(blocks: Block[]): BubbleOutput[] {
  const last = blocks[blocks.length - 1];
  return last ? blockOutputs(last) : [];
}

/** Largura fixa dos nós (px). */
export const NODE_WIDTH = 300;

/** Tipo MIME usado ao arrastar um bloco da paleta para o quadro ou para um balão. */
export const DND_MIME = 'application/x-wa-bot-step';
/** Tipo MIME usado ao arrastar um bloco já existente (reordenar ou mover para outro balão). */
export const DND_BLOCK_MIME = 'application/x-wa-bot-block';
/** Deslocamento ao colar ou duplicar balões (px). */
export const PASTE_OFFSET = 40;
