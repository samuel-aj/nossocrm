/**
 * Envio de uma mídia cadastrada do agente pelo WhatsApp (ferramenta
 * enviar_midia). O arquivo é copiado do bucket privado wa-agent-files para o
 * wa-media (pasta out da org), assim o chat exibe a mensagem como qualquer
 * mídia enviada; a Evolution/Meta baixa por uma URL assinada curta. SERVER.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { getProvider, type OutboundMediaKind, type SendResult } from '@/lib/whatsapp';
import { recordOutboundMessage, replicateOutboundToSiblings } from '@/lib/whatsapp/service';
import type { ConversationContext } from './context';
import { errorMessage } from './errors';
import { originalFileName, sanitizeStorageFileName } from './files';
import { WA_AGENT_FILES_BUCKET, type AgentMediaRow, type AgentRow } from './types';

export const WA_MEDIA_BUCKET = 'wa-media';
/** Validade da URL assinada entregue ao provedor (segundos). */
const SIGNED_URL_SECONDS = 600;

export type SendAgentMediaInput = {
  organizationId: string;
  agent: Pick<AgentRow, 'id' | 'name'>;
  ctx: ConversationContext;
  media: AgentMediaRow;
  caption?: string;
};

export type SendAgentMediaResult =
  | { ok: true; messageId: string | null; providerMessageId: string | null; mediaPath: string }
  | { ok: false; error: string };

/** Extensão do arquivo (com ponto) ou ''. */
function fileExtension(name: string): string {
  const m = /\.[a-zA-Z0-9]{1,8}$/.exec(name);
  return m ? m[0].toLowerCase() : '';
}

/**
 * Copia o arquivo do bucket wa-agent-files para wa-media/${orgId}/out/... e
 * devolve o caminho novo. Lança em falha.
 */
export async function copyAgentMediaToOutbox(
  admin: SupabaseClient,
  organizationId: string,
  media: AgentMediaRow
): Promise<string> {
  if (!media.storage_path.startsWith(`${organizationId}/`)) throw new Error('Caminho do arquivo inválido');
  const { data: blob, error: dlError } = await admin.storage.from(WA_AGENT_FILES_BUCKET).download(media.storage_path);
  if (dlError || !blob) throw new Error(`Falha ao ler a mídia: ${dlError?.message ?? 'arquivo não encontrado'}`);

  const original = originalFileName(media.storage_path, media.name);
  const ext = fileExtension(original);
  const safeName = sanitizeStorageFileName(ext && !media.name.toLowerCase().endsWith(ext) ? `${media.name}${ext}` : media.name);
  const path = `${organizationId}/out/${Date.now()}_agente_${safeName}`;
  const { error: upError } = await admin.storage
    .from(WA_MEDIA_BUCKET)
    .upload(path, blob, { contentType: media.mime || blob.type || undefined, upsert: false });
  if (upError) throw new Error(`Falha ao preparar a mídia: ${upError.message}`);
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
  const to = ctx.conversation.wa_phone;
  const caption = (input.caption ?? '').trim();

  let mediaPath: string;
  let signedUrl: string;
  try {
    mediaPath = await copyAgentMediaToOutbox(admin, orgId, media);
    const { data: signed, error: signErr } = await admin.storage
      .from(WA_MEDIA_BUCKET)
      .createSignedUrl(mediaPath, SIGNED_URL_SECONDS);
    if (signErr || !signed?.signedUrl) throw new Error(`Falha ao assinar a URL: ${signErr?.message ?? ''}`);
    signedUrl = signed.signedUrl;
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }

  const kind = media.kind as OutboundMediaKind;
  const fileName = originalFileName(media.storage_path, media.name);
  let result: SendResult;
  try {
    result = await getProvider(conn).sendMedia({
      to,
      media: signedUrl,
      kind,
      mimeType: media.mime || undefined,
      fileName,
      caption: caption || undefined,
    });
  } catch (e) {
    result = { ok: false, error: errorMessage(e) };
  }

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
      mediaMime: media.mime ?? null,
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

  if (!result.ok) return { ok: false, error: result.error || 'falha no envio' };
  return { ok: true, messageId, providerMessageId: result.providerMessageId ?? null, mediaPath };
}
