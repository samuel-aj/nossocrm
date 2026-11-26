import 'server-only';
import type { z } from 'zod';
import type { WhatsAppContext } from '../whatsapp/access';
import type { pageSchema, conversationsSchema, transcriptSchema, versionsSchema, updateSchema, restoreSchema } from './schemas';

class AgentToolError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

function unavailable(): never {
  throw new AgentToolError('UNAVAILABLE', 'Registro indisponível ou sem permissão.');
}

function check(error: { code?: string } | null) {
  if (!error) return;
  if (error.code === 'P0002' || error.code === '42501') unavailable();
  if (error.code === '40001') throw new AgentToolError('VERSION_CONFLICT', 'O roteiro mudou. Consulte a versão atual e revise a alteração antes de tentar novamente.');
  if (error.code === '22023') throw new AgentToolError('INVALID_CHANGE', 'Confira a versão, os textos e a referência da alteração.');
  throw error;
}

export function toolError(error: unknown) {
  return error instanceof AgentToolError ? { code: error.code, error: error.message } :
    { code: 'AI_AGENTS_UNAVAILABLE', error: 'Operação indisponível. Consulte o histórico antes de repetir uma gravação.' };
}

async function snapshot(ctx: WhatsAppContext, agentId: string): Promise<number> {
  const { data, error } = await ctx.admin.rpc('wa_ai_agent_prompt_snapshot', {
    p_organization_id: ctx.user.organizationId, p_agent_id: agentId,
  });
  check(error);
  if (!Number.isInteger(data)) unavailable();
  return data;
}

const agentMetadata = 'id,name,enabled,model,connection_ids,squad_monitoring';
const versionMetadata = 'version,source,change_summary,external_ref,created_by_key,created_by,created_at';
const versionContent = 'version,source,change_summary,external_ref,created_by_key,created_by,created_at,system_prompt,stop_rules';

export async function listAgents(ctx: WhatsAppContext, input: z.infer<typeof pageSchema>) {
  let query = ctx.admin.from('wa_ai_agents').select(agentMetadata)
    .eq('organization_id', ctx.user.organizationId).order('id').limit(input.limit + 1);
  if (input.afterId) query = query.gt('id', input.afterId);
  const { data, error } = await query;
  check(error);
  const rows = data ?? [];
  const page = rows.slice(0, input.limit);
  if (!page.length) return { agents: [], nextCursor: null };
  const snapshots = await ctx.admin.rpc('wa_ai_agent_prompt_snapshots', {
    p_organization_id: ctx.user.organizationId, p_agent_ids: page.map(a => a.id),
  });
  check(snapshots.error);
  const versions = new Map<string, number>((snapshots.data ?? []).map((s: { agent_id: string; version: number }) => [s.agent_id, s.version]));
  return {
    agents: page.filter(a => versions.has(a.id)).map(a => ({ ...a, version: versions.get(a.id) })),
    nextCursor: rows.length > input.limit ? page[page.length - 1].id : null,
  };
}

async function readVersion(ctx: WhatsAppContext, agentId: string, version: number) {
  const result = await ctx.admin.from('wa_ai_agent_prompt_versions').select(versionContent)
    .eq('organization_id', ctx.user.organizationId).eq('agent_id', agentId).eq('version', version).maybeSingle();
  check(result.error);
  if (!result.data) unavailable();
  return result.data;
}

export async function getAgent(ctx: WhatsAppContext, agentId: string) {
  const current = await snapshot(ctx, agentId);
  const [version, documents, agent] = await Promise.all([
    readVersion(ctx, agentId, current),
    ctx.admin.from('wa_ai_agent_documents').select('name,title,status')
      .eq('organization_id', ctx.user.organizationId).eq('agent_id', agentId).order('id'),
    ctx.admin.from('wa_ai_agents').select(agentMetadata)
      .eq('organization_id', ctx.user.organizationId).eq('id', agentId).eq('squad_monitoring', true).maybeSingle(),
  ]);
  check(agent.error);
  check(documents.error);
  if (!agent.data) unavailable();
  return { ...agent.data, version: current, system_prompt: version.system_prompt, stop_rules: version.stop_rules, documents: documents.data ?? [] };
}

export async function listVersions(ctx: WhatsAppContext, input: z.infer<typeof versionsSchema>) {
  const currentVersion = await snapshot(ctx, input.agentId);
  let query = ctx.admin.from('wa_ai_agent_prompt_versions').select(versionMetadata)
    .eq('organization_id', ctx.user.organizationId).eq('agent_id', input.agentId).lte('version', currentVersion)
    .order('version', { ascending: false }).limit(input.limit + 1);
  if (input.beforeVersion !== undefined) query = query.lt('version', input.beforeVersion);
  const { data, error } = await query;
  check(error);
  const rows = data ?? [];
  return { currentVersion, versions: rows.slice(0, input.limit), nextCursor: rows.length > input.limit ? rows[input.limit - 1].version : null };
}

export async function getVersion(ctx: WhatsAppContext, agentId: string, version: number) {
  const currentVersion = await snapshot(ctx, agentId);
  if (version > currentVersion) unavailable();
  return { currentVersion, revision: await readVersion(ctx, agentId, version) };
}

export async function changePrompt(ctx: WhatsAppContext, input: z.infer<typeof updateSchema> | z.infer<typeof restoreSchema>) {
  const restore = 'version' in input;
  const { data, error } = await ctx.admin.rpc('wa_ai_agent_prompt_change', {
    p_organization_id: ctx.user.organizationId, p_agent_id: input.agentId, p_key_id: ctx.apiKeyId,
    p_expected_version: input.expectedVersion, p_change_summary: input.changeSummary, p_external_ref: input.externalRef,
    p_system_prompt: restore ? null : input.system_prompt ?? null,
    p_stop_rules: restore ? null : input.stop_rules ?? null,
    p_restore_version: restore ? input.version : null,
  });
  check(error);
  if (!Number.isInteger(data)) unavailable();
  return { agentId: input.agentId, version: data };
}

export async function conversations(ctx: WhatsAppContext, input: z.infer<typeof conversationsSchema>) {
  const { data, error } = await ctx.admin.rpc('wa_ai_agent_conversations', {
    p_organization_id: ctx.user.organizationId, p_agent_id: input.agentId,
    p_from: input.from, p_to: input.to, p_after_id: input.afterId ?? null, p_limit: input.limit + 1,
  });
  check(error);
  const rows = data ?? [];
  return { conversations: rows.slice(0, input.limit), nextCursor: rows.length > input.limit ? rows[input.limit - 1].conversation_id : null };
}

function maskedPhone(phone: string | null) {
  const digits = phone?.replace(/\D/g, '');
  return digits && digits.length > 4 ? '••••' + digits.slice(-4) : null;
}

// Phone numbers may also be present in the body and in transcribed speech.
function maskInText(text: string | null): string | null {
  return text?.replace(/\+?\(?\d(?:[ \t().\u00a0\u2000-\u200a\u2010-\u2015\u202f-]{0,4}\d){7,14}/g, match => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(match)) return match;
    return maskedPhone(match) ?? '••••';
  }) ?? null;
}

function messageAuthor(direction: string, source: string | null, sentBy: string | null) {
  if (direction === 'in') return 'lead';
  if (source === 'agent') return 'agent';
  if (source === 'bot' || source === 'api') return 'automation';
  if (source === 'crm' || sentBy) return 'person';
  return 'unknown';
}

function transcriptText(message: { body: string | null; media_type: string | null; transcription: string | null }) {
  // Other media can hold OCR, captions or entire documents in the transcription column.
  if (message.media_type === 'audio') return maskInText(message.transcription);
  if (message.media_type) return null;
  const body = message.body ?? '';
  // Both providers also serialize contact bundles and location attachments as plain bodies.
  if (body.startsWith('👤 Contatos compartilhados:\n') ||
    (body.startsWith('📍 ') && body.includes('\nhttps://maps.google.com/?q='))) return null;
  return maskInText(message.body);
}

export async function transcript(ctx: WhatsAppContext, input: z.infer<typeof transcriptSchema>) {
  // The current agent on a conversation can change; a real run establishes participation.
  await snapshot(ctx, input.agentId);
  const { user, admin } = ctx;
  const participation = await admin.from('wa_ai_agent_runs').select('id')
    .eq('organization_id', user.organizationId).eq('agent_id', input.agentId)
    .eq('conversation_id', input.conversationId).neq('trigger', 'test').limit(1).maybeSingle();
  check(participation.error);
  if (!participation.data) unavailable();
  const conversation = await admin.from('wa_conversations').select('wa_phone')
    .eq('organization_id', user.organizationId).eq('id', input.conversationId).maybeSingle();
  check(conversation.error);
  if (!conversation.data) unavailable();
  let query = admin.from('wa_messages').select('id,direction,source,sent_by,created_at,body,transcription,media_type')
    .eq('organization_id', user.organizationId).eq('conversation_id', input.conversationId)
    .is('deleted_at', null).order('created_at').order('id').limit(input.limit + 1);
  if (input.after) query = query.or(`created_at.gt.${input.after.at},and(created_at.eq.${input.after.at},id.gt.${input.after.id})`);
  const result = await query;
  check(result.error);
  const rows = result.data ?? [];
  const page = rows.slice(0, input.limit);
  const last = page.at(-1);
  return {
    conversationId: input.conversationId, phone: maskedPhone(conversation.data.wa_phone),
    messages: page.map(m => ({
      id: m.id, at: m.created_at, author: messageAuthor(m.direction, m.source, m.sent_by),
      text: transcriptText(m),
    })),
    nextCursor: rows.length > input.limit && last ? { at: last.created_at, id: last.id } : null,
  };
}
