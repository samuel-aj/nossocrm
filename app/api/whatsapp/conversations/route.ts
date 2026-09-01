import { requireOrgUser, json } from '@/lib/whatsapp/api';
import { getConnectionByOrg, getWaGroupsEnabled } from '@/lib/whatsapp/service';
import { isColunaLabelIdsAusente } from '@/lib/whatsapp/labels';
import { connectionAllowed, filterConversationsByOwner, getVisibilityRules } from '@/lib/permissions/server';

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
  const groupsEnabled = await getWaGroupsEnabled(auth.admin, auth.user.organizationId);

  // Permissões de visualização: vendedor restrito só enxerga as conversas dos
  // NÚMEROS permitidos (a regra vale aqui, no servidor — a rota usa service
  // role e RLS não alcança).
  const vis = await getVisibilityRules(auth.admin, auth.user.organizationId, auth.user.id, auth.user.role);
  const allowedConnIds = vis?.whatsapp.connection_ids ?? null;
  if (connectionId && !connectionAllowed(vis, connectionId)) {
    return json({ data: [], groupsEnabled });
  }

  const COLUNAS_BASE =
    'id, connection_id, wa_phone, wa_name, contact_id, deal_id, last_message_at, last_message_preview, unread_count, is_group, group_jid, participants_count, avatar_path';

  const buscar = async (colunas: string) => {
    let q = auth.admin
      .from('wa_conversations')
      .select(colunas)
      .eq('organization_id', auth.user.organizationId);
    if (connectionId) q = q.eq('connection_id', connectionId);
    // Restrição por número: conversa sem número (legada) fica de fora também
    else if (allowedConnIds) q = q.in('connection_id', allowedConnIds);
    // Restrição por etiqueta: só conversas com AO MENOS UMA das permitidas
    if (vis?.whatsapp.label_ids) q = q.overlaps('label_ids', vis.whatsapp.label_ids);
    if (!groupsEnabled) q = q.eq('is_group', false);
    // Teto ALTO de propósito: com 500 a maior organização (mais de mil
    // conversas) perdia as mais antigas da lista, e o que sai da lista não
    // pode ser etiquetado nem mostra prévia. Assinar avatar não pesa (a maior
    // base tem menos de 100 fotos). Acima disso o certo é paginar.
    return q.order('last_message_at', { ascending: false, nullsFirst: false }).limit(2000);
  };

  // `label_ids` (etiquetas da conversa) é coluna nova: enquanto a migração
  // não rodar no ambiente, busca sem ela em vez de derrubar a lista inteira —
  // mesmo cuidado que o webhook já tem com colunas recém-criadas.
  let { data, error } = await buscar(`${COLUNAS_BASE}, label_ids`);
  if (isColunaLabelIdsAusente(error)) {
    console.warn('[conversations] coluna label_ids ausente (migração pendente); seguindo sem etiquetas');
    ({ data, error } = await buscar(COLUNAS_BASE));
  }

  if (error) return json({ error: error.message }, 500);

  // avatar_path guarda o CAMINHO no bucket privado wa-media (igual a
  // wa_messages.media_url): a URL é assinada aqui, na leitura.
  let linhas = (data || []) as unknown as Array<
    Record<string, unknown> & { avatar_path?: string | null; contact_id?: string | null }
  >;
  // Restrição por RESPONSÁVEL (dono do lead do contato, como no filtro dos
  // Chats): fora da lista permitida, a conversa nem aparece
  linhas = await filterConversationsByOwner(auth.admin, auth.user.organizationId, vis, auth.user.id, linhas);
  const caminhos = Array.from(
    new Set(linhas.map(r => r.avatar_path).filter((p): p is string => !!p && !p.startsWith('http')))
  );
  const assinadas = new Map<string, string>();
  if (caminhos.length > 0) {
    const { data: signed } = await auth.admin.storage.from('wa-media').createSignedUrls(caminhos, 3600);
    for (const s of signed ?? []) {
      if (s.path && s.signedUrl) assinadas.set(s.path, s.signedUrl);
    }
  }

  return json({
    data: linhas.map(r => ({
      ...r,
      avatar_url: r.avatar_path ? (assinadas.get(r.avatar_path) ?? null) : null,
    })),
    groupsEnabled,
  });
}
