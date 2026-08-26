/**
 * GET /api/whatsapp/messages?phone=<telefone>[&connectionId=...]
 * Retorna a conversa de WhatsApp daquele telefone (na org) + as mensagens.
 * Usado pelo chat dentro do card do lead.
 *
 * connectionId restringe a UM número conectado (página Chats com conversas
 * separadas por número): só a conversa e as mensagens daquele número, e só
 * elas são marcadas como lidas. Sem o parâmetro, visão unificada do contato
 * (card do lead).
 */
import { requireOrgUser, json } from '@/lib/whatsapp/api';
import { getConnectionsByOrg } from '@/lib/whatsapp/service';
import { brPhoneVariants, normalizePhoneE164 } from '@/lib/phone';
import { getConversationAiInfo, getConversationBotInfo } from '@/lib/wa-agents/conversation';

export async function GET(req: Request) {
  const auth = await requireOrgUser();
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const phone = normalizePhoneE164(url.searchParams.get('phone') || '');
  if (!phone) return json({ error: 'phone é obrigatório' }, 400);
  const connectionId = url.searchParams.get('connectionId');

  // Multi-número: a conexão "padrão" (1ª conectada) mantém o contrato antigo;
  // senders lista TODOS os números conectados pro seletor de envio do chat.
  const all = await getConnectionsByOrg(auth.admin, auth.user.organizationId);
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
  if (connectionId === 'none') convQ = convQ.is('connection_id', null);
  else if (connectionId) convQ = convQ.eq('connection_id', connectionId);
  const { data: convList } = await convQ;

  const convs = (convList ?? []) as Array<{
    id: string;
    connection_id: string | null;
    contact_id: string | null;
    ai_status?: string | null;
    ai_agent_id?: string | null;
    ai_resume_at?: string | null;
    ai_approval?: Record<string, unknown> | null;
  }>;
  // Agente de IA: a conversa (deste contato) em que um agente já atuou
  const aiConv = convs.find(c => c.ai_status) ?? null;
  const connByConv = new Map(convs.map(c => [c.id, c.connection_id]));
  const conv = convs.find(c => c.contact_id) ?? convs[0] ?? null;

  let messages: unknown[] = [];
  if (convs.length > 0) {
    // As 300 mais RECENTES (desc + limit), revertidas p/ ordem cronológica —
    // asc + limit congelaria o chat nas 300 primeiras de conversas longas.
    const { data } = await auth.admin
      .from('wa_messages')
      .select(
        'id, conversation_id, direction, status, body, media_type, media_mime, media_url, from_phone, to_phone, wa_timestamp, created_at, sent_by, error, transcription'
      )
      .in('conversation_id', convs.map(c => c.id))
      .order('created_at', { ascending: false })
      .limit(300);
    const rows = ((data || []) as Array<Record<string, unknown>>).reverse();
    // Anota de QUAL número cada mensagem veio (divisórias por número no chat)
    for (const r of rows) {
      r.connection_id = connByConv.get(r.conversation_id as string) ?? null;
      delete r.conversation_id;
    }

    // media_url guarda o CAMINHO no bucket privado wa-media — assina URLs de
    // leitura (1h) pro chat exibir imagem/vídeo/áudio/documento.
    const paths = rows
      .map(r => r.media_url)
      .filter((p): p is string => typeof p === 'string' && p.length > 0 && !p.startsWith('http'));
    if (paths.length > 0) {
      const { data: signed } = await auth.admin.storage.from('wa-media').createSignedUrls(paths, 3600);
      const byPath = new Map((signed ?? []).filter(s => s.signedUrl).map(s => [s.path, s.signedUrl]));
      for (const r of rows) {
        const p = r.media_url;
        if (typeof p === 'string' && byPath.has(p)) r.media_url = byPath.get(p);
      }
    }
    messages = rows;

    // Visualizou = leu: zera o contador de não lidas (badge da página Chats)
    await auth.admin
      .from('wa_conversations')
      .update({ unread_count: 0 })
      .in('id', convs.map(c => c.id))
      .gt('unread_count', 0);
  }

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
