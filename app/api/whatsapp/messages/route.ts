/**
 * GET /api/whatsapp/messages?phone=<telefone>
 * Retorna a conversa de WhatsApp daquele telefone (na org) + as mensagens.
 * Usado pelo chat dentro do card do lead.
 */
import { requireOrgUser, json } from '@/lib/whatsapp/api';
import { getConnectionByOrg } from '@/lib/whatsapp/service';
import { brPhoneVariants, normalizePhoneE164 } from '@/lib/phone';

export async function GET(req: Request) {
  const auth = await requireOrgUser();
  if (!auth.ok) return auth.response;

  const phone = normalizePhoneE164(new URL(req.url).searchParams.get('phone') || '');
  if (!phone) return json({ error: 'phone é obrigatório' }, 400);

  const conn = await getConnectionByOrg(auth.admin, auth.user.organizationId);

  // Variantes BR do nono dígito: o JID do WhatsApp pode vir sem o 9 do
  // celular, criando conversa em outra grafia do MESMO número. Busca as duas
  // e junta as mensagens.
  const variants = brPhoneVariants(phone);
  const { data: convList } = await auth.admin
    .from('wa_conversations')
    .select('id, wa_phone, wa_name, contact_id, last_message_at, unread_count')
    .eq('organization_id', auth.user.organizationId)
    .in('wa_phone', variants.length ? variants : [phone]);

  const convs = (convList ?? []) as Array<{ id: string; contact_id: string | null }>;
  const conv = convs.find(c => c.contact_id) ?? convs[0] ?? null;

  let messages: unknown[] = [];
  if (convs.length > 0) {
    // As 300 mais RECENTES (desc + limit), revertidas p/ ordem cronológica —
    // asc + limit congelaria o chat nas 300 primeiras de conversas longas.
    const { data } = await auth.admin
      .from('wa_messages')
      .select(
        'id, direction, status, body, media_type, media_mime, media_url, from_phone, to_phone, wa_timestamp, created_at, sent_by'
      )
      .in('conversation_id', convs.map(c => c.id))
      .order('created_at', { ascending: false })
      .limit(300);
    const rows = ((data || []) as Array<Record<string, unknown>>).reverse();

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
  }

  return json({
    connected: conn?.status === 'connected',
    hasConnection: !!conn,
    conversation: conv ?? null,
    messages,
  });
}
