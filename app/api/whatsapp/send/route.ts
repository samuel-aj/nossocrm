import { resolveTemplateComponents } from '@/lib/whatsapp/templateMedia';
/**
 * POST /api/whatsapp/send -> envia texto e/ou mídia e persiste (out).
 *
 * Body:
 *   { to: string, text?: string,
 *     media?: { path: string, kind: 'image'|'video'|'document'|'audio'|'sticker',
 *               mimeType?: string, fileName?: string } }
 *
 * Mídia: o arquivo já deve estar no bucket wa-media (via /api/whatsapp/upload).
 * Geramos uma URL assinada curta e passamos pra Evolution baixar de lá.
 */
import { requireOrgUser, json } from '@/lib/whatsapp/api';
import { connectionAllowed, getVisibilityRules } from '@/lib/permissions/server';
import {
  getConnectionByOrg,
  getConnectionByIdForOrg,
  ensureConversation,
  getGroupConversation,
  getQuotableMessage,
  getWaGroupsEnabled,
  recordOutboundMessage,
  replicateOutboundToSiblings,
  type WaConnectionRow,
  type WaConversationRow,
} from '@/lib/whatsapp/service';
import { getProvider, type OutboundMediaKind, type QuotedRef } from '@/lib/whatsapp';
import { clampQuote, quotedPreviewText, snapshotFromMessage } from '@/lib/whatsapp/quote';
import { z } from 'zod';
import { conversationAllowed } from '@/lib/permissions/conversationAccess';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { getGroupParticipants } from '@/lib/whatsapp/groups';
import { resolveGroupMentions, type GroupMention } from '@/lib/whatsapp/groupParticipants';
import { normalizePhoneE164 } from '@/lib/phone';

const MEDIA_KINDS: OutboundMediaKind[] = ['image', 'video', 'document', 'audio', 'sticker'];

export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);
  const auth = await requireOrgUser();
  if (!auth.ok) return auth.response;

  let body: {
    to?: string;
    mentions?: GroupMention[];
    text?: string;
    /** Multi-número: qual conexão envia (omitido = a padrão da org) */
    connectionId?: string;
    media?: { path?: string; kind?: string; mimeType?: string; fileName?: string };
    /**
     * Modelo aprovado da Meta (fora da janela de 24h só ele passa). `text` é
     * o corpo já preenchido, gravado no chat; `params` vão nos {{n}} do modelo.
     */
    template?: { name?: string; language?: string; params?: string[] };
    /** Responder: id (wa_messages) da mensagem citada — precisa ser deste mesmo telefone */
    replyTo?: string;
    /** GRUPO: id da conversa de grupo (sem `to`; a mensagem vai pro JID do grupo) */
    conversationId?: string;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'JSON inválido' }, 400);
  }
  if (!body || typeof body !== 'object' || (body.text !== undefined && typeof body.text !== 'string')) return json({ error: 'Mensagem inválida' }, 400);
  const parsedMentions = z.array(z.object({ id: z.string().max(100), start: z.number().int().min(0), end: z.number().int().min(1) }).strict()).max(100).safeParse(body.mentions ?? []);
  if (!parsedMentions.success) return json({ error: 'Menções inválidas' }, 400);
  let to = normalizePhoneE164(body.to || '');
  const text = body.text || ''; // span offsets refer to the untrimmed text
  let wireText = text;
  let mentioned: string[] = [];
  const media = body.media;
  const mediaKind = media?.kind as OutboundMediaKind | undefined;
  const templateName = (body.template?.name || '').trim();
  const replyToId = (body.replyTo || '').trim();
  const groupConversationId = (body.conversationId || '').trim();

  if (parsedMentions.data.length && !groupConversationId) return json({ error: 'Menções estão disponíveis somente em grupos.' }, 400);
  if (!to && !groupConversationId) return json({ error: 'to é obrigatório' }, 400);
  if (!text.trim() && !media && !templateName) return json({ error: 'text ou media é obrigatório' }, 400);
  if (media && (!media.path || !mediaKind || !MEDIA_KINDS.includes(mediaKind))) {
    return json({ error: 'media.path e media.kind (image|video|document|audio|sticker) são obrigatórios' }, 400);
  }

  // Permissões de visualização: só envia por número PERMITIDO pro usuário
  const vis = await getVisibilityRules(auth.admin, auth.user.organizationId, auth.user.id, auth.user.role);

  let conn: WaConnectionRow | null = null;
  let conv: WaConversationRow;
  let group: WaConversationRow | null = null;
  if (groupConversationId) {
    // GRUPO: a conversa já existe (criada pelo webhook); sai pelo número do
    // grupo, que precisa ser via QR Code (a API oficial da Meta não tem grupos).
    if (!(await getWaGroupsEnabled(auth.admin, auth.user.organizationId))) {
      return json({ error: 'Grupos do WhatsApp estão desligados nesta organização.' }, 403);
    }
    if (!(await conversationAllowed(auth.admin, auth.user, { id: groupConversationId }))) return json({ error: 'Grupo indisponível' }, 404);
    group = await getGroupConversation(auth.admin, auth.user.organizationId, groupConversationId);
    if (!group) return json({ error: 'Grupo não encontrado.' }, 404);
    conn = group.connection_id
      ? await getConnectionByIdForOrg(auth.admin, auth.user.organizationId, group.connection_id)
      : null;
    if (!conn || conn.status !== 'connected') {
      return json({ error: 'O número deste grupo está desconectado. Reconecte na aba Conexão.' }, 409);
    }
    if (!connectionAllowed(vis, conn.id)) {
      return json({ error: 'Você não tem acesso a este número.' }, 403);
    }
    // Meta: grupo da Groups API (recipient_type "group"); Evolution: JID do grupo
    to = group.group_jid || group.wa_phone;
    conv = group;
  } else {
    // Multi-número: com connectionId envia pelo número ESCOLHIDO (validado
    // contra a org); sem, cai na conexão padrão (compat).
    const connectionId = (body.connectionId || '').trim();
    conn = connectionId
      ? await getConnectionByIdForOrg(auth.admin, auth.user.organizationId, connectionId)
      : await getConnectionByOrg(auth.admin, auth.user.organizationId);
    if (connectionId && !conn) {
      return json({ error: 'Número selecionado não encontrado. Atualize a página e tente de novo.' }, 404);
    }
    if (conn && !connectionAllowed(vis, conn.id)) {
      return json({ error: 'Você não tem acesso a este número.' }, 403);
    }
    // Sem conexão ATIVA não tenta enviar: senão a Evolution devolve um 404 cru
    // de instância inexistente, que confunde o usuário
    if (!conn || conn.status !== 'connected') {
      return json(
        {
          error: connectionId
            ? 'O número selecionado está desconectado. Escolha outro número ou reconecte na aba Conexão.'
            : 'WhatsApp não conectado. Conecte o número do escritório na aba Conexão antes de enviar.',
        },
        409
      );
    }
    conv = await ensureConversation(auth.admin, auth.user.organizationId, conn.id, to);
  }
  if (parsedMentions.data.length) {
    if (!group || templateName || (media && !['image', 'video', 'document'].includes(mediaKind || ''))) return json({ error: 'Menções estão disponíveis em textos e legendas de grupos.' }, 400);
    const members = await getGroupParticipants(conn, to);
    if (!members.ok) return json({ error: members.error }, 422);
    try {
      const resolved = resolveGroupMentions(text, parsedMentions.data, members.participants);
      wireText = resolved.text;
      mentioned = resolved.mentioned;
    } catch (error) { return json({ error: (error as Error).message }, 400); }
  }
  const provider = getProvider(conn);

  // RESPONDER: a mensagem citada tem que ser da org e deste telefone. Sem id
  // no provedor (ex.: envio que falhou) a citação vai só no CRM, não no
  // WhatsApp do contato. Modelo (template) não aceita citação na Meta.
  const quotedRow = replyToId ? await getQuotableMessage(auth.admin, auth.user.organizationId, replyToId, to) : null;
  if (replyToId && !quotedRow) {
    return json({ error: 'A mensagem que você está respondendo não está mais nesta conversa.' }, 400);
  }
  const quotedSnapshot = quotedRow ? snapshotFromMessage(quotedRow) : null;
  const quoted: QuotedRef | undefined =
    quotedRow?.evolution_message_id && !templateName
      ? {
          providerMessageId: quotedRow.evolution_message_id,
          fromMe: quotedRow.direction === 'out',
          remotePhone: to,
          text: clampQuote(quotedPreviewText(quotedSnapshot)),
          // grupo: a citação aponta pro JID do grupo e diz quem escreveu a original
          ...(group
            ? {
                remoteJid: to,
                participantPhone:
                  (quotedRow.direction === 'in' ? quotedRow.from_phone : conn.phone_number) ?? undefined,
              }
            : {}),
        }
      : undefined;

  if (templateName && !provider.sendTemplate) {
    const { data: template, error } = await auth.admin.from('message_templates').select('header_type')
      .eq('organization_id', auth.user.organizationId).eq('connection_id', conn.id)
      .eq('meta_name', templateName).eq('language', (body.template?.language || 'pt_BR').trim()).maybeSingle();
    if (error || template?.header_type) return json({ error: 'Este modelo com mídia exige conexão Meta Cloud.' }, 422);
  }
  let result;
  const mediaPath = media?.path ?? '';
  if (media && mediaKind) {
    // segurança: só serve arquivos da própria organização
    if (!mediaPath.startsWith(`${auth.user.organizationId}/`)) {
      return json({ error: 'media.path inválido' }, 403);
    }
    const { data: signed, error: signErr } = await auth.admin.storage
      .from('wa-media')
      .createSignedUrl(mediaPath, 600);
    if (signErr || !signed?.signedUrl) {
      return json({ error: `Arquivo não encontrado no Storage: ${signErr?.message ?? ''}` }, 400);
    }
    result = await provider.sendMedia({
      to,
      media: signed.signedUrl,
      kind: mediaKind,
      mimeType: media.mimeType,
      fileName: media.fileName,
      caption: wireText || undefined,
      mentioned,
      quoted,
      isGroup: !!group,
    });
  } else if (templateName && provider.sendTemplate) {
    const params = (body.template?.params ?? []).map(p => String(p ?? '').trim() || '-');
    const { data: tpl, error: tplError } = await auth.admin.from('message_templates').select('header_type,media_id,meta_status').eq('organization_id', auth.user.organizationId).eq('connection_id', conn.id).eq('meta_name', templateName).eq('language', (body.template?.language || 'pt_BR').trim()).maybeSingle();
    if (tplError || !tpl || tpl.meta_status !== 'APPROVED') return json({ error: 'Modelo não encontrado ou não aprovado para este número.' }, 422);
    let components;
    try { components = await resolveTemplateComponents(auth.admin, auth.user.organizationId, conn.id, tpl, params); }
    catch (error) { return json({ error: error instanceof Error ? error.message : 'Mídia inválida' }, 422); }
    result = await provider.sendTemplate({
      to,
      isGroup: !!group,
      name: templateName,
      language: (body.template?.language || 'pt_BR').trim(),
      components,
    });
  } else {
    // provedor sem envio de modelo (QR/Evolution): vai o texto já preenchido
    result = await provider.sendText({ to, text: wireText || `[Modelo: ${templateName}]`, quoted, isGroup: !!group, mentioned });
  }

  const message = await recordOutboundMessage(auth.admin, {
    orgId: auth.user.organizationId,
    conversationId: conv.id,
    text: text || (templateName ? `[Modelo: ${templateName}]` : ''),
    providerMessageId: result.providerMessageId,
    fromPhone: conn.phone_number,
    toPhone: to,
    sentBy: auth.user.id,
    status: result.ok ? 'sent' : 'failed',
    error: result.ok ? null : result.error,
    mediaType: media ? mediaKind : null,
    mediaUrl: media ? mediaPath : null,
    mediaMime: media?.mimeType ?? null,
    ...(quotedRow ? { quotedMessageId: quotedRow.id, quoted: quotedSnapshot } : {}),
  });

  // Mesmo número em outra org: o envio aparece lá também (grupos não entram)
  if (result.ok && !group) {
    await replicateOutboundToSiblings(auth.admin, conn, {
      toPhone: to,
      text: message.body,
      providerMessageId: result.providerMessageId,
      mediaType: media ? mediaKind : null,
    });
  }

  if (!result.ok) {
    return json({ ok: false, error: result.error || 'Falha no envio', message }, 502);
  }
  return json({ ok: true, message });
}
