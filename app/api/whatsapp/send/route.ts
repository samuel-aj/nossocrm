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
import {
  getConnectionByOrg,
  getConnectionByIdForOrg,
  ensureConversation,
  recordOutboundMessage,
  replicateOutboundToSiblings,
} from '@/lib/whatsapp/service';
import { getProvider, type OutboundMediaKind } from '@/lib/whatsapp';
import { normalizePhoneE164 } from '@/lib/phone';

const MEDIA_KINDS: OutboundMediaKind[] = ['image', 'video', 'document', 'audio', 'sticker'];

export async function POST(req: Request) {
  const auth = await requireOrgUser();
  if (!auth.ok) return auth.response;

  let body: {
    to?: string;
    text?: string;
    /** Multi-número: qual conexão envia (omitido = a padrão da org) */
    connectionId?: string;
    media?: { path?: string; kind?: string; mimeType?: string; fileName?: string };
    /**
     * Modelo aprovado da Meta (fora da janela de 24h só ele passa). `text` é
     * o corpo já preenchido, gravado no chat; `params` vão nos {{n}} do modelo.
     */
    template?: { name?: string; language?: string; params?: string[] };
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'JSON inválido' }, 400);
  }
  const to = normalizePhoneE164(body.to || '');
  const text = (body.text || '').trim();
  const media = body.media;
  const mediaKind = media?.kind as OutboundMediaKind | undefined;
  const templateName = (body.template?.name || '').trim();

  if (!to) return json({ error: 'to é obrigatório' }, 400);
  if (!text && !media && !templateName) return json({ error: 'text ou media é obrigatório' }, 400);
  if (media && (!media.path || !mediaKind || !MEDIA_KINDS.includes(mediaKind))) {
    return json({ error: 'media.path e media.kind (image|video|document|audio|sticker) são obrigatórios' }, 400);
  }

  // Multi-número: com connectionId envia pelo número ESCOLHIDO (validado
  // contra a org); sem, cai na conexão padrão (compat).
  const connectionId = (body.connectionId || '').trim();
  const conn = connectionId
    ? await getConnectionByIdForOrg(auth.admin, auth.user.organizationId, connectionId)
    : await getConnectionByOrg(auth.admin, auth.user.organizationId);
  if (connectionId && !conn) {
    return json({ error: 'Número selecionado não encontrado. Atualize a página e tente de novo.' }, 404);
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

  const conv = await ensureConversation(auth.admin, auth.user.organizationId, conn.id, to);
  const provider = getProvider(conn);

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
      caption: text || undefined,
    });
  } else if (templateName && provider.sendTemplate) {
    const params = (body.template?.params ?? []).map(p => String(p ?? '').trim() || '-');
    result = await provider.sendTemplate({
      to,
      name: templateName,
      language: (body.template?.language || 'pt_BR').trim(),
      components: params.length
        ? [{ type: 'body', parameters: params.map(p => ({ type: 'text', text: p })) }]
        : undefined,
    });
  } else {
    // provedor sem envio de modelo (QR/Evolution): vai o texto já preenchido
    result = await provider.sendText({ to, text: text || `[Modelo: ${templateName}]` });
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
  });

  // Mesmo número em outra org: o envio aparece lá também
  if (result.ok) {
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
