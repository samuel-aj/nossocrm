/**
 * Automação nativa da etapa do board ("dispara ao entrar").
 *
 * Por baixo, cada automação é executada pelo motor de robôs já existente
 * (wa_bots: gatilho "entrou na etapa" + passos), mas para quem usa ela é uma
 * automação da etapa: nasce ligada, é editada/excluída no próprio board e NÃO
 * aparece na lista de Robôs. A marca é um balão de layout com id fixo (a
 * coluna `layout` é só desenho, então não muda nada no backend).
 *
 * Passos gerados, nesta ordem: [condição?] → [espera?] → ação.
 */
import type { BotConditionClause, BotInput, BotRow, BotStep } from '@/lib/wa-agents/types';
import type { VariableGroup } from '@/lib/wa-agents/catalog';
import type { Board, BoardStage } from '@/types';

export const STAGE_AUTOMATION_GROUP_ID = 'board-stage-automation';

export type StageActionKind = 'send_text' | 'add_tag' | 'move_stage' | 'handoff_agent' | 'webhook' | 'start_bot';
export const STAGE_ACTION_KINDS: StageActionKind[] = ['send_text', 'add_tag', 'move_stage', 'handoff_agent', 'webhook', 'start_bot'];

export const STAGE_ACTION_LABEL: Record<StageActionKind, string> = {
  send_text: 'Enviar mensagem no WhatsApp',
  add_tag: 'Adicionar tag',
  move_stage: 'Mover de etapa',
  handoff_agent: 'Entregar a um agente de IA',
  webhook: 'Webhook',
  start_bot: 'Iniciar robô',
};

/** Ações que falam com o lead: precisam de um número do WhatsApp (o motor abre a conversa). */
export const ACTION_NEEDS_CONVERSATION = new Set<StageActionKind>(['send_text', 'handoff_agent', 'start_bot']);

export type StageEntry = 'any' | 'created' | 'moved';
export const STAGE_ENTRY_LABEL: Record<StageEntry, string> = {
  any: 'Qualquer entrada',
  created: 'Criado na etapa',
  moved: 'Movido para etapa',
};

export type DelayUnit = 'minutes' | 'hours' | 'days';
export type StageDelay = { amount: number; unit: DelayUnit };
const UNIT_SECONDS: Record<DelayUnit, number> = { minutes: 60, hours: 3600, days: 86400 };
/** Limite do passo "esperar" do motor (30 dias) */
export const MAX_DELAY_SECONDS = 30 * 86400;

export function delayToSeconds(delay: StageDelay): number {
  return Math.max(60, Math.min(MAX_DELAY_SECONDS, Math.round(delay.amount * UNIT_SECONDS[delay.unit])));
}

export function secondsToDelay(seconds: number): StageDelay {
  if (seconds % 86400 === 0) return { amount: seconds / 86400, unit: 'days' };
  if (seconds % 3600 === 0) return { amount: seconds / 3600, unit: 'hours' };
  return { amount: Math.max(1, Math.round(seconds / 60)), unit: 'minutes' };
}

export function formatDelay(delay: StageDelay | null): string {
  if (!delay) return 'Imediatamente';
  const n = delay.amount;
  const unit = delay.unit === 'minutes' ? 'min' : delay.unit === 'hours' ? (n === 1 ? 'hora' : 'horas') : n === 1 ? 'dia' : 'dias';
  return `Após ${n} ${unit}`;
}

export type StageConditions = { match: 'all' | 'any'; clauses: BotConditionClause[] };

export function isStageActionKind(type: string): type is StageActionKind {
  return (STAGE_ACTION_KINDS as string[]).includes(type);
}

export function isStageAutomationBot(bot: Pick<BotRow, 'layout'>): boolean {
  return (bot.layout?.groups ?? []).some((g) => g.id === STAGE_AUTOMATION_GROUP_ID);
}

export type StageActionStep = Extract<BotStep, { type: StageActionKind }>;

/** O passo que representa a ação (o único de ação que a automação da etapa tem). */
export function stageActionStep(bot: Pick<BotRow, 'steps'>): StageActionStep | null {
  for (const step of bot.steps ?? []) {
    if (isStageActionKind(step.type)) return step as StageActionStep;
  }
  return null;
}

export type StageActionDraft = {
  kind: StageActionKind;
  // Ação
  text: string;
  tag: string;
  /** Mover de etapa: pipeline de destino (vazio = o próprio board) e etapa */
  boardId: string;
  stageId: string;
  agentId: string;
  url: string;
  secret: string;
  bodyTemplate: string;
  botId: string;
  botName: string;
  /** Número do WhatsApp que abre a conversa (só para ações que falam com o lead) */
  connectionId: string;
  // Quando / momento / condições
  entry: StageEntry;
  delay: StageDelay | null;
  conditions: StageConditions;
};

export function emptyDraft(kind: StageActionKind, stageLabel: string): StageActionDraft {
  return {
    kind,
    text: `Olá {{contato.nome}}! Vi que você chegou em ${stageLabel}. Posso ajudar?`,
    tag: '',
    boardId: '',
    stageId: '',
    agentId: '',
    url: '',
    secret: '',
    bodyTemplate: '',
    botId: '',
    botName: '',
    connectionId: '',
    entry: 'any',
    delay: null,
    conditions: { match: 'all', clauses: [] },
  };
}

export function buildStageActionStep(draft: StageActionDraft, id: string, currentBoardId: string): BotStep {
  switch (draft.kind) {
    case 'send_text':
      return { id, type: 'send_text', text: draft.text.trim() };
    case 'add_tag':
      return { id, type: 'add_tag', tag: draft.tag.trim() };
    case 'move_stage':
      return { id, type: 'move_stage', stage_id: draft.stageId, board_id: draft.boardId || currentBoardId };
    case 'handoff_agent':
      return { id, type: 'handoff_agent', agent_id: draft.agentId };
    case 'webhook':
      return { id, type: 'webhook', url: draft.url.trim(), secret: draft.secret.trim() || null, body_template: draft.bodyTemplate.trim() || null };
    case 'start_bot':
      return { id, type: 'start_bot', bot_id: draft.botId, bot_name: draft.botName || undefined };
  }
}

/** Entrada completa do robô que executa a automação (criação ou edição). */
export function buildStageActionBot(
  board: Board,
  stage: BoardStage,
  draft: StageActionDraft,
  opts: { enabled: boolean; existing?: BotRow | null }
): BotInput {
  const prev = opts.existing;
  const prevAction = prev ? stageActionStep(prev) : null;
  const prevWait = prev?.steps.find((s) => s.type === 'wait');
  const prevCond = prev?.steps.find((s) => s.type === 'condition');
  const actionId = prevAction?.id ?? crypto.randomUUID();
  const waitId = prevWait?.id ?? crypto.randomUUID();
  const condId = prevCond?.id ?? crypto.randomUUID();

  const action = buildStageActionStep(draft, actionId, board.id);
  const steps: BotStep[] = [];
  const clauses = draft.conditions.clauses.filter((c) => c.field && c.op);
  if (clauses.length > 0) {
    steps.push({
      id: condId,
      type: 'condition',
      rules: [
        {
          match: draft.conditions.match,
          label: 'Condições',
          clauses: clauses.map((c) => ({ field: c.field, key: c.key || undefined, op: c.op, value: c.value ?? '' })),
          kind: 'reply_contains',
          keywords: [],
          goto_step_id: draft.delay ? waitId : actionId,
        },
      ],
      else_step_id: null,
    });
  }
  if (draft.delay) {
    steps.push({ id: waitId, type: 'wait', seconds: delayToSeconds(draft.delay), next_step_id: actionId });
  }
  steps.push(action);

  const needsConversation = ACTION_NEEDS_CONVERSATION.has(draft.kind);
  const connectionId = draft.connectionId || null;
  return {
    name: `${stage.label} · ${STAGE_ACTION_LABEL[draft.kind]}`,
    enabled: opts.enabled,
    connection_id: connectionId,
    connection_ids: connectionId ? [connectionId] : [],
    trigger: {
      type: 'deal_stage_entered',
      board_id: board.id,
      stage_id: stage.id,
      connection_id: needsConversation ? connectionId : null,
      entry: draft.entry,
    },
    steps,
    start_step_id: steps[0].id,
    // Marca da automação da etapa (balão vazio: os passos são encadeados por next_step_id)
    layout: { groups: [{ id: STAGE_AUTOMATION_GROUP_ID, name: 'Automação da etapa', x: 0, y: 0, step_ids: [] }] },
  };
}

/** Rascunho a partir de uma automação existente (edição). */
export function draftFromBot(bot: BotRow, stageLabel: string): StageActionDraft | null {
  const step = stageActionStep(bot);
  if (!step) return null;
  const d = emptyDraft(step.type, stageLabel);
  d.connectionId = bot.trigger?.connection_id ?? bot.connection_ids?.[0] ?? bot.connection_id ?? '';
  d.entry = (bot.trigger?.entry as StageEntry | undefined) ?? 'any';
  const wait = bot.steps.find((s) => s.type === 'wait');
  if (wait && wait.type === 'wait') d.delay = secondsToDelay(wait.seconds);
  const cond = bot.steps.find((s) => s.type === 'condition');
  if (cond && cond.type === 'condition' && cond.rules[0]) {
    d.conditions = {
      match: cond.rules[0].match ?? 'all',
      clauses: (cond.rules[0].clauses ?? []).map((c) => ({ field: c.field, key: c.key, op: c.op, value: c.value ?? '' })),
    };
  }
  switch (step.type) {
    case 'send_text':
      d.text = step.text;
      break;
    case 'add_tag':
      d.tag = step.tag;
      break;
    case 'move_stage':
      d.stageId = step.stage_id;
      d.boardId = step.board_id ?? '';
      break;
    case 'handoff_agent':
      d.agentId = step.agent_id;
      break;
    case 'webhook':
      d.url = step.url;
      d.secret = step.secret && step.secret !== '••••••••' ? step.secret : '';
      d.bodyTemplate = step.body_template ?? '';
      break;
    case 'start_bot':
      d.botId = step.bot_id;
      d.botName = step.bot_name ?? '';
      break;
  }
  return d;
}

export type StageActionContext = {
  boards: Array<{ id: string; name: string; stages: Array<{ id: string; label: string }> }>;
  agents: Array<{ id: string; name: string }>;
  bots: Array<{ id: string; name: string }>;
};

/** Detalhe curto da ação para o card da coluna. */
export function describeStageAction(step: StageActionStep, ctx: StageActionContext): string {
  switch (step.type) {
    case 'send_text': {
      const t = step.text.replace(/\s+/g, ' ').trim();
      return t.length > 70 ? `${t.slice(0, 70)}…` : t;
    }
    case 'add_tag':
      return `Tag: ${step.tag}`;
    case 'move_stage': {
      const board = step.board_id ? ctx.boards.find((b) => b.id === step.board_id) : null;
      const stage = (board ? board.stages : ctx.boards.flatMap((b) => b.stages)).find((s) => s.id === step.stage_id);
      return `Para: ${board ? `${board.name} / ` : ''}${stage?.label ?? 'etapa removida'}`;
    }
    case 'handoff_agent':
      return `Agente: ${ctx.agents.find((a) => a.id === step.agent_id)?.name ?? 'agente removido'}`;
    case 'webhook': {
      try {
        return new URL(step.url).host;
      } catch {
        return step.url;
      }
    }
    case 'start_bot':
      return `Robô: ${ctx.bots.find((b) => b.id === step.bot_id)?.name ?? step.bot_name ?? 'robô removido'}`;
  }
}

/** Rótulos dos campos das condições, do jeito que aparecem no board. */
export const CONDITION_FIELD_LABELS_BOARD: Record<string, string> = {
  deal_source: 'Origem',
  tags: 'Tag',
  deal_value: 'Valor',
  deal_title: 'Nome do lead',
  contact_name: 'Nome do contato',
  contact_phone: 'Telefone',
  custom_field: 'Campo personalizado',
};

const OP_SHORT: Record<string, string> = {
  contains: 'contém',
  not_contains: 'não contém',
  equals: '=',
  not_equals: '≠',
  starts_with: 'começa com',
  ends_with: 'termina com',
  is_empty: 'vazio',
  not_empty: 'preenchido',
  gt: '>',
  lt: '<',
};

export function describeClause(c: BotConditionClause, customLabels: Record<string, string> = {}): string {
  const field = c.field === 'custom_field' ? customLabels[c.key ?? ''] ?? c.key ?? 'Campo' : CONDITION_FIELD_LABELS_BOARD[c.field] ?? c.field;
  const op = OP_SHORT[c.op] ?? c.op;
  const needsValue = c.op !== 'is_empty' && c.op !== 'not_empty';
  return needsValue ? `${field} ${op} ${c.value}` : `${field} ${op}`;
}

/** Linha de resumo do card: "Após 30 min · Movido para etapa" + condições. */
export function summarizeStageAutomation(bot: BotRow, customLabels: Record<string, string> = {}): { when: string; conditions: string | null } {
  const wait = bot.steps.find((s) => s.type === 'wait');
  const delay = wait && wait.type === 'wait' ? secondsToDelay(wait.seconds) : null;
  const entry = (bot.trigger?.entry as StageEntry | undefined) ?? 'any';
  const cond = bot.steps.find((s) => s.type === 'condition');
  let conditions: string | null = null;
  if (cond && cond.type === 'condition' && cond.rules[0]?.clauses?.length) {
    const clauses = cond.rules[0].clauses;
    const first = describeClause(clauses[0], customLabels);
    conditions = clauses.length > 1 ? `${first} ${cond.rules[0].match === 'any' ? 'ou' : 'e'} +${clauses.length - 1}` : first;
  }
  return { when: `${formatDelay(delay)} · ${STAGE_ENTRY_LABEL[entry]}`, conditions };
}

/**
 * Variáveis do corpo personalizado do webhook da etapa: caminhos do payload
 * que o motor de robôs envia (contact, deal, conversation).
 */
export const STAGE_WEBHOOK_VARIABLE_GROUPS: VariableGroup[] = [
  {
    label: 'Contato',
    vars: [
      { key: '{{contact.name}}', description: 'Nome' },
      { key: '{{contact.phone}}', description: 'Telefone' },
      { key: '{{contact.email}}', description: 'E-mail' },
      { key: '{{contact.id}}', description: 'ID do contato' },
    ],
  },
  {
    label: 'Lead',
    vars: [
      { key: '{{deal.id}}', description: 'ID do lead' },
      { key: '{{deal.title}}', description: 'Nome (título) do lead' },
      { key: '{{deal.stage_label}}', description: 'Etapa' },
      { key: '{{deal.board_name}}', description: 'Pipeline' },
      { key: '{{deal.owner_name}}', description: 'Responsável' },
      { key: '{{deal.value}}', description: 'Valor' },
      { key: '{{deal.source}}', description: 'Origem' },
      { key: '{{deal.tags}}', description: 'Tags' },
      { key: '{{deal.description}}', description: 'Descrição' },
      { key: '{{deal.created_at}}', description: 'Criado em' },
      { key: '{{deal.custom_fields.chave}}', description: 'Campo personalizado (troque "chave" pela chave do campo)' },
    ],
  },
  {
    label: 'Atendimento',
    vars: [
      { key: '{{conversation.id}}', description: 'ID da conversa no WhatsApp (se houver)' },
      { key: '{{conversation.phone}}', description: 'Número do contato' },
      { key: '{{organization_id}}', description: 'ID da organização' },
      { key: '{{occurred_at}}', description: 'Data e hora do disparo' },
    ],
  },
];
