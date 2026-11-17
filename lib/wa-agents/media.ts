/**
 * Envio de uma mídia cadastrada do agente pelo WhatsApp (ferramenta
 * enviar_midia). O arquivo é copiado NO SERVIDOR do Storage (sem passar pela
 * memória da função) do bucket privado wa-agent-files para o wa-media (pasta
 * out da org) uma única vez por mídia; o caminho da cópia fica em
 * wa_ai_agent_media.outbox_path e é reutilizado nos envios seguintes. Assim o
 * chat exibe a mensagem como qualquer mídia enviada e a Evolution/Meta baixa
 * por uma URL assinada curta. SERVER.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import { getProvider, type OutboundMediaKind, type SendResult } from '@/lib/whatsapp';
import { recordOutboundMessage, replicateOutboundToSiblings } from '@/lib/whatsapp/service';
import type { ConversationContext } from './context';
import { errorMessage } from './errors';
import { internalOutputReason } from './replyOutput';
import { originalFileName } from './files';
import { WA_AGENT_FILES_BUCKET, type AgentMediaRow, type AgentRow } from './types';
import { deliveredMediaNames, finishMediaDelivery, reserveMediaDelivery } from './mediaDelivery';
import { normalizeKeyword } from './text';
import { beginMediaCooldownDispatch, claimMediaCooldown, finishMediaCooldownDispatch, MediaCooldownError, releaseMediaCooldown } from '@/lib/whatsapp/mediaCooldown';

export const WA_MEDIA_BUCKET = 'wa-media';
/** Validade da URL assinada entregue ao provedor (segundos). */
const SIGNED_URL_SECONDS = 600;

export type SendAgentMediaInput = {
  organizationId: string;
  agent: Pick<AgentRow, 'id' | 'name'>;
  ctx: ConversationContext;
  media: AgentMediaRow;
  caption?: string;
  beforeDispatch?: () => Promise<void>;
};

export type SendAgentMediaResult =
  | { ok: true; messageId: string | null; providerMessageId: string | null; mediaPath: string; skipped?: boolean }
  | { ok: false; error: string; retryable?: boolean };

/** Extensão do arquivo (com ponto) ou ''. */
function fileExtension(name: string): string {
  const m = /\.[a-zA-Z0-9]{1,8}$/.exec(name);
  return m ? m[0].toLowerCase() : '';
}

function outboxPathFor(organizationId: string, media: AgentMediaRow): string {
  const original = originalFileName(media.storage_path, media.name);
  const ext = fileExtension(original);
  const asset = createHash('sha256').update(media.storage_path).digest('hex');
  return `${organizationId}/out/agente_${asset}${ext}`;
}

/**
 * Copia o arquivo do bucket wa-agent-files para wa-media/${orgId}/out/... e
 * devolve o caminho novo. Cópia feita pelo Storage (server-side); se o
 * Storage não aceitar a cópia entre buckets, cai no download + upload.
 * Lança em falha.
 */
export async function copyAgentMediaToOutbox(
  admin: SupabaseClient,
  organizationId: string,
  media: AgentMediaRow
): Promise<string> {
  if (!media.storage_path.startsWith(`${organizationId}/`)) throw new Error('Caminho do arquivo inválido');
  const path = outboxPathFor(organizationId, media);
  const { data: exists } = await admin.storage.from(WA_MEDIA_BUCKET).exists(path);
  if (exists) return path;

  const { error: copyError } = await admin.storage
    .from(WA_AGENT_FILES_BUCKET)
    .copy(media.storage_path, path, { destinationBucket: WA_MEDIA_BUCKET });
  if (!copyError) return path;
  // A concurrent turn may have copied this same asset while we were preparing.
  const { data: copied } = await admin.storage.from(WA_MEDIA_BUCKET).exists(path);
  if (copied) return path;
  console.error('[wa-agents] cópia da mídia no Storage falhou, tentando download + upload:', copyError.message);

  const { data: blob, error: dlError } = await admin.storage.from(WA_AGENT_FILES_BUCKET).download(media.storage_path);
  if (dlError || !blob) throw new Error(`Falha ao ler a mídia: ${dlError?.message ?? 'arquivo não encontrado'}`);
  const { error: upError } = await admin.storage
    .from(WA_MEDIA_BUCKET)
    .upload(path, blob, { contentType: media.mime || blob.type || undefined, upsert: false });
  if (upError) {
    const { data: uploaded } = await admin.storage.from(WA_MEDIA_BUCKET).exists(path);
    if (!uploaded) throw new Error(`Falha ao preparar a mídia: ${upError.message}`);
  }
  return path;
}

/**
 * Caminho da cópia da mídia no wa-media: reutiliza `outbox_path` quando o
 * objeto ainda existe; senão copia e guarda o caminho na mídia (melhor
 * esforço). Lança em falha da cópia.
 */
export async function ensureAgentMediaOutbox(
  admin: SupabaseClient,
  organizationId: string,
  media: AgentMediaRow
): Promise<string> {
  const cached = (media.outbox_path ?? '').trim();
  if (cached && cached.startsWith(`${organizationId}/`)) {
    try {
      const { data: exists, error } = await admin.storage.from(WA_MEDIA_BUCKET).exists(cached);
      if (!error && exists) return cached;
    } catch (e) {
      console.error('[wa-agents] conferir cópia da mídia falhou:', errorMessage(e));
    }
  }
  const path = await copyAgentMediaToOutbox(admin, organizationId, media);
  try {
    await admin
      .from('wa_ai_agent_media')
      .update({ outbox_path: path })
      .eq('organization_id', organizationId)
      .eq('id', media.id);
    media.outbox_path = path;
  } catch (e) {
    console.error('[wa-agents] guardar caminho da cópia da mídia falhou:', errorMessage(e));
  }
  return path;
}

/**
 * Envia a mídia ao lead pela conexão da conversa e grava a mensagem no chat
 * (source 'agent', media_url com o caminho no wa-media). Nunca lança: erros
 * voltam em { ok: false, error }. A mensagem que falhou também fica gravada
 * (status 'failed') para o atendente ver.
 */
export async function sendAgentMedia(admin: SupabaseClient, input: SendAgentMediaInput): Promise<SendAgentMediaResult> {
  const { ctx, media } = input;
  const conn = ctx.connection;
  const orgId = ctx.conversation.organization_id;
  if (orgId !== input.organizationId || media.organization_id !== orgId) return { ok: false, error: 'mídia de outra organização' };
  if (!conn) return { ok: false, error: 'conversa sem número vinculado' };
  if (conn.status !== 'connected') return { ok: false, error: 'número desconectado' };
  const scope = { organizationId: orgId, conversationId: ctx.conversation.id };
  let receipt: Awaited<ReturnType<typeof reserveMediaDelivery>> = null;
  let dispatched = false;
  try {
    if (media.send_once_per_conversation !== false) {
      const previous = await deliveredMediaNames(admin, scope, [media], ctx.conversation.ai_state?.midias_enviadas ?? []);
      if (previous.has(normalizeKeyword(media.name))) return { ok: true, skipped: true, messageId: null, providerMessageId: null, mediaPath: '' };
      receipt = await reserveMediaDelivery(admin, scope, media);
      if (!receipt) return { ok: true, skipped: true, messageId: null, providerMessageId: null, mediaPath: '' };
    }
    const mediaPath = await ensureAgentMediaOutbox(admin, orgId, media);
    const result = await sendOutboxMedia(admin, ctx, { mediaPath, kind: media.kind, mime: media.mime, caption: input.caption,
      fileName: originalFileName(media.storage_path, media.name), beforeDispatch: async () => {
        await input.beforeDispatch?.();
        dispatched = true;
      } });
    if (receipt) {
      if (result.ok) await finishMediaDelivery(admin, receipt, result.skipped ? 'failed' : 'sent');
      else if (result.retryable || !dispatched) await finishMediaDelivery(admin, receipt, 'failed');
    }
    return result;
  } catch (e) {
    // A crash/timeout after dispatch may already have delivered the media. Keep
    // the reservation, including when recording the successful result failed.
    if (receipt && !dispatched) {
      try { await finishMediaDelivery(admin, receipt, 'failed'); } catch { /* reservation stays conservative */ }
    }
    return { ok: false, error: errorMessage(e) };
  }
}

export async function sendOutboxMedia(admin: SupabaseClient, ctx: ConversationContext, file: {
  mediaPath: string; kind: OutboundMediaKind; mime: string | null; fileName: string; caption?: string; transcript?: string;
  beforeDispatch?: () => Promise<void>;
}): Promise<SendAgentMediaResult> {
  const { mediaPath, kind, fileName } = file;
  if ([file.caption, file.transcript].some(value => value && internalOutputReason(value))) {
    return { ok: false, error: 'Mídia bloqueada por conter instrução interna.' };
  }
  const orgId = ctx.conversation.organization_id;
  const conn = ctx.connection;
  if (!conn || conn.status !== 'connected' || !mediaPath.startsWith(orgId + '/out/')) return { ok: false, error: 'Conexão ou caminho de mídia inválido.' };
  const to = ctx.conversation.wa_phone;
  const caption = (file.caption ?? '').trim();
  let signedUrl: string;
  try {
    const { data: signed, error: signErr } = await admin.storage
      .from(WA_MEDIA_BUCKET)
      .createSignedUrl(mediaPath, SIGNED_URL_SECONDS);
    if (signErr || !signed?.signedUrl) throw new Error(`Falha ao assinar a URL: ${signErr?.message ?? ''}`);
    signedUrl = signed.signedUrl;
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }

  let result: SendResult;
  let cooldown: Awaited<ReturnType<typeof claimMediaCooldown>> | undefined;
  try {
    cooldown = await claimMediaCooldown(admin, { organizationId: orgId, conversationId: ctx.conversation.id, mediaPath });
    await beginMediaCooldownDispatch(admin, cooldown);
    await file.beforeDispatch?.();
  } catch (e) {
    if (cooldown) {
      try { await releaseMediaCooldown(admin, cooldown); } catch { /* conservatively keeps the current lease until expiry */ }
    }
    if (e instanceof MediaCooldownError) return { ok: true, skipped: true, messageId: null, providerMessageId: null, mediaPath };
    return { ok: false, error: errorMessage(e), retryable: true };
  }
  try {
    result = await getProvider(conn).sendMedia({
      to,
      media: signedUrl,
      kind,
      mimeType: file.mime || undefined,
      fileName,
      caption: caption || undefined,
    });
  } catch (e) {
    result = { ok: false, error: errorMessage(e) };
  }
  await finishMediaCooldownDispatch(admin, cooldown, result);

  let messageId: string | null = null;
  try {
    const msg = await recordOutboundMessage(admin, {
      orgId,
      conversationId: ctx.conversation.id,
      text: caption,
      providerMessageId: result.providerMessageId ?? null,
      fromPhone: conn.phone_number,
      toPhone: to,
      sentBy: null,
      source: 'agent',
      status: result.ok ? 'sent' : 'failed',
      error: result.ok ? null : result.error || 'falha no envio',
      mediaType: kind,
      mediaUrl: mediaPath,
      mediaMime: file.mime ?? null,
      transcription: file.transcript,
    });
    messageId = msg?.id ?? null;
    if (result.ok) {
      await replicateOutboundToSiblings(admin, conn, {
        toPhone: to,
        text: msg.body,
        providerMessageId: result.providerMessageId ?? null,
        mediaType: kind,
      });
    }
  } catch (e) {
    console.error('[wa-agents] gravar mídia do agente falhou:', errorMessage(e));
  }

  if (!result.ok) return { ok: false, error: result.error || 'falha no envio',
    retryable: !!result.raw && !result.providerMessageId && !/timeout|timed.?out|network|rede|ECONN|ETIMEDOUT/iu.test(result.error ?? '') };
  return { ok: true, messageId, providerMessageId: result.providerMessageId ?? null, mediaPath };
}
