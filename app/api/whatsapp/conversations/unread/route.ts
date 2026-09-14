import { requireOrgUser, json } from '@/lib/whatsapp/api';
import { getConnectionByOrg } from '@/lib/whatsapp/service';
import { listVisibleConversations } from '@/lib/whatsapp/visibleConversations';

export const runtime = 'nodejs';

/**
 * GET /api/whatsapp/conversations/unread
 * Total de mensagens não lidas que o usuário enxerga (bolinha do item Chats no
 * menu). Roda em TODA tela do CRM, então é leve de propósito: só as conversas
 * com não lidas e só as colunas do filtro. Antes o menu buscava a lista
 * inteira de conversas e assinava todas as fotos a cada 30s.
 */
export async function GET() {
  const auth = await requireOrgUser();
  if (!auth.ok) return auth.response;

  const conn = await getConnectionByOrg(auth.admin, auth.user.organizationId);
  if (!conn || conn.status !== 'connected') return json({ total: 0 });

  const { data, error } = await listVisibleConversations(auth.admin, auth.user, {
    colunas: 'contact_id, unread_count',
    somenteNaoLidas: true,
  });
  if (error) return json({ error: error.message }, 500);

  const total = data.reduce((soma, c) => soma + (Number(c.unread_count) || 0), 0);
  return json({ total });
}
