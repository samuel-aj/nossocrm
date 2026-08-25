/**
 * Contexto de uma conversa para o agente: conversa, número, contato, negócio
 * e organização; histórico como mensagens do modelo; prompt de sistema.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ModelMessage } from 'ai';
import { getConnectionByIdForOrg, type WaConnectionRow } from '@/lib/whatsapp/service';
import { WaAgentError } from './errors';
import { renderTemplate } from './template';
import {
  AgentWebhookSchema,
  AI_PROVIDERS,
  OutcomeSchema,
  type AgentProvider,
  type AgentRow,
  type AgentWebhook,
  type ConversationAiState,
  type ConversationAiStatus,
  type ConversationApproval,
  type Outcome,
} from './types';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------
export type WaConversationFull = {
  id: string;
  organization_id: string;
  connection_id: string | null;
  contact_id: string | null;
  wa_phone: string;
  wa_name: string | null;
  last_message_at: string | null;
  last_message_preview?: string | null;
  unread_count?: number;
  assigned_owner_id: string | null;
  deal_id: string | null;
  ai_status: ConversationAiStatus | null;
  ai_status_changed_at: string | null;
  ai_paused_by: string | null;
  ai_agent_id: string | null;
  ai_resume_at: string | null;
  ai_state: ConversationAiState | null;
  ai_last_processed_at: string | null;
  ai_lock_until: string | null;
  ai_approval: ConversationApproval | null;
  created_at: string;
  updated_at: string;
};

export type ContextContact = { id: string; name: string; phone: string | null; email: string | null };

export type ContextDeal = {
  id: string;
  title: string;
  board_id: string | null;
  stage_id: string | null;
  stage_label: string | null;
  board_name: string | null;
  owner_id: string | null;
  tags: string[];
};

export type ConversationContext = {
  conversation: WaConversationFull;
  connection: WaConnectionRow | null;
  contact: ContextContact | null;
  deal: ContextDeal | null;
  org: { id: string; name: string };
};

export type WaMessageLite = {
  id: string;
  conversation_id: string;
  direction: 'in' | 'out';
  status: string | null;
  body: string | null;
  media_type: string | null;
  transcription: string | null;
  source: string | null;
  sent_by: string | null;
  created_at: string;
};

export const MESSAGE_LITE_COLUMNS =
  'id, conversation_id, direction, status, body, media_type, transcription, source, sent_by, created_at';

// ---------------------------------------------------------------------------
// Agente
// ---------------------------------------------------------------------------
function parseArray<T>(raw: unknown, parse: (item: unknown) => T | null): T[] {
  if (!Array.isArray(raw)) return [];
  const out: T[] = [];
  for (const item of raw) {
    const v = parse(item);
    if (v) out.push(v);
  }
  return out;
}

function num(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Linha crua de wa_ai_agents -> AgentRow (jsonb validado, números coeridos). */
export function normalizeAgentRow(raw: Record<string, unknown>): AgentRow {
  const provider = AI_PROVIDERS.includes(raw.provider as AgentProvider)
    ? (raw.provider as AgentProvider)
    : 'openai';
  return {
    id: String(raw.id),
    organization_id: String(raw.organization_id),
    name: String(raw.name ?? ''),
    persona_name: (raw.persona_name as string | null) ?? null,
    enabled: raw.enabled !== false,
    connection_ids: Array.isArray(raw.connection_ids) ? (raw.connection_ids as string[]).map(String) : [],
    provider,
    model: String(raw.model ?? ''),
    temperature: num(raw.temperature, 0.5),
    api_key: (raw.api_key as string | null) ?? null,
    system_prompt: String(raw.system_prompt ?? ''),
    buffer_seconds: num(raw.buffer_seconds, 10),
    history_limit: num(raw.history_limit, 40),
    line_delay_ms: num(raw.line_delay_ms, 1500),
    human_pause_minutes: num(raw.human_pause_minutes, 30),
    only_new_conversations: raw.only_new_conversations === true,
    outcomes: parseArray<Outcome>(raw.outcomes, item => {
      const p = OutcomeSchema.safeParse(item);
      return p.success ? p.data : null;
    }),
    webhooks: parseArray<AgentWebhook>(raw.webhooks, item => {
      const p = AgentWebhookSchema.safeParse(item);
      return p.success ? p.data : null;
    }),
    created_by: (raw.created_by as string | null) ?? null,
    created_at: String(raw.created_at ?? ''),
    updated_at: String(raw.updated_at ?? ''),
  };
}

/** Agente da org (validado contra organization_id). null se não existir. */
export async function loadAgent(
  admin: SupabaseClient,
  organizationId: string,
  agentId: string
): Promise<AgentRow | null> {
  const { data } = await admin
    .from('wa_ai_agents')
    .select('*')
    .eq('id', agentId)
    .eq('organization_id', organizationId)
    .maybeSingle();
  return data ? normalizeAgentRow(data as Record<string, unknown>) : null;
}

/** Nomes (id -> nome) de vários agentes da org. */
export async function loadAgentNames(
  admin: SupabaseClient,
  organizationId: string,
  ids: string[]
): Promise<Map<string, { id: string; name: string; persona_name: string | null }>> {
  const map = new Map<string, { id: string; name: string; persona_name: string | null }>();
  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (unique.length === 0) return map;
  const { data } = await admin
    .from('wa_ai_agents')
    .select('id, name, persona_name')
    .eq('organization_id', organizationId)
    .in('id', unique);
  for (const a of (data ?? []) as Array<{ id: string; name: string; persona_name: string | null }>) {
    map.set(a.id, a);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Contexto da conversa
// ---------------------------------------------------------------------------
export async function loadDealContext(
  admin: SupabaseClient,
  organizationId: string,
  input: { dealId?: string | null; contactId?: string | null }
): Promise<ContextDeal | null> {
  type DealRaw = {
    id: string;
    title: string;
    board_id: string | null;
    stage_id: string | null;
    owner_id: string | null;
    tags: string[] | null;
  };
  let deal: DealRaw | null = null;
  if (input.dealId) {
    const { data } = await admin
      .from('deals')
      .select('id, title, board_id, stage_id, owner_id, tags')
      .eq('organization_id', organizationId)
      .eq('id', input.dealId)
      .is('deleted_at', null)
      .maybeSingle();
    deal = (data as DealRaw | null) ?? null;
  }
  if (!deal && input.contactId) {
    // negócio ABERTO mais recente do contato
    const { data } = await admin
      .from('deals')
      .select('id, title, board_id, stage_id, owner_id, tags')
      .eq('organization_id', organizationId)
      .eq('contact_id', input.contactId)
      .is('deleted_at', null)
      .eq('is_won', false)
      .eq('is_lost', false)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    deal = (data as DealRaw | null) ?? null;
  }
  if (!deal) return null;

  let stageLabel: string | null = null;
  let boardName: string | null = null;
  if (deal.stage_id) {
    const { data: st } = await admin
      .from('board_stages')
      .select('label, name')
      .eq('id', deal.stage_id)
      .maybeSingle();
    const s = st as { label?: string | null; name?: string | null } | null;
    stageLabel = s?.label || s?.name || null;
  }
  if (deal.board_id) {
    const { data: bd } = await admin.from('boards').select('name').eq('id', deal.board_id).maybeSingle();
    boardName = (bd as { name?: string | null } | null)?.name ?? null;
  }
  return {
    id: deal.id,
    title: deal.title,
    board_id: deal.board_id,
    stage_id: deal.stage_id,
    stage_label: stageLabel,
    board_name: boardName,
    owner_id: deal.owner_id,
    tags: Array.isArray(deal.tags) ? deal.tags : [],
  };
}

export async function loadConversationContext(
  admin: SupabaseClient,
  organizationId: string,
  conversationId: string
): Promise<ConversationContext> {
  const { data: convRaw, error } = await admin
    .from('wa_conversations')
    .select('*')
    .eq('id', conversationId)
    .eq('organization_id', organizationId)
    .maybeSingle();
  if (error) throw new WaAgentError('DB_ERROR', error.message);
  if (!convRaw) throw new WaAgentError('CONVERSATION_NOT_FOUND', 'Conversa não encontrada');
  const conversation = convRaw as WaConversationFull;

  const connection = conversation.connection_id
    ? await getConnectionByIdForOrg(admin, organizationId, conversation.connection_id)
    : null;

  let contact: ContextContact | null = null;
  if (conversation.contact_id) {
    const { data } = await admin
      .from('contacts')
      .select('id, name, phone, email')
      .eq('organization_id', organizationId)
      .eq('id', conversation.contact_id)
      .maybeSingle();
    contact = (data as ContextContact | null) ?? null;
  }

  const deal = await loadDealContext(admin, organizationId, {
    dealId: conversation.deal_id,
    contactId: conversation.contact_id,
  });

  const { data: orgRow } = await admin.from('organizations').select('id, name').eq('id', organizationId).maybeSingle();
  const org = { id: organizationId, name: (orgRow as { name?: string } | null)?.name ?? '' };

  return { conversation, connection, contact, deal, org };
}

// ---------------------------------------------------------------------------
// Histórico
// ---------------------------------------------------------------------------
const MEDIA_PLACEHOLDER: Record<string, string> = {
  image: '[imagem]',
  audio: '[áudio]',
  video: '[vídeo]',
  document: '[documento]',
  sticker: '[figurinha]',
};

/** Texto de uma mensagem para o modelo (transcrição ou marcador de mídia). */
export function messageText(row: Pick<WaMessageLite, 'body' | 'media_type' | 'transcription'>): string {
  const body = (row.body ?? '').trim();
  if (row.media_type) {
    const t = (row.transcription ?? '').trim();
    if (t) return t;
    const ph = MEDIA_PLACEHOLDER[row.media_type] ?? `[${row.media_type}]`;
    return body ? `${ph} ${body}` : ph;
  }
  return body;
}

const AGENT_SOURCES = new Set(['agent', 'api', 'bot']);

/** Últimas `limit` mensagens da conversa, em ordem cronológica. */
export async function loadRecentMessages(
  admin: SupabaseClient,
  ctx: ConversationContext,
  limit: number
): Promise<WaMessageLite[]> {
  const { data } = await admin
    .from('wa_messages')
    .select(MESSAGE_LITE_COLUMNS)
    .eq('organization_id', ctx.conversation.organization_id)
    .eq('conversation_id', ctx.conversation.id)
    .order('created_at', { ascending: false })
    .limit(Math.max(1, limit));
  return ((data ?? []) as WaMessageLite[]).reverse();
}

export async function buildHistoryMessages(
  admin: SupabaseClient,
  ctx: ConversationContext,
  limit: number
): Promise<ModelMessage[]> {
  const rows = (await loadRecentMessages(admin, ctx, limit)).filter(
    r => !(r.direction === 'out' && r.status === 'failed')
  );

  // nomes dos atendentes humanos (sent_by -> profiles)
  const humanIds = Array.from(
    new Set(rows.filter(r => r.direction === 'out' && r.sent_by).map(r => r.sent_by as string))
  );
  const names = new Map<string, string>();
  if (humanIds.length > 0) {
    const { data } = await admin.from('profiles').select('id, name, first_name').in('id', humanIds);
    for (const p of (data ?? []) as Array<{ id: string; name: string | null; first_name: string | null }>) {
      const n = (p.first_name || p.name || '').trim();
      if (n) names.set(p.id, n);
    }
  }

  const out: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  for (const r of rows) {
    const text = messageText(r);
    if (!text) continue;
    let role: 'user' | 'assistant';
    let content: string;
    if (r.direction === 'in') {
      role = 'user';
      content = text;
    } else if (r.source && AGENT_SOURCES.has(r.source)) {
      role = 'assistant';
      content = text;
    } else {
      const nome = r.sent_by ? names.get(r.sent_by) : undefined;
      role = 'assistant';
      content = `[Atendente humano${nome ? ' ' + nome : ''}]: ${text}`;
    }
    const last = out[out.length - 1];
    if (last && last.role === role) last.content = `${last.content}\n${content}`;
    else out.push({ role, content });
  }

  if (out.length === 0 || out[0].role === 'assistant') {
    out.unshift({ role: 'user', content: '(início da conversa)' });
  }
  return out.map(m => ({ role: m.role, content: m.content }) as ModelMessage);
}

// ---------------------------------------------------------------------------
// Prompt de sistema
// ---------------------------------------------------------------------------
/** "terça-feira, 25 de agosto de 2026 às 15:57" em America/Sao_Paulo */
export function formatDateTimePtBr(date: Date): string {
  try {
    const parts = new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(date);
    const get = (type: string) => parts.find(p => p.type === type)?.value ?? '';
    const weekday = get('weekday');
    const day = get('day');
    const month = get('month');
    const year = get('year');
    const hour = get('hour').padStart(2, '0');
    const minute = get('minute').padStart(2, '0');
    if (!weekday || !day || !month || !year) return date.toISOString();
    return `${weekday}, ${day} de ${month} de ${year} às ${hour}:${minute}`;
  } catch {
    return date.toISOString();
  }
}

export function firstName(name: string): string {
  return (name || '').trim().split(/\s+/)[0] ?? '';
}

export type PromptVars = {
  nome_lead: string;
  primeiro_nome: string;
  telefone: string;
  data_hora: string;
  nome_agente: string;
  nome_escritorio: string;
  negocio: { titulo: string; etapa: string };
};

export function buildPromptVars(input: { agent: AgentRow; ctx: ConversationContext; now?: Date }): PromptVars {
  const { agent, ctx } = input;
  const nomeLead = (ctx.contact?.name || ctx.conversation.wa_name || '').trim();
  return {
    nome_lead: nomeLead,
    primeiro_nome: firstName(nomeLead),
    telefone: ctx.conversation.wa_phone || ctx.contact?.phone || '',
    data_hora: formatDateTimePtBr(input.now ?? new Date()),
    nome_agente: (agent.persona_name || agent.name || '').trim(),
    nome_escritorio: ctx.org.name || '',
    negocio: { titulo: ctx.deal?.title ?? '', etapa: ctx.deal?.stage_label ?? '' },
  };
}

export function buildSystemPrompt(input: { agent: AgentRow; ctx: ConversationContext; now?: Date }): string {
  const { agent, ctx } = input;
  const vars = buildPromptVars(input);
  const script = renderTemplate(agent.system_prompt || '', vars as unknown as Record<string, unknown>).trim();

  const state = (ctx.conversation.ai_state ?? {}) as ConversationAiState;
  const dados = state.dados && Object.keys(state.dados).length > 0 ? JSON.stringify(state.dados) : '{}';

  const lines: string[] = [];
  lines.push('## INSTRUÇÕES DO SISTEMA (obrigatórias; não mencione ao cliente)');
  lines.push(
    '- Canal: WhatsApp. Cada quebra de linha da sua resposta vira uma mensagem separada. Uma ideia por linha, no máximo 3 linhas por resposta, nunca linhas em branco. Não use markdown (negrito, títulos, listas).'
  );
  lines.push(
    '- Mensagens do histórico que começam com "[Atendente humano ...]:" foram escritas por uma pessoa da equipe, não por você. Trate como já ditas: não repita perguntas nem afirmações que o atendente já fez e não contradiga o que ele disse.'
  );
  lines.push(
    `- Dados já salvos sobre este atendimento (JSON): ${dados}. Sempre que descobrir uma informação importante (nome completo, cidade, tipo de caso, datas, documentos, urgência, preferência de contato), chame a ferramenta salvar_dados com um objeto { campo: valor }. Os dados são mesclados aos existentes; não pergunte de novo o que já está salvo.`
  );
  if (state.handoff) {
    lines.push(
      `- Você acabou de assumir esta conversa vinda do agente ${state.handoff.from_agent_name}. Resumo de passagem: ${state.handoff.summary}. Continue de onde parou, sem se apresentar de novo se já houve apresentação.`
    );
  }
  if (agent.outcomes.length > 0) {
    lines.push('- Resultados possíveis do encerramento (use exatamente a chave):');
    for (const o of agent.outcomes) {
      lines.push(`  - ${o.key}: ${o.label}${o.description ? `. ${o.description}` : ''}`);
    }
    lines.push(
      '- Para encerrar o atendimento, chame a ferramenta encerrar_atendimento UMA única vez, na mesma resposta e DEPOIS de escrever a mensagem final para o cliente, com "resultado" igual a uma das chaves acima e "resumo" com o resumo objetivo do caso (quem, o quê, quando, onde, provas, urgência). Se nenhum resultado se aplicar, não encerre.'
    );
  } else {
    lines.push('- Este agente não tem resultados de encerramento configurados: não chame encerrar_atendimento.');
  }
  lines.push(
    '- Se não houver nada útil a dizer (por exemplo, a pessoa só mandou um "ok" depois do encerramento), responda exatamente [SEM_RESPOSTA], sem mais nada.'
  );

  return `${script}\n\n${lines.join('\n')}`.trim();
}
