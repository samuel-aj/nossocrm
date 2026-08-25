/**
 * Tipos e esquemas compartilhados dos Agentes de IA e Robôs nativos (BETA).
 *
 * CLIENT-SAFE: só zod, tipos e constantes. Nada de Supabase, `ai` ou next/server.
 */
import { z } from 'zod';

export const WA_AGENTS_BETA_FLAG = 'wa_agents_beta';

// ---------------------------------------------------------------------------
// Eventos do agente (webhooks e linha do tempo das execuções)
// ---------------------------------------------------------------------------
export const AGENT_EVENTS = [
  'started',
  'message_received',
  'reply_sent',
  'tool_used',
  'finished',
  'handed_off',
  'awaiting_approval',
  'approved',
  'rejected',
  'paused_by_human',
  'resumed',
  'stopped',
  'error',
] as const;
export type AgentEvent = (typeof AGENT_EVENTS)[number];

export const AGENT_EVENT_LABELS: Record<AgentEvent, string> = {
  started: 'Atendimento iniciado',
  message_received: 'Mensagem recebida',
  reply_sent: 'Resposta enviada',
  tool_used: 'Ferramenta usada',
  finished: 'Atendimento encerrado',
  handed_off: 'Passado para outro agente',
  awaiting_approval: 'Aguardando aprovação',
  approved: 'Aprovado',
  rejected: 'Recusado',
  paused_by_human: 'Pausado por atendente',
  resumed: 'Retomado',
  stopped: 'Parado',
  error: 'Erro',
};

// ---------------------------------------------------------------------------
// Resultados do encerramento e ações da esteira
// ---------------------------------------------------------------------------
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
]);
export type EndAction = z.infer<typeof EndActionSchema>;

export const OutcomeSchema = z.object({
  key: z.string().regex(/^[a-z0-9_-]{1,40}$/),
  label: z.string().min(1).max(80),
  description: z.string().max(500).default(''),
  actions: z.array(EndActionSchema).default([]),
});
export type Outcome = z.infer<typeof OutcomeSchema>;

export const AgentWebhookSchema = z.object({
  id: z.string().min(1),
  event: z.enum(AGENT_EVENTS),
  url: z.string().url(),
  secret: z.string().max(200).optional().nullable(),
  body_template: z.string().max(20000).optional().nullable(),
  active: z.boolean().default(true),
});
export type AgentWebhook = z.infer<typeof AgentWebhookSchema>;

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
export const BotStepSchema = z.discriminatedUnion('type', [
  z.object({ id: z.string().min(1), type: z.literal('send_text'), text: z.string().min(1).max(4000) }),
  z.object({ id: z.string().min(1), type: z.literal('wait'), seconds: z.number().int().min(1).max(604800) }),
  z.object({
    id: z.string().min(1),
    type: z.literal('wait_reply'),
    timeout_minutes: z.number().int().min(1).max(43200),
    on_timeout_step_id: z.string().optional().nullable(),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal('condition'),
    rules: z
      .array(z.object({ keywords: z.array(z.string().min(1)).min(1), goto_step_id: z.string().min(1) }))
      .min(1),
    else_step_id: z.string().optional().nullable(),
  }),
  z.object({ id: z.string().min(1), type: z.literal('move_stage'), stage_id: z.string().uuid() }),
  z.object({ id: z.string().min(1), type: z.literal('add_tag'), tag: z.string().min(1).max(60) }),
  z.object({ id: z.string().min(1), type: z.literal('handoff_agent'), agent_id: z.string().uuid() }),
  z.object({ id: z.string().min(1), type: z.literal('end') }),
]);
export type BotStep = z.infer<typeof BotStepSchema>;

export const BotTriggerSchema = z.object({
  type: z.enum(['deal_created', 'deal_stage_entered', 'manual']),
  board_id: z.string().uuid().nullable().optional(),
  stage_id: z.string().uuid().nullable().optional(),
});
export type BotTrigger = z.infer<typeof BotTriggerSchema>;

export const BotInputSchema = z.object({
  name: z.string().min(1).max(120),
  enabled: z.boolean().default(true),
  connection_id: z.string().uuid().nullable(),
  trigger: BotTriggerSchema,
  steps: z.array(BotStepSchema).default([]),
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
};

// ---------------------------------------------------------------------------
// Execuções dos agentes
// ---------------------------------------------------------------------------
export type RunTrigger = 'inbound' | 'resume' | 'manual_start' | 'handoff' | 'approval' | 'bot' | 'test';
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
