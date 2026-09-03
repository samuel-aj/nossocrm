/**
 * Automação nativa da etapa do board ("dispara ao entrar").
 *
 * Por baixo, cada ação é executada pelo motor de robôs já existente (wa_bots:
 * gatilho "entrou na etapa" + um passo), mas para quem usa ela é uma automação
 * da etapa: nasce ligada, é editada/excluída no próprio board e NÃO aparece na
 * lista de Robôs. A marca é um balão de layout com id fixo (a coluna `layout`
 * é só desenho, então não muda nada no backend).
 */
import type { BotInput, BotRow, BotStep } from '@/lib/wa-agents/types';
import type { Board, BoardStage } from '@/types';

export const STAGE_AUTOMATION_GROUP_ID = 'board-stage-automation';

export type StageActionKind = 'send_text' | 'add_tag' | 'move_stage' | 'handoff_agent';
export const STAGE_ACTION_KINDS: StageActionKind[] = ['send_text', 'add_tag', 'move_stage', 'handoff_agent'];

export const STAGE_ACTION_LABEL: Record<StageActionKind, string> = {
  send_text: 'Enviar mensagem no WhatsApp',
  add_tag: 'Adicionar tag',
  move_stage: 'Mover de etapa',
  handoff_agent: 'Entregar a um agente de IA',
};

export function isStageActionKind(type: string): type is StageActionKind {
  return (STAGE_ACTION_KINDS as string[]).includes(type);
}

export function isStageAutomationBot(bot: Pick<BotRow, 'layout'>): boolean {
  return (bot.layout?.groups ?? []).some((g) => g.id === STAGE_AUTOMATION_GROUP_ID);
}

/** O passo que representa a ação (o único que a automação da etapa tem). */
export function stageActionStep(bot: Pick<BotRow, 'steps'>): Extract<BotStep, { type: StageActionKind }> | null {
  for (const step of bot.steps ?? []) {
    if (isStageActionKind(step.type)) return step as Extract<BotStep, { type: StageActionKind }>;
  }
  return null;
}

export type StageActionDraft = {
  kind: StageActionKind;
  text: string;
  tag: string;
  stageId: string;
  agentId: string;
  /** Número do WhatsApp que executa (o motor abre a conversa do lead por ele) */
  connectionId: string;
};

export function buildStageActionStep(draft: StageActionDraft, id: string): BotStep {
  switch (draft.kind) {
    case 'send_text':
      return { id, type: 'send_text', text: draft.text.trim() };
    case 'add_tag':
      return { id, type: 'add_tag', tag: draft.tag.trim() };
    case 'move_stage':
      return { id, type: 'move_stage', stage_id: draft.stageId };
    case 'handoff_agent':
      return { id, type: 'handoff_agent', agent_id: draft.agentId };
  }
}

/** Entrada completa do robô que executa a ação da etapa (criação ou edição). */
export function buildStageActionBot(board: Board, stage: BoardStage, draft: StageActionDraft, opts: { enabled: boolean; stepId?: string }): BotInput {
  const stepId = opts.stepId ?? crypto.randomUUID();
  const step = buildStageActionStep(draft, stepId);
  return {
    name: `${stage.label} · ${STAGE_ACTION_LABEL[draft.kind]}`,
    enabled: opts.enabled,
    connection_id: draft.connectionId || null,
    connection_ids: draft.connectionId ? [draft.connectionId] : [],
    trigger: { type: 'deal_stage_entered', board_id: board.id, stage_id: stage.id, connection_id: draft.connectionId || null },
    steps: [step],
    start_step_id: stepId,
    layout: { groups: [{ id: STAGE_AUTOMATION_GROUP_ID, name: 'Automação da etapa', x: 0, y: 0, step_ids: [stepId] }] },
  };
}

/** Rascunho a partir de uma automação existente (edição). */
export function draftFromBot(bot: BotRow): StageActionDraft | null {
  const step = stageActionStep(bot);
  if (!step) return null;
  const connectionId = bot.trigger?.connection_id ?? bot.connection_ids?.[0] ?? bot.connection_id ?? '';
  return {
    kind: step.type,
    text: step.type === 'send_text' ? step.text : '',
    tag: step.type === 'add_tag' ? step.tag : '',
    stageId: step.type === 'move_stage' ? step.stage_id : '',
    agentId: step.type === 'handoff_agent' ? step.agent_id : '',
    connectionId: connectionId ?? '',
  };
}

/** Resumo curto da ação para o chip da coluna. */
export function describeStageAction(
  step: Extract<BotStep, { type: StageActionKind }>,
  ctx: { stages: BoardStage[]; agents: Array<{ id: string; name: string }> }
): string {
  switch (step.type) {
    case 'send_text': {
      const t = step.text.replace(/\s+/g, ' ').trim();
      return t.length > 70 ? `${t.slice(0, 70)}…` : t;
    }
    case 'add_tag':
      return `Tag: ${step.tag}`;
    case 'move_stage':
      return `Para: ${ctx.stages.find((s) => s.id === step.stage_id)?.label ?? 'etapa removida'}`;
    case 'handoff_agent':
      return `Agente: ${ctx.agents.find((a) => a.id === step.agent_id)?.name ?? 'agente removido'}`;
  }
}
