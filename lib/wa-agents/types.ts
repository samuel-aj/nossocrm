/**
 * Tipos e esquemas compartilhados dos Agentes de IA e Robôs nativos (BETA).
 *
 * CLIENT-SAFE: só zod, tipos e constantes. Nada de Supabase, `ai` ou next/server.
 */
import { z } from 'zod';
import { isPublicHttpUrl } from './url';

export const WA_AGENTS_BETA_FLAG = 'wa_agents_beta';

// ---------------------------------------------------------------------------
// Eventos do agente (webhooks e linha do tempo das execuções)
// ---------------------------------------------------------------------------
export const AGENT_EVENTS = [
  'started',
  'message_received',
  'reply_sent',
  'tool_used',
  'custom_action',
  'finished',
  'handed_off',
  'awaiting_approval',
  'approved',
  'rejected',
  'paused_by_human',
  'resumed',
  'stopped',
  'deal_started',
  'error',
] as const;
export type AgentEvent = (typeof AGENT_EVENTS)[number];

export const AGENT_EVENT_LABELS: Record<AgentEvent, string> = {
  started: 'Atendimento iniciado',
  message_received: 'Mensagem recebida',
  reply_sent: 'Resposta enviada',
  tool_used: 'Ferramenta usada',
  custom_action: 'Ação durante a conversa',
  finished: 'Atendimento encerrado',
  handed_off: 'Passado para outro agente',
  awaiting_approval: 'Aguardando aprovação',
  approved: 'Aprovado',
  rejected: 'Recusado',
  paused_by_human: 'Pausado por atendente',
  resumed: 'Retomado',
  stopped: 'Parado',
  deal_started: 'Iniciado pelo pipeline',
  error: 'Erro',
};

// ---------------------------------------------------------------------------
// Resultados do encerramento e ações da esteira
// ---------------------------------------------------------------------------
/** URL de webhook: http/https para host público (sem localhost, redes privadas ou link-local). */
export const WebhookUrlSchema = z.string().url().refine(isPublicHttpUrl, 'URL precisa ser pública (http/https)');

export const EndActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('handoff'), agent_id: z.string().uuid() }),
  z.object({ type: z.literal('approval'), agent_id: z.string().uuid() }),
  z.object({ type: z.literal('stop') }),
  z.object({ type: z.literal('note'), title: z.string().max(120).optional() }),
  z.object({ type: z.literal('move_stage'), stage_id: z.string().uuid() }),
  z.object({ type: z.literal('add_tag'), tag: z.string().min(1).max(60) }),
  z.object({ type: z.literal('mark_lost'), loss_reason: z.string().max(200).optional() }),
  z.object({ type: z.literal('assign_owner'), owner_id: z.string().uuid() }),
  z.object({
    type: z.literal('create_task'),
    title: z.string().min(1).max(200),
    days: z.number().int().min(0).max(365).optional(),
  }),
  z.object({
    type: z.literal('webhook'),
    url: WebhookUrlSchema,
    secret: z.string().max(200).nullable().optional(),
    body_template: z.string().max(20000).nullable().optional(),
  }),
]);
export type EndAction = z.infer<typeof EndActionSchema>;

export const OutcomeSchema = z.object({
  key: z.string().regex(/^[a-z0-9_-]{1,40}$/),
  label: z.string().min(1).max(80),
  description: z.string().max(500).default(''),
  actions: z.array(EndActionSchema).default([]),
});
export type Outcome = z.infer<typeof OutcomeSchema>;

/** Ação que o agente executa DURANTE a conversa (ferramenta executar_acao). */
export const CustomActionSchema = z.object({
  key: z.string().regex(/^[a-z0-9_-]{1,40}$/),
  label: z.string().min(1).max(80),
  /** Quando acontecer, em linguagem natural (ex.: "o cliente informar que já tem advogado") */
  description: z.string().min(1).max(600),
  actions: z.array(EndActionSchema).default([]),
});
export type CustomAction = z.infer<typeof CustomActionSchema>;

export const AgentWebhookSchema = z.object({
  id: z.string().min(1),
  event: z.enum(AGENT_EVENTS),
  url: WebhookUrlSchema,
  secret: z.string().max(200).optional().nullable(),
  body_template: z.string().max(20000).optional().nullable(),
  active: z.boolean().default(true),
});
export type AgentWebhook = z.infer<typeof AgentWebhookSchema>;

// ---------------------------------------------------------------------------
// Gatilhos do agente
// ---------------------------------------------------------------------------
export const AGENT_INBOUND_MODES = ['any', 'keywords', 'none'] as const;
export type AgentInboundMode = (typeof AGENT_INBOUND_MODES)[number];
export const AGENT_DEAL_EVENTS = ['deal_created', 'deal_stage_entered'] as const;
export type AgentDealEvent = (typeof AGENT_DEAL_EVENTS)[number];

export const AgentTriggersSchema = z.object({
  /** Por mensagem recebida num número vinculado: qualquer, só com palavras-chave ou nunca */
  inbound: z
    .object({
      mode: z.enum(AGENT_INBOUND_MODES).default('any'),
      keywords: z.array(z.string().min(1).max(80)).default([]),
    })
    .default({ mode: 'any', keywords: [] }),
  /** Por cadastro no pipeline: o agente manda a primeira mensagem sozinho */
  deal: z
    .object({
      enabled: z.boolean().default(false),
      event: z.enum(AGENT_DEAL_EVENTS).default('deal_created'),
      board_id: z.string().uuid().nullable().default(null),
      stage_id: z.string().uuid().nullable().default(null),
      /** Número (wa_connections) que inicia a conversa */
      connection_id: z.string().uuid().nullable().default(null),
    })
    .default({ enabled: false, event: 'deal_created', board_id: null, stage_id: null, connection_id: null }),
});
export type AgentTriggers = z.infer<typeof AgentTriggersSchema>;

export const DEFAULT_AGENT_TRIGGERS: AgentTriggers = {
  inbound: { mode: 'any', keywords: [] },
  deal: { enabled: false, event: 'deal_created', board_id: null, stage_id: null, connection_id: null },
};

// ---------------------------------------------------------------------------
// Agente
// ---------------------------------------------------------------------------
export const AI_PROVIDERS = ['openai', 'anthropic', 'google'] as const;
export type AgentProvider = (typeof AI_PROVIDERS)[number];

export const AgentInputSchema = z.object({
  name: z.string().min(1).max(120),
  persona_name: z.string().max(80).nullable().optional(),
  enabled: z.boolean().default(true),
  connection_ids: z.array(z.string().uuid()).default([]),
  provider: z.enum(AI_PROVIDERS),
  model: z.string().min(1).max(120),
  temperature: z.number().min(0).max(2).default(0.5),
  /** undefined = não mexe; '' ou null = limpa */
  api_key: z.string().max(500).nullable().optional(),
  system_prompt: z.string().max(60000).default(''),
  buffer_seconds: z.number().int().min(0).max(60).default(10),
  history_limit: z.number().int().min(5).max(200).default(40),
  line_delay_ms: z.number().int().min(0).max(10000).default(1500),
  human_pause_minutes: z.number().int().min(0).max(1440).default(30),
  only_new_conversations: z.boolean().default(false),
  outcomes: z.array(OutcomeSchema).default([]),
  webhooks: z.array(AgentWebhookSchema).default([]),
  custom_actions: z.array(CustomActionSchema).default([]),
  triggers: AgentTriggersSchema.default(DEFAULT_AGENT_TRIGGERS),
});
export type AgentInput = z.infer<typeof AgentInputSchema>;

export type AgentRow = AgentInput & {
  id: string;
  organization_id: string;
  api_key: string | null;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
};
export type AgentPublic = Omit<AgentRow, 'api_key'> & { has_api_key: boolean };
export type AgentMinimal = { id: string; name: string; persona_name: string | null; enabled: boolean };

/** Versão sem a chave (para a UI): a chave vira só `has_api_key`. */
export function toAgentPublic(row: AgentRow): AgentPublic {
  const { api_key, ...rest } = row;
  return { ...rest, has_api_key: !!(api_key && api_key.trim()) };
}

// ---------------------------------------------------------------------------
// Robôs (mensagens predefinidas, sem IA)
// ---------------------------------------------------------------------------
/** Posição do passo no quadro visual */
export const BotStepUiSchema = z.object({ x: z.number(), y: z.number() });
export type BotStepUi = z.infer<typeof BotStepUiSchema>;

/** Campos comuns a todos os passos: id, próximo passo (modo quadro) e posição no quadro */
const botStepBase = {
  id: z.string().min(1),
  next_step_id: z.string().nullable().optional(),
  ui: BotStepUiSchema.optional(),
};

export const BotStepSchema = z.discriminatedUnion('type', [
  z.object({ ...botStepBase, type: z.literal('send_text'), text: z.string().min(1).max(4000) }),
  z.object({ ...botStepBase, type: z.literal('wait'), seconds: z.number().int().min(1).max(604800) }),
  z.object({
    ...botStepBase,
    type: z.literal('wait_reply'),
    timeout_minutes: z.number().int().min(1).max(43200),
    on_timeout_step_id: z.string().optional().nullable(),
  }),
  z.object({
    ...botStepBase,
    type: z.literal('condition'),
    rules: z
      .array(z.object({ keywords: z.array(z.string().min(1)).min(1), goto_step_id: z.string().min(1) }))
      .min(1),
    else_step_id: z.string().optional().nullable(),
  }),
  z.object({ ...botStepBase, type: z.literal('move_stage'), stage_id: z.string().uuid() }),
  z.object({ ...botStepBase, type: z.literal('add_tag'), tag: z.string().min(1).max(60) }),
  z.object({
    ...botStepBase,
    type: z.literal('webhook'),
    url: WebhookUrlSchema,
    secret: z.string().max(200).nullable().optional(),
    body_template: z.string().max(20000).nullable().optional(),
  }),
  z.object({ ...botStepBase, type: z.literal('handoff_agent'), agent_id: z.string().uuid() }),
  z.object({ ...botStepBase, type: z.literal('end') }),
]);
export type BotStep = z.infer<typeof BotStepSchema>;
export type BotStepType = BotStep['type'];

export const BotTriggerSchema = z.object({
  type: z.enum(['deal_created', 'deal_stage_entered', 'manual']),
  board_id: z.string().uuid().nullable().optional(),
  stage_id: z.string().uuid().nullable().optional(),
  /** Posição do nó Gatilho no quadro (persistida como a dos passos) */
  ui: BotStepUiSchema.optional(),
});
export type BotTrigger = z.infer<typeof BotTriggerSchema>;

export const BotInputSchema = z.object({
  name: z.string().min(1).max(120),
  enabled: z.boolean().default(true),
  connection_id: z.string().uuid().nullable(),
  trigger: BotTriggerSchema,
  steps: z.array(BotStepSchema).default([]),
  /** Modo quadro: id do primeiro passo; ausente = robô em lista (índice + 1) */
  start_step_id: z.string().nullable().optional(),
});
export type BotInput = z.infer<typeof BotInputSchema>;
export type BotRow = BotInput & {
  id: string;
  organization_id: string;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
};

export type BotRunStatus = 'running' | 'waiting_reply' | 'done' | 'error' | 'cancelled';
export type BotRunRow = {
  id: string;
  organization_id: string;
  bot_id: string;
  deal_id: string | null;
  contact_id: string | null;
  conversation_id: string | null;
  phone: string | null;
  step_index: number;
  status: BotRunStatus;
  wake_at: string | null;
  lock_until: string | null;
  vars: Record<string, unknown>;
  log: unknown[];
  error: string | null;
  created_at: string;
  updated_at: string;
};
/** Entrada do `log` de uma execução do robô */
export type BotLogEntry = { at: string; step_id: string | null; type: string; note: string };

// ---------------------------------------------------------------------------
// Estado do agente na conversa
// ---------------------------------------------------------------------------
export type ConversationAiStatus = 'active' | 'paused' | 'stopped' | 'awaiting_approval';

export type ConversationAiInfo = {
  conversationId: string;
  status: ConversationAiStatus;
  /** true = agente nativo (beta); false = externo (n8n via API) */
  native: boolean;
  agent?: { id: string; name: string; persona_name: string | null } | null;
  /** ISO; pausa temporária */
  resumeAt?: string | null;
  approval?: { nextAgentId: string; nextAgentName: string; summary: string; requestedAt: string } | null;
};

export type ConversationAiAction = 'pause' | 'resume' | 'stop' | 'start' | 'approve' | 'reject';

/** Conteúdo de `wa_conversations.ai_approval` */
export type ConversationApproval = {
  nextAgentId: string;
  nextAgentName: string;
  summary: string;
  requestedAt: string;
};

/** Conteúdo de `wa_conversations.ai_state` */
export type ConversationAiState = {
  /** dados salvos pela ferramenta salvar_dados */
  dados?: Record<string, unknown>;
  /** passagem de bastão vinda de outro agente */
  handoff?: { from_agent_id: string; from_agent_name: string; summary: string; at: string } | null;
  /** 'pipeline' quando o agente iniciou a conversa a partir do cadastro no CRM (só prioriza esse negócio no contexto) */
  origem?: string | null;
  /** negócio que originou o início pelo pipeline */
  deal_id?: string | null;
};

// ---------------------------------------------------------------------------
// Inícios pelo pipeline (fila wa_ai_agent_deal_starts)
// ---------------------------------------------------------------------------
export type DealStartStatus = 'pending' | 'processing' | 'done' | 'error' | 'cancelled';
export type DealStartRow = {
  id: string;
  organization_id: string;
  agent_id: string;
  deal_id: string | null;
  contact_id: string | null;
  status: DealStartStatus;
  error: string | null;
  created_at: string;
  processed_at: string | null;
};

// ---------------------------------------------------------------------------
// Execuções dos agentes
// ---------------------------------------------------------------------------
export type RunTrigger = 'inbound' | 'resume' | 'manual_start' | 'handoff' | 'approval' | 'bot' | 'test' | 'deal';
export type RunStatus = 'ok' | 'skipped' | 'error';

/** Evento registrado em `wa_ai_agent_runs.events` */
export type AgentRunEvent = { type: string; at: string; [key: string]: unknown };

export type RunRow = {
  id: string;
  organization_id: string;
  agent_id: string | null;
  conversation_id: string | null;
  trigger: RunTrigger;
  status: RunStatus;
  reason: string | null;
  input_text: string | null;
  output_text: string | null;
  tool_calls: unknown[];
  events: unknown[];
  usage: unknown;
  model: string | null;
  duration_ms: number | null;
  error: string | null;
  created_at: string;
};

// ---------------------------------------------------------------------------
// IA na configuração (POST /api/wa-agents/assist)
// ---------------------------------------------------------------------------
export const ASSIST_MODES = ['generate', 'improve', 'adjust'] as const;
export type AssistMode = (typeof ASSIST_MODES)[number];

export const AssistInputSchema = z.object({
  mode: z.enum(ASSIST_MODES),
  /** generate: descrição do atendimento */
  description: z.string().max(8000).optional(),
  /** improve/adjust: roteiro atual */
  current_prompt: z.string().max(60000).optional(),
  /** adjust: o que mudar */
  instruction: z.string().max(4000).optional(),
  provider: z.enum(AI_PROVIDERS).optional(),
  model: z.string().max(120).optional(),
});
export type AssistInput = z.infer<typeof AssistInputSchema>;

/** Resultado ou ação sugerida pela IA (com `actions` vazio, pronto para o editor) */
export type AssistSuggestion = { key: string; label: string; description: string; actions: EndAction[] };
export type AssistResult = {
  persona_name: string;
  system_prompt: string;
  outcomes: AssistSuggestion[];
  custom_actions: AssistSuggestion[];
};
