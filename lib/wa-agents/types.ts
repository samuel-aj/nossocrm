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
  /** Produto do catálogo da org lançado como item do negócio (não duplica) */
  z.object({ type: z.literal('set_product'), product_id: z.string().uuid() }),
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
// Ferramentas do agente (ligadas/desligadas na configuração)
// ---------------------------------------------------------------------------
export const AgentToolsSchema = z.object({
  /** Ferramenta calcular (avaliador seguro de expressões) */
  calculator: z.boolean().default(true),
});
export type AgentTools = z.infer<typeof AgentToolsSchema>;
export const DEFAULT_AGENT_TOOLS: AgentTools = { calculator: true };

// ---------------------------------------------------------------------------
// Agente
// ---------------------------------------------------------------------------
export const AI_PROVIDERS = ['openai', 'anthropic', 'google'] as const;
export type AgentProvider = (typeof AI_PROVIDERS)[number];

/** Follow-up por tempo sem resposta do lead: o agente manda uma mensagem (dentro da janela) ou um robô entra */
export const AGENT_FOLLOWUP_KINDS = ['agent', 'bot'] as const;
export type AgentFollowupKind = (typeof AGENT_FOLLOWUP_KINDS)[number];
export const AgentFollowupSchema = z.object({
  id: z.string().min(1).max(40),
  /** minutos sem resposta do lead, contados da última mensagem do agente que ficou sem resposta */
  after_minutes: z.number().int().min(1).max(43200),
  kind: z.enum(AGENT_FOLLOWUP_KINDS),
  /** kind 'agent': instrução extra para o agente escrever o follow-up (opcional) */
  instruction: z.string().max(2000).default(''),
  /** kind 'bot': robô que entra em ação (gatilho "Follow-up do agente de IA" ou manual) */
  bot_id: z.string().uuid().nullable().default(null),
  /** kind 'agent' num número da API oficial: só dentro da janela de 24 h (fora dela a regra é pulada) */
  only_in_window: z.boolean().default(true),
});
export type AgentFollowup = z.infer<typeof AgentFollowupSchema>;

export const AGENT_START_MODES = ['speak_first', 'wait_reply'] as const;
export type AgentStartMode = (typeof AGENT_START_MODES)[number];

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
  /** Regras explícitas de quando o agente encerra (bloco "QUANDO ENCERRAR" do prompt; obrigatórias) */
  stop_rules: z.string().max(4000).default(''),
  /** Teto de respostas do agente por atendimento (0 = sem limite): ao atingir, ele manda a mensagem final e encerra */
  max_replies: z.number().int().min(0).max(500).default(0),
  /** Ao ser ativado pelo chat (Automações) ou pelo pipeline: já manda a primeira mensagem ou espera a próxima mensagem do contato */
  start_mode: z.enum(AGENT_START_MODES).default('speak_first'),
  /** Régua de follow-ups por tempo sem resposta do lead (em ordem de tempo) */
  followups: z.array(AgentFollowupSchema).max(10).default([]),
  outcomes: z.array(OutcomeSchema).default([]),
  webhooks: z.array(AgentWebhookSchema).default([]),
  custom_actions: z.array(CustomActionSchema).default([]),
  triggers: AgentTriggersSchema.default(DEFAULT_AGENT_TRIGGERS),
  /** Agentes da org que este agente pode consultar durante a conversa (ferramenta consultar_agente) */
  helper_agent_ids: z.array(z.string().uuid()).max(20).default([]),
  tools: AgentToolsSchema.default(DEFAULT_AGENT_TOOLS),
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
/** Robô para o menu do chat (qualquer membro da org) */
export type BotMinimal = { id: string; name: string; enabled: boolean; connection_id: string | null };

// ---------------------------------------------------------------------------
// Segredos (chave da API e segredos de webhook) nunca voltam em claro para a UI
// ---------------------------------------------------------------------------
/** Valor que substitui um segredo salvo nas respostas da API. */
export const SECRET_MASK = '••••••••';

/** true quando o valor é a máscara (a UI devolveu o segredo sem alterar). */
export function isMaskedSecret(value: unknown): boolean {
  return typeof value === 'string' && value.trim().startsWith('••••');
}

function maskSecret(value: string | null | undefined): string | null {
  return value && value.trim() ? SECRET_MASK : null;
}

/** Ações da esteira com o segredo do webhook mascarado. */
export function maskActionSecrets(actions: EndAction[]): EndAction[] {
  return (actions ?? []).map(a => (a.type === 'webhook' ? { ...a, secret: maskSecret(a.secret) } : a));
}

/** Webhooks, resultados e ações durante a conversa com os segredos mascarados. */
export function maskAgentSecrets<T extends Pick<AgentInput, 'webhooks' | 'outcomes' | 'custom_actions'>>(row: T): T {
  return {
    ...row,
    webhooks: (row.webhooks ?? []).map(w => ({ ...w, secret: maskSecret(w.secret) })),
    outcomes: (row.outcomes ?? []).map(o => ({ ...o, actions: maskActionSecrets(o.actions) })),
    custom_actions: (row.custom_actions ?? []).map(c => ({ ...c, actions: maskActionSecrets(c.actions) })),
  };
}

/** Versão sem a chave (para a UI): a chave vira só `has_api_key`; segredos de webhook mascarados. */
export function toAgentPublic(row: AgentRow): AgentPublic {
  const { api_key, ...rest } = row;
  return maskAgentSecrets({ ...rest, has_api_key: !!(api_key && api_key.trim()) });
}

// ---------------------------------------------------------------------------
// Base de conhecimento (documentos) e mídias do agente
// ---------------------------------------------------------------------------
/** Bucket PRIVADO dos arquivos dos agentes (documentos e mídias). */
export const WA_AGENT_FILES_BUCKET = 'wa-agent-files';
/** Tamanho máximo de um arquivo do agente (50 MB, limite do bucket). */
export const AGENT_FILE_MAX_BYTES = 52428800;

/** Tamanho máximo de um documento da base de conhecimento (15 MB). */
export const AGENT_DOC_MAX_BYTES = 15 * 1024 * 1024;
/** Documentos por agente. */
export const AGENT_DOCS_MAX_PER_AGENT = 20;
/** Trechos (chunks) por agente, somando todos os documentos. */
export const AGENT_CHUNKS_MAX_PER_AGENT = 5000;

export const AGENT_DOC_MIMES = [
  'application/pdf',
  'text/plain',
  'text/markdown',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const;
export type AgentDocMime = (typeof AGENT_DOC_MIMES)[number];

export const AGENT_DOCUMENT_STATUSES = ['processing', 'ready', 'error'] as const;
export type AgentDocumentStatus = (typeof AGENT_DOCUMENT_STATUSES)[number];

export type AgentDocumentRow = {
  id: string;
  organization_id: string;
  agent_id: string;
  name: string;
  mime: string | null;
  size_bytes: number;
  storage_path: string;
  status: AgentDocumentStatus;
  error: string | null;
  chunk_count: number;
  /** Modelo usado nos embeddings dos trechos (ex.: "openai:text-embedding-3-small"); null sem embedding */
  embedding_model?: string | null;
  /** Metadados (migração 20260827120000): entram no cabeçalho dos trechos vetorizados e na lista do prompt */
  title?: string | null;
  description?: string | null;
  tags?: string[] | null;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
};

export const AGENT_MEDIA_KINDS = ['image', 'video', 'audio', 'document'] as const;
export type AgentMediaKind = (typeof AGENT_MEDIA_KINDS)[number];

/** Tipos de arquivo aceitos por categoria de mídia (o que o WhatsApp entrega bem). */
export const AGENT_MEDIA_MIMES: Record<AgentMediaKind, readonly string[]> = {
  image: ['image/jpeg', 'image/png', 'image/webp'],
  video: ['video/mp4', 'video/3gpp'],
  audio: ['audio/mpeg', 'audio/mp3', 'audio/ogg', 'audio/opus', 'audio/mp4', 'audio/aac', 'audio/wav', 'audio/x-wav'],
  document: [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.ms-powerpoint',
    'text/plain',
  ],
};

/** Mime normalizado (sem parâmetros, minúsculas) ou ''. */
export function normalizeMime(mime: string | null | undefined): string {
  return (mime ?? '').split(';')[0].trim().toLowerCase();
}

/** true quando o mime é aceito para a categoria da mídia. */
export function isAllowedMediaMime(kind: AgentMediaKind, mime: string | null | undefined): boolean {
  const m = normalizeMime(mime);
  return !!m && AGENT_MEDIA_MIMES[kind].includes(m);
}

export type AgentMediaRow = {
  id: string;
  organization_id: string;
  agent_id: string;
  name: string;
  /** Quando enviar (linguagem natural) */
  description: string | null;
  kind: AgentMediaKind;
  mime: string | null;
  size_bytes: number;
  storage_path: string;
  /** Cópia no bucket wa-media (feita no primeiro envio e reutilizada) */
  outbox_path?: string | null;
  created_at: string;
};

export const AgentMediaInputSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(500).default(''),
  kind: z.enum(AGENT_MEDIA_KINDS),
  storage_path: z.string().min(1),
  mime: z.string().max(120),
  size_bytes: z.number().int().min(0).max(AGENT_FILE_MAX_BYTES),
});
export type AgentMediaInput = z.infer<typeof AgentMediaInputSchema>;

/** PATCH de uma mídia: só nome e descrição */
export const AgentMediaPatchSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  description: z.string().max(500).optional(),
});

/** Metadados editáveis de um documento da base (título, descrição do conteúdo, etiquetas). */
export const AgentDocumentMetaSchema = z.object({
  title: z.string().trim().max(160).nullable().optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
});
export type AgentDocumentMeta = z.infer<typeof AgentDocumentMetaSchema>;

export const AgentDocumentInputSchema = z.object({
  name: z.string().min(1).max(160),
  storage_path: z.string().min(1),
  mime: z.string().max(120),
  size_bytes: z.number().int().min(0).max(AGENT_DOC_MAX_BYTES),
  ...AgentDocumentMetaSchema.shape,
});
export type AgentDocumentInput = z.infer<typeof AgentDocumentInputSchema>;

export const AGENT_UPLOAD_KINDS = ['doc', 'media'] as const;
export type AgentUploadKind = (typeof AGENT_UPLOAD_KINDS)[number];

/** POST /api/wa-agents/uploads */
export const AgentUploadInputSchema = z.object({
  agentId: z.string().uuid(),
  fileName: z.string().min(1).max(255),
  kind: z.enum(AGENT_UPLOAD_KINDS),
});
export type AgentUploadInput = z.infer<typeof AgentUploadInputSchema>;

/** Trecho da base de conhecimento devolvido pela busca */
export type KnowledgeHit = { content: string; document_id: string; idx: number; score: number };

/** Recursos carregados de um agente para montar o prompt e as ferramentas */
export type AgentResources = {
  /** Documentos prontos (com trechos) */
  documents: AgentDocumentRow[];
  media: AgentMediaRow[];
  /** Agentes auxiliares (da org, ligados, diferentes do próprio) */
  helpers: AgentRow[];
};

/**
 * Marcadores do roteiro: `[[acao:chave]]` e `[[midia:nome]]` indicam o momento
 * exato em que o agente chama executar_acao / enviar_midia.
 */
export const SCRIPT_ACTION_MARKER_RE = /\[\[\s*acao\s*:\s*([^\]]+?)\s*\]\]/gi;
export const SCRIPT_MEDIA_MARKER_RE = /\[\[\s*midia\s*:\s*([^\]]+?)\s*\]\]/gi;

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

/** Tipos de regra da Condição: resposta do lead, rótulo do negócio ou etapa do negócio */
export const BOT_CONDITION_KINDS = [
  'reply_contains',
  'reply_not_contains',
  'tag_has',
  'tag_not_has',
  'stage_is',
  'stage_not_is',
] as const;
export type BotConditionKind = (typeof BOT_CONDITION_KINDS)[number];
/** Campos e operadores das condições (estilo Typebot/Switch): campo · operador · valor */
export const BOT_CONDITION_FIELDS = [
  'reply',
  'tags',
  'stage',
  'board',
  'contact_name',
  'contact_phone',
  'deal_title',
  'deal_value',
  'deal_source',
  'custom_field',
  'contexto_extra',
] as const;
export type BotConditionField = (typeof BOT_CONDITION_FIELDS)[number];
export const BOT_CONDITION_OPS = [
  'contains',
  'not_contains',
  'equals',
  'not_equals',
  'starts_with',
  'ends_with',
  'is_empty',
  'not_empty',
  'gt',
  'lt',
] as const;
export type BotConditionOp = (typeof BOT_CONDITION_OPS)[number];
export const BotConditionClauseSchema = z.object({
  field: z.enum(BOT_CONDITION_FIELDS),
  /** chave do campo personalizado (field = custom_field) */
  key: z.string().max(80).optional(),
  op: z.enum(BOT_CONDITION_OPS),
  value: z.string().max(500).default(''),
});
export type BotConditionClause = z.infer<typeof BotConditionClauseSchema>;

/**
 * Um caminho da Condição: condições combinadas por E (all) ou OU (any) → goto_step_id.
 * Regras antigas (kind/keywords/tag/stage_id, sem `clauses`) continuam válidas.
 */
export const BotConditionRuleSchema = z.object({
  match: z.enum(['all', 'any']).default('all'),
  label: z.string().max(60).optional(),
  clauses: z.array(BotConditionClauseSchema).max(10).default([]),
  kind: z.enum(BOT_CONDITION_KINDS).default('reply_contains'),
  keywords: z.array(z.string().min(1)).default([]),
  tag: z.string().max(60).optional(),
  stage_id: z.string().uuid().optional().nullable(),
  goto_step_id: z.string().min(1),
});
export type BotConditionRule = z.infer<typeof BotConditionRuleSchema>;

export const BotStepSchema = z.discriminatedUnion('type', [
  z.object({ ...botStepBase, type: z.literal('send_text'), text: z.string().min(1).max(4000) }),
  /**
   * Modelo de mensagem (Configurações → Modelos): do WhatsApp API sai como template pela Meta; geral/QR vai
   * como texto. Depois de enviar, espera a resposta do lead por até timeout_minutes: botão de resposta rápida
   * → button_step_ids[i]; outra resposta → next_step_id; sem resposta → on_timeout_step_id.
   */
  z.object({
    ...botStepBase,
    type: z.literal('send_template'),
    template_id: z.string().uuid(),
    template_name: z.string().max(120).optional(),
    /** corpo do modelo (cópia para o quadro mostrar o texto; a Meta usa o modelo aprovado) */
    template_body: z.string().max(2000).optional(),
    /** textos dos botões de resposta rápida do modelo (uma saída por botão) */
    buttons: z.array(z.string().max(60)).max(10).default([]),
    button_step_ids: z.array(z.string().nullable()).max(10).default([]),
    timeout_minutes: z.number().int().min(1).max(43200).default(1440),
    on_timeout_step_id: z.string().optional().nullable(),
  }),
  /** "Digitando..." por N segundos (presença composing no número por QR; na API oficial só espera) */
  z.object({ ...botStepBase, type: z.literal('typing'), seconds: z.number().int().min(1).max(60) }),
  /** Encerra este robô e inicia outro na mesma conversa (terminal; até 5 em cadeia) */
  z.object({
    ...botStepBase,
    type: z.literal('start_bot'),
    bot_id: z.string().uuid(),
    bot_name: z.string().max(120).optional(),
  }),
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
    rules: z.array(BotConditionRuleSchema).min(1),
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
  /** agent_followup: só entra em ação por uma regra de follow-up de um agente de IA */
  type: z.enum(['deal_created', 'deal_stage_entered', 'manual', 'agent_followup']),
  board_id: z.string().uuid().nullable().optional(),
  stage_id: z.string().uuid().nullable().optional(),
  /** Posição do nó Gatilho no quadro (persistida como a dos passos) */
  ui: BotStepUiSchema.optional(),
});
export type BotTrigger = z.infer<typeof BotTriggerSchema>;

/**
 * Balão do quadro (estilo Typebot): lista ORDENADA de passos empilhados, com
 * nome e posição. Só desenho: os passos continuam planos em `steps`, e o
 * encadeamento dentro do balão é gravado em `next_step_id` pelo editor.
 */
export const BotLayoutGroupSchema = z.object({
  id: z.string().min(1),
  name: z.string().max(80).default(''),
  x: z.number(),
  y: z.number(),
  step_ids: z.array(z.string().min(1)).default([]),
});
export type BotLayoutGroup = z.infer<typeof BotLayoutGroupSchema>;

/** Desenho do quadro (coluna wa_bots.layout). */
export const BotLayoutSchema = z.object({ groups: z.array(BotLayoutGroupSchema).default([]) });
export type BotLayout = z.infer<typeof BotLayoutSchema>;

/** Desenho do quadro como a UI espera ({ groups: [] } quando a coluna está vazia ou inválida). */
export function normalizeBotLayout(raw: unknown): BotLayout {
  const parsed = BotLayoutSchema.safeParse(raw && typeof raw === 'object' ? raw : {});
  return parsed.success ? parsed.data : { groups: [] };
}

export const BotInputSchema = z.object({
  name: z.string().min(1).max(120),
  enabled: z.boolean().default(true),
  connection_id: z.string().uuid().nullable(),
  trigger: BotTriggerSchema,
  steps: z.array(BotStepSchema).default([]),
  /** Modo quadro: id do primeiro passo; ausente = robô em lista (índice + 1) */
  start_step_id: z.string().nullable().optional(),
  /** Balões do quadro (vários passos por balão); vazio = um balão por passo */
  layout: BotLayoutSchema.default({ groups: [] }),
});
export type BotInput = z.infer<typeof BotInputSchema>;
export type BotRow = BotInput & {
  id: string;
  organization_id: string;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
};

/** Robô para a UI: segredo do passo webhook mascarado e desenho do quadro sempre com `groups`. */
export function toBotPublic<T extends { steps?: unknown; layout?: unknown }>(row: T): T {
  const steps = Array.isArray(row.steps) ? (row.steps as Array<Record<string, unknown>>) : [];
  return {
    ...row,
    steps: steps.map(s =>
      s && typeof s === 'object' && s.type === 'webhook' ? { ...s, secret: maskSecret(s.secret as string | null | undefined) } : s
    ),
    layout: normalizeBotLayout(row.layout),
  };
}

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

export type ConversationAiAction =
  | 'pause'
  | 'resume'
  | 'stop'
  | 'start'
  | 'approve'
  | 'reject'
  /** inicia um robô nesta conversa (botId); o agente da conversa, se houver, para */
  | 'start_bot'
  /** cancela o robô em andamento nesta conversa */
  | 'cancel_bot'
  /** limpa a memória do agente nesta conversa (ele esquece o que veio antes e para); o chat continua visível */
  | 'reset_memory'
  /** grava/acrescenta contexto adicional (ai_state.contexto_extra) sem mexer no estado do agente */
  | 'set_context';

/** Robô em andamento numa conversa (execução 'running' ou 'waiting_reply') */
export type ConversationBotInfo = {
  runId: string;
  botId: string;
  name: string;
  status: 'running' | 'waiting_reply';
};

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
  /** nomes das mídias já enviadas neste atendimento (enviar_midia não repete) */
  midias_enviadas?: string[];
  /** respostas já enviadas pelo agente neste atendimento (teto max_replies) */
  respostas?: number;
  /** "Limpar memória": o agente só enxerga mensagens a partir desta data (ISO) */
  memoria_desde?: string | null;
  /** contexto adicional escrito pela equipe ao iniciar o agente/robô nesta conversa */
  contexto_extra?: string | null;
  /** follow-ups já disparados neste ciclo de silêncio (cycle = última mensagem recebida) */
  followups?: { cycle: string | null; done: string[] } | null;
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
export type RunTrigger = 'inbound' | 'resume' | 'manual_start' | 'handoff' | 'approval' | 'bot' | 'test' | 'deal' | 'followup';
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

/** Mensagem do chat de teste enviada como exemplo para o ajuste */
export const AssistExampleSchema = z.object({
  role: z.enum(['user', 'assistant']),
  text: z.string().max(8000),
});
export type AssistExample = z.infer<typeof AssistExampleSchema>;

export const AssistInputSchema = z.object({
  mode: z.enum(ASSIST_MODES),
  /** generate: descrição do atendimento */
  description: z.string().max(8000).optional(),
  /** improve/adjust: roteiro atual */
  current_prompt: z.string().max(60000).optional(),
  /** adjust: o que mudar */
  instruction: z.string().max(4000).optional(),
  /** adjust: sinônimo de instruction ("o que o agente fez de errado") */
  feedback: z.string().max(4000).optional(),
  /** adjust: últimas mensagens do chat de teste, para contextualizar a correção */
  examples: z.array(AssistExampleSchema).max(30).optional(),
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
