/**
 * GET /api/whatsapp/messages?phone=<telefone>[&connectionId=...]
 * GET /api/whatsapp/messages?conversationId=<id>          (grupos)
 * Retorna a conversa de WhatsApp daquele telefone (na org) + as mensagens.
 * Usado pelo chat dentro do card do lead e pela página Chats.
 *
 * connectionId restringe a UM número conectado (página Chats com conversas
 * separadas por número): só a conversa e as mensagens daquele número, e só
 * elas são marcadas como lidas. Sem o parâmetro, visão unificada do contato
 * (card do lead).
 *
 * conversationId: GRUPO do WhatsApp (não tem telefone; a conversa é o grupo).
 * Só responde com a chave "Grupos" da org ligada.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { requireOrgUser, json } from '@/lib/whatsapp/api';
import { getConnectionsByOrg, getGroupConversation, getWaGroupsEnabled } from '@/lib/whatsapp/service';
import { connectionAllowed, filterAllowedConnections, filterConversationsByOwner, getVisibilityRules } from '@/lib/permissions/server';
import { brPhoneVariants, normalizePhoneE164 } from '@/lib/phone';
import { getConversationAiInfo, getConversationBotInfo } from '@/lib/wa-agents/conversation';

const MESSAGE_COLUMNS =
  'id, conversation_id, direction, status, body, media_type, media_mime, media_url, from_phone, to_phone, wa_timestamp, created_at, sent_by, source, error, transcription, quoted_message_id, quoted, forwarded, sender_name, edited_at';

/**
 * As 300 mensagens mais RECENTES das conversas (desc + limit, revertidas
 * p/ ordem cronológica — asc + limit congelaria o chat nas 300 primeiras),
 * com o número de origem anotado e as URLs de mídia assinadas (1h). Também
 * zera o contador de não lidas (visualizou = leu).
 */
async function loadMessages(
  admin: SupabaseClient,
  convs: Array<{ id: string; connection_id: string | null }>
): Promise<unknown[]> {
  if (convs.length === 0) return [];
  const connByConv = new Map(convs.map(c => [c.id, c.connection_id]));
  const { data } = await admin
    .from('wa_messages')
    .select(MESSAGE_COLUMNS)
    .in('conversation_id', convs.map(c => c.id))
    .order('created_at', { ascending: false })
    .limit(300);
  // Linhas SEM conteúdo nenhum (sobras de eventos de protocolo, como fixar
  // mensagem, gravadas antes da correção no webhook): não viram bolha — o
  // chat mostrava "[mensagem não suportada]" e parecia um erro.
  const rows = ((data || []) as Array<Record<string, unknown>>)
    .reverse()
    .filter(r => r.body || r.media_type || r.transcription || r.quoted);
  // Anota de QUAL número cada mensagem veio (divisórias por número no chat)
  for (const r of rows) {
    r.connection_id = connByConv.get(r.conversation_id as string) ?? null;
    delete r.conversation_id;
  }

  // Nome de quem enviou pelo CRM (sent_by -> profiles): o chat mostra
  // "Fulano · CRM" na bolha. Só leitura; mensagens de robô/IA/API/celular
  // não têm sent_by e nunca são atribuídas a um usuário.
  const senderIds = Array.from(
    new Set(rows.map(r => r.sent_by).filter((v): v is string => typeof v === 'string' && !!v))
  );
  if (senderIds.length > 0) {
    const { data: perfis } = await admin
      .from('profiles')
      .select('id, name, first_name, last_name, nickname')
      .in('id', senderIds);
    const nomes = new Map(
      ((perfis ?? []) as Array<{ id: string; name: string | null; first_name: string | null; last_name: string | null; nickname: string | null }>).map(p => [
        p.id,
        (p.nickname ?? '').trim() ||
          `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() ||
          (p.name ?? '').trim() ||
          null,
      ])
    );
    for (const r of rows) {
      if (typeof r.sent_by === 'string') r.sent_by_name = nomes.get(r.sent_by) ?? null;
    }
  }

  // media_url guarda o CAMINHO no bucket privado wa-media — assina URLs de
  // leitura (1h) pro chat exibir imagem/vídeo/áudio/documento.
  const paths = rows
    .map(r => r.media_url)
    .filter((p): p is string => typeof p === 'string' && p.length > 0 && !p.startsWith('http'));
  if (paths.length > 0) {
    const { data: signed } = await admin.storage.from('wa-media').createSignedUrls(paths, 3600);
    const byPath = new Map((signed ?? []).filter(s => s.signedUrl).map(s => [s.path, s.signedUrl]));
    for (const r of rows) {
      const p = r.media_url;
      if (typeof p === 'string' && byPath.has(p)) r.media_url = byPath.get(p);
    }
  }

  // Visualizou = leu: zera o contador de não lidas (badge da página Chats)
  await admin
    .from('wa_conversations')
    .update({ unread_count: 0 })
    .in('id', convs.map(c => c.id))
    .gt('unread_count', 0);

  return rows;
}

export async function GET(req: Request) {
  const auth = await requireOrgUser();
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const conversationId = (url.searchParams.get('conversationId') || '').trim();
  const phone = normalizePhoneE164(url.searchParams.get('phone') || '');
  if (!phone && !conversationId) return json({ error: 'phone é obrigatório' }, 400);
  const connectionId = url.searchParams.get('connectionId');

  // Multi-número: a conexão "padrão" (1ª conectada) mantém o contrato antigo;
  // senders lista os números conectados PERMITIDOS pro seletor de envio.
  const vis = await getVisibilityRules(auth.admin, auth.user.organizationId, auth.user.id, auth.user.role);
  const todas = await getConnectionsByOrg(auth.admin, auth.user.organizationId);
  const all = filterAllowedConnections(vis, todas);
  const conn = all.find(c => c.status === 'connected') ?? all[0] ?? null;
  const senders = all
    .filter(c => c.status === 'connected')
    .map(c => ({
      id: c.id,
      provider: c.provider,
      phoneNumber: c.phone_number,
      profileName: c.profile_name,
    }));
  // Rótulos de TODOS os números da org (inclui desconectados): as divisórias
  // por número do chat precisam nomear também conexões que já caíram.
  const numbers: Record<string, { phoneNumber: string | null; profileName: string | null }> = {};
  for (const c of all) numbers[c.id] = { phoneNumber: c.phone_number, profileName: c.profile_name };

  // WhatsApp DESCONECTADO => conversas ficam OCULTAS (guardadas no banco;
  // reconectar o mesmo número traz de volta). Nada é exibido nem marcado
  // como lido enquanto a conexão não estiver ativa.
  if (!conn || conn.status !== 'connected') {
    return json({
      connected: false,
      hasConnection: !!conn,
      provider: conn?.provider ?? null,
      senders,
      numbers,
      conversation: null,
      messages: [],
    });
  }

  // GRUPO: a conversa é o grupo; sem agente/robô e sem janela de 24 h
  // (grupos só existem em número via QR Code).
  if (conversationId) {
    if (!(await getWaGroupsEnabled(auth.admin, auth.user.organizationId))) {
      return json({ error: 'Grupos do WhatsApp estão desligados nesta organização' }, 404);
    }
    const group = await getGroupConversation(auth.admin, auth.user.organizationId, conversationId);
    if (!group) return json({ error: 'Grupo não encontrado' }, 404);
    if (!connectionAllowed(vis, group.connection_id ?? null)) {
      return json({ error: 'Grupo não encontrado' }, 404);
    }
    if (vis?.whatsapp.label_ids) {
      const { data: gl } = await auth.admin
        .from('wa_conversations')
        .select('label_ids')
        .eq('id', group.id)
        .maybeSingle();
      const ids = ((gl as { label_ids?: string[] | null } | null)?.label_ids ?? []) as string[];
      if (!ids.some(id => vis.whatsapp.label_ids!.includes(id))) {
        return json({ error: 'Grupo não encontrado' }, 404);
      }
    }
    const groupConn = all.find(c => c.id === group.connection_id) ?? null;
    const messages = await loadMessages(auth.admin, [{ id: group.id, connection_id: group.connection_id }]);
    return json({
      connected: groupConn ? groupConn.status === 'connected' : false,
      hasConnection: !!groupConn,
      provider: groupConn?.provider ?? conn.provider ?? null,
      senders,
      numbers,
      conversation: {
        id: group.id,
        connection_id: group.connection_id,
        wa_phone: group.wa_phone,
        wa_name: group.wa_name,
        contact_id: null,
        is_group: true,
        group_jid: group.group_jid ?? group.wa_phone,
        participants_count: group.participants_count ?? null,
        group_invite_link: group.group_invite_link ?? null,
        last_inbound_at: null,
      },
      ai: null,
      bot: null,
      messages,
    });
  }

  // Variantes BR do nono dígito: o JID do WhatsApp pode vir sem o 9 do
  // celular, criando conversa em outra grafia do MESMO número. Busca as duas
  // e junta as mensagens.
  const variants = brPhoneVariants(phone);
  let convQ = auth.admin
    .from('wa_conversations')
    .select('id, connection_id, wa_phone, wa_name, contact_id, last_message_at, unread_count, ai_status, ai_agent_id, ai_resume_at, ai_approval')
    .eq('organization_id', auth.user.organizationId)
    .in('wa_phone', variants.length ? variants : [phone]);
  // 'none' = só a conversa órfã (sem número conectado); ausente = unificada
  if (connectionId === 'none') {
    // conversa sem número: só sem restrição de números
    if (vis && vis.whatsapp.connection_ids !== null) return json({ error: 'Conversa não encontrada' }, 404);
    convQ = convQ.is('connection_id', null);
  } else if (connectionId) {
    if (!connectionAllowed(vis, connectionId)) return json({ error: 'Conversa não encontrada' }, 404);
    convQ = convQ.eq('connection_id', connectionId);
  } else if (vis && vis.whatsapp.connection_ids !== null) {
    convQ = convQ.in('connection_id', vis.whatsapp.connection_ids);
  }
  // Restrição por etiqueta: conversa sem etiqueta permitida não abre
  if (vis?.whatsapp.label_ids) convQ = convQ.overlaps('label_ids', vis.whatsapp.label_ids);
  const { data: convList } = await convQ;

  let convs = (convList ?? []) as Array<{
    id: string;
    connection_id: string | null;
    contact_id: string | null;
    ai_status?: string | null;
    ai_agent_id?: string | null;
    ai_resume_at?: string | null;
    ai_approval?: Record<string, unknown> | null;
  }>;
  // Restrição por RESPONSÁVEL (dono do lead do contato, como no filtro dos
  // Chats): conversa de responsável não permitido não abre nem carrega
  convs = await filterConversationsByOwner(auth.admin, auth.user.organizationId, vis, auth.user.id, convs);
  // Agente de IA: a conversa (deste contato) em que um agente já atuou
  const aiConv = convs.find(c => c.ai_status) ?? null;
  const conv = convs.find(c => c.contact_id) ?? convs[0] ?? null;

  const messages = await loadMessages(auth.admin, convs);

  // Janela de 24 h da API oficial (Meta): conta da ÚLTIMA MENSAGEM RECEBIDA do
  // contato, olhando todas as conversas consideradas (visão unificada por
  // telefone). Consulta leve; o chat mostra quanto falta e trava o envio comum
  // quando ela fecha.
  let lastInboundAt: string | null = null;
  if (convs.length > 0) {
    const { data: lastIn } = await auth.admin
      .from('wa_messages')
      .select('created_at, wa_timestamp')
      .in('conversation_id', convs.map(c => c.id))
      .eq('direction', 'in')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const row = (lastIn ?? null) as { created_at?: string | null; wa_timestamp?: string | null } | null;
    lastInboundAt = row?.wa_timestamp || row?.created_at || null;
  }

  // Agente de IA (externo via API pública ou nativo/beta): estado completo da faixa do chat
  const ai = aiConv
    ? await getConversationAiInfo(auth.admin, {
        id: aiConv.id,
        organization_id: auth.user.organizationId,
        ai_status: aiConv.ai_status ?? null,
        ai_agent_id: aiConv.ai_agent_id ?? null,
        ai_resume_at: aiConv.ai_resume_at ?? null,
        ai_approval: aiConv.ai_approval ?? null,
      })
    : null;

  // Robô em andamento: na mesma conversa em que o chat aplica as ações (a do agente ou, sem agente, a principal)
  const botConv = aiConv ?? conv;
  const bot = botConv
    ? await getConversationBotInfo(auth.admin, { organizationId: auth.user.organizationId, conversationId: botConv.id })
    : null;

  return json({
    connected: conn?.status === 'connected',
    hasConnection: !!conn,
    provider: conn?.provider ?? null,
    senders,
    numbers,
    conversation: conv ? { ...conv, last_inbound_at: lastInboundAt } : null,
    ai,
    bot,
    messages,
  });
}
