/**
 * POST /api/whatsapp/forward -> encaminha mensagens do chat para outros contatos
 * (estilo "encaminhar" do WhatsApp), reenviando texto ou mídia pelo provedor.
 *
 * Body:
 *   { messageIds: string[],                       // ids em wa_messages (da org), 1..10
 *     targets: [{ phone: string, connectionId?: string }] }  // 1..20 destinos
 *
 * Cada destino recebe as mensagens em ordem cronológica. Mídia é reenviada a
 * partir do MESMO arquivo no Storage (URL assinada curta); a mensagem nova
 * aponta pro mesmo caminho. Texto vai como texto. Cartão de contato vai como
 * texto (nome + telefone). Sem conexão conectada pro destino = erro só dele.
 */
import { requireOrgUser, json } from '@/lib/whatsapp/api';
import { filterAllowedConnections, getVisibilityRules } from '@/lib/permissions/server';
import {
  getConnectionsByOrg,
  ensureConversation,
  getGroupConversation,
  getWaGroupsEnabled,
  recordOutboundMessage,
  replicateOutboundToSiblings,
  type WaConnectionRow,
  type WaConversationRow,
} from '@/lib/whatsapp/service';
import { getProvider, type SendResult } from '@/lib/whatsapp';
import { outboundKindFromMediaType } from '@/lib/whatsapp/quote';
import { normalizePhoneE164 } from '@/lib/phone';

export const runtime = 'nodejs';

const MAX_MESSAGES = 10;
const MAX_TARGETS = 20;

interface ForwardableRow {
  id: string;
  body: string | null;
  media_type: string | null;
  media_mime: string | null;
  media_url: string | null;
  created_at: string;
}

/** Nome "humano" do arquivo a partir do caminho no Storage (sem o prefixo de timestamp). */
function fileNameFromPath(path: string): string {
  const base = path.split('/').pop() || 'arquivo';
  return base.replace(/^\d{10,}_/, '') || 'arquivo';
}

export async function POST(req: Request) {
  const auth = await requireOrgUser();
  if (!auth.ok) return auth.response;
  const orgId = auth.user.organizationId;

  let body: { messageIds?: unknown; targets?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'JSON inválido' }, 400);
  }

  const messageIds = Array.isArray(body.messageIds)
    ? Array.from(new Set(body.messageIds.filter((v): v is string => typeof v === 'string' && v.length > 0)))
    : [];
  const targetsRaw = Array.isArray(body.targets)
    ? (body.targets as Array<{ phone?: unknown; connectionId?: unknown; conversationId?: unknown }>)
    : [];
  const targets = targetsRaw
    .map(t => ({
      phone: normalizePhoneE164(typeof t?.phone === 'string' ? t.phone : ''),
      connectionId: typeof t?.connectionId === 'string' ? t.connectionId.trim() : '',
      // GRUPO: destino pelo id da conversa (grupo não tem telefone)
      conversationId: typeof t?.conversationId === 'string' ? t.conversationId.trim() : '',
    }))
    .filter(t => !!t.phone || !!t.conversationId);

  if (messageIds.length === 0) return json({ error: 'Escolha pelo menos uma mensagem para encaminhar' }, 400);
  if (messageIds.length > MAX_MESSAGES) return json({ error: `Encaminhe no máximo ${MAX_MESSAGES} mensagens por vez` }, 400);
  if (targets.length === 0) return json({ error: 'Escolha pelo menos um contato para receber' }, 400);
  if (targets.length > MAX_TARGETS) return json({ error: `Encaminhe para no máximo ${MAX_TARGETS} contatos por vez` }, 400);

  // Mensagens SEMPRE da própria org (nunca cross-tenant), em ordem cronológica
  const { data: rows, error: msgErr } = await auth.admin
    .from('wa_messages')
    .select('id, body, media_type, media_mime, media_url, created_at')
    .eq('organization_id', orgId)
    .in('id', messageIds)
    .order('created_at', { ascending: true });
  if (msgErr) return json({ error: msgErr.message }, 500);
  const messages = (rows ?? []) as ForwardableRow[];
  if (messages.length === 0) return json({ error: 'Mensagens não encontradas' }, 404);

  // Permissões de visualização: encaminhar só pelos números permitidos
  const vis = await getVisibilityRules(auth.admin, orgId, auth.user.id, auth.user.role);
  const connections = filterAllowedConnections(vis, await getConnectionsByOrg(auth.admin, orgId));
  const connected = connections.filter(c => c.status === 'connected');
  const pickConnection = (connectionId: string): { conn: WaConnectionRow | null; error?: string } => {
    if (connectionId) {
      const c = connections.find(x => x.id === connectionId);
      if (!c) return { conn: null, error: 'Número selecionado não encontrado' };
      if (c.status !== 'connected') return { conn: null, error: 'O número desta conversa está desconectado' };
      return { conn: c };
    }
    const c = connected[0] ?? null;
    return c ? { conn: c } : { conn: null, error: 'WhatsApp não conectado' };
  };

  // URLs assinadas (10 min) de cada mídia, uma vez só, reaproveitadas em todos os destinos
  const signedByPath = new Map<string, string>();
  const mediaPaths = messages
    .map(m => m.media_url)
    .filter((p): p is string => typeof p === 'string' && p.length > 0 && !p.startsWith('http'));
  if (mediaPaths.length > 0) {
    const { data: signed } = await auth.admin.storage.from('wa-media').createSignedUrls(mediaPaths, 600);
    for (const s of signed ?? []) if (s.path && s.signedUrl) signedByPath.set(s.path, s.signedUrl);
  }

  const results: Array<{
    phone: string;
    connectionId: string | null;
    /** GRUPO: id da conversa de destino (o modal casa o nome por aqui) */
    conversationId?: string | null;
    ok: boolean;
    sent: number;
    failed: number;
    error?: string;
  }> = [];
  const groupsEnabled = targets.some(t => t.conversationId) ? await getWaGroupsEnabled(auth.admin, orgId) : false;

  for (const target of targets) {
    // GRUPO: conversa já existe; sai pelo número dela (precisa ser via QR Code)
    let group: WaConversationRow | null = null;
    let picked: { conn: WaConnectionRow | null; error?: string };
    if (target.conversationId) {
      group = groupsEnabled ? await getGroupConversation(auth.admin, orgId, target.conversationId) : null;
      const gConn = group?.connection_id ? connections.find(c => c.id === group?.connection_id) ?? null : null;
      picked = !group
        ? { conn: null, error: groupsEnabled ? 'Grupo não encontrado' : 'Grupos do WhatsApp estão desligados' }
        : !gConn || gConn.status !== 'connected'
          ? { conn: null, error: 'O número deste grupo está desconectado' }
          : { conn: gConn };
    } else {
      picked = pickConnection(target.connectionId);
    }
    const targetPhone = group ? group.group_jid || group.wa_phone : target.phone;
    if (!picked.conn) {
      results.push({
        phone: targetPhone,
        connectionId: target.connectionId || null,
        conversationId: target.conversationId || null,
        ok: false,
        sent: 0,
        failed: messages.length,
        error: picked.error,
      });
      continue;
    }
    const conn = picked.conn;
    let sent = 0;
    let failed = 0;
    let firstError: string | undefined;
    try {
      const conv = group ?? (await ensureConversation(auth.admin, orgId, conn.id, target.phone));
      const provider = getProvider(conn);

      for (const m of messages) {
        const kind = outboundKindFromMediaType(m.media_type);
        const mediaPath = m.media_url && !m.media_url.startsWith('http') ? m.media_url : null;
        const signedUrl = mediaPath ? signedByPath.get(mediaPath) : undefined;
        const text = (m.body ?? '').trim();

        let result: SendResult;
        if (kind && signedUrl) {
          result = await provider.sendMedia({
            to: targetPhone,
            media: signedUrl,
            kind,
            mimeType: m.media_mime ?? undefined,
            fileName: fileNameFromPath(mediaPath as string),
            caption: text || undefined,
            isGroup: !!group,
          });
        } else if (text) {
          result = await provider.sendText({ to: targetPhone, text, isGroup: !!group });
        } else {
          failed += 1;
          firstError = firstError ?? 'Mensagem sem conteúdo para encaminhar (mídia indisponível)';
          continue;
        }

        const recorded = await recordOutboundMessage(auth.admin, {
          orgId,
          conversationId: conv.id,
          text,
          providerMessageId: result.providerMessageId,
          fromPhone: conn.phone_number,
          toPhone: targetPhone,
          sentBy: auth.user.id,
          source: 'crm',
          status: result.ok ? 'sent' : 'failed',
          error: result.ok ? null : result.error,
          mediaType: kind && signedUrl ? m.media_type : null,
          mediaUrl: kind && signedUrl ? mediaPath : null,
          mediaMime: kind && signedUrl ? m.media_mime : null,
          forwarded: true,
        });

        if (result.ok) {
          sent += 1;
          if (!group) {
            await replicateOutboundToSiblings(auth.admin, conn, {
              toPhone: targetPhone,
              text: recorded.body,
              providerMessageId: result.providerMessageId,
              mediaType: kind && signedUrl ? m.media_type : null,
            });
          }
        } else {
          failed += 1;
          firstError = firstError ?? (result.error || 'Falha no envio');
        }
      }
    } catch (e) {
      failed = messages.length - sent;
      firstError = firstError ?? (e as Error).message;
    }
    results.push({
      phone: targetPhone,
      connectionId: conn.id,
      conversationId: group?.id ?? null,
      ok: failed === 0,
      sent,
      failed,
      ...(firstError ? { error: firstError } : {}),
    });
  }

  const ok = results.every(r => r.ok);
  return json({ ok, results }, ok ? 200 : 207);
}
