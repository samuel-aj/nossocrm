import { requireOrgUser, json } from '@/lib/whatsapp/api';
import { getConnectionByOrg } from '@/lib/whatsapp/service';
import { isColunaLabelIdsAusente } from '@/lib/whatsapp/labels';
import { listVisibleConversations } from '@/lib/whatsapp/visibleConversations';

export const runtime = 'nodejs';

/**
 * GET /api/whatsapp/conversations[?connectionId=...]
 * Lista as conversas de WhatsApp da organização (inbox da página Chats),
 * ordenadas da mais recente para a mais antiga. Mesmo padrão das demais
 * rotas wa_*: sessão autentica, service role lê filtrando por organization_id.
 *
 * connectionId restringe às conversas de UM número conectado (org com mais de
 * um número). O escopo por organization_id já impede id de outra org: com um
 * connectionId alheio a interseção é vazia, não há vazamento.
 *
 * GRUPOS: só entram na lista quando a org ligou "Grupos do WhatsApp no chat"
 * (`groupsEnabled` na resposta); desligada, as conversas de grupo ficam
 * guardadas mas escondidas.
 *
 * WhatsApp DESCONECTADO => lista vazia: as conversas ficam guardadas mas não
 * aparecem (reconectar o MESMO número traz de volta; número diferente apaga
 * — ver connection.update na edge function whatsapp-webhook).
 */
export async function GET(req: Request) {
  const auth = await requireOrgUser();
  if (!auth.ok) return auth.response;

  const conn = await getConnectionByOrg(auth.admin, auth.user.organizationId);
  if (!conn || conn.status !== 'connected') {
    return json({ data: [], groupsEnabled: false });
  }

  const connectionId = new URL(req.url).searchParams.get('connectionId');

  const COLUNAS_BASE =
    'id, connection_id, wa_phone, wa_name, contact_id, deal_id, last_message_at, last_message_preview, unread_count, is_group, group_jid, participants_count, avatar_path, avatar_synced_at';

  // `label_ids` (etiquetas da conversa) é coluna nova: enquanto a migração
  // não rodar no ambiente, busca sem ela em vez de derrubar a lista inteira —
  // mesmo cuidado que o webhook já tem com colunas recém-criadas.
  let resultado = await listVisibleConversations(auth.admin, auth.user, {
    colunas: `${COLUNAS_BASE}, label_ids`,
    connectionId,
  });
  if (isColunaLabelIdsAusente(resultado.error)) {
    console.warn('[conversations] coluna label_ids ausente (migração pendente); seguindo sem etiquetas');
    resultado = await listVisibleConversations(auth.admin, auth.user, { colunas: COLUNAS_BASE, connectionId });
  }
  const { data, error, groupsEnabled } = resultado;
  if (error) return json({ error: error.message }, 500);

  // Foto de perfil: endereço FIXO servido por /api/whatsapp/avatars/[id], que
  // o navegador guarda em cache. NÃO assinar aqui: a lista recarrega sozinha e
  // um link assinado novo a cada recarga fazia o navegador baixar todas as
  // fotos de novo, e cada download consulta o banco (derrubou a produção em
  // 14/09/2026). `v` muda quando a foto é sincronizada de novo.
  const linhas = data as Array<
    Record<string, unknown> & { id: string; avatar_path?: string | null; avatar_synced_at?: string | null }
  >;
  return json({
    data: linhas.map(({ avatar_synced_at, ...r }) => ({
      ...r,
      avatar_url:
        r.avatar_path && !r.avatar_path.startsWith('http')
          ? `/api/whatsapp/avatars/${r.id}?v=${encodeURIComponent(avatar_synced_at ?? '')}`
          : null,
    })),
    groupsEnabled,
  });
}
