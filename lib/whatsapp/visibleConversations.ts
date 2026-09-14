import type { SupabaseClient } from '@supabase/supabase-js';
import { getWaGroupsEnabled } from '@/lib/whatsapp/service';
import { connectionAllowed, filterConversationsByOwner, getVisibilityRules } from '@/lib/permissions/server';

type Linha = Record<string, unknown> & { contact_id?: string | null };

/**
 * Conversas de WhatsApp que o usuário ENXERGA: org, número escolhido, grupos
 * ligados ou não e permissões de visualização (números, etiquetas e
 * responsável). Usado pela lista dos Chats e pelo contador de não lidas do
 * menu, pra os dois nunca divergirem.
 *
 * `somenteNaoLidas` corta no banco as conversas zeradas (o contador só
 * precisa delas). `colunas` precisa incluir contact_id (filtro de responsável).
 */
export async function listVisibleConversations(
  admin: SupabaseClient,
  user: { id: string; role: string; organizationId: string },
  opts: { colunas: string; connectionId?: string | null; somenteNaoLidas?: boolean }
): Promise<{ data: Linha[]; error: { message: string; code?: string } | null; groupsEnabled: boolean }> {
  const orgId = user.organizationId;
  const groupsEnabled = await getWaGroupsEnabled(admin, orgId);

  // Permissões de visualização: vendedor restrito só enxerga as conversas dos
  // NÚMEROS permitidos (a regra vale aqui, no servidor — a rota usa service
  // role e RLS não alcança).
  const vis = await getVisibilityRules(admin, orgId, user.id, user.role);
  const allowedConnIds = vis?.whatsapp.connection_ids ?? null;
  if (opts.connectionId && !connectionAllowed(vis, opts.connectionId)) {
    return { data: [], error: null, groupsEnabled };
  }

  let q = admin.from('wa_conversations').select(opts.colunas).eq('organization_id', orgId);
  if (opts.connectionId) q = q.eq('connection_id', opts.connectionId);
  // Restrição por número: conversa sem número (legada) fica de fora também
  else if (allowedConnIds) q = q.in('connection_id', allowedConnIds);
  // Restrição por etiqueta: só conversas com AO MENOS UMA das permitidas
  if (vis?.whatsapp.label_ids) q = q.overlaps('label_ids', vis.whatsapp.label_ids);
  if (!groupsEnabled) q = q.eq('is_group', false);
  if (opts.somenteNaoLidas) q = q.gt('unread_count', 0);
  // Teto ALTO de propósito: com 500 a maior organização (mais de mil
  // conversas) perdia as mais antigas da lista, e o que sai da lista não
  // pode ser etiquetado nem mostra prévia. Acima disso o certo é paginar.
  const { data, error } = await q
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(2000);
  if (error) return { data: [], error, groupsEnabled };

  // Restrição por RESPONSÁVEL (dono do lead do contato, como no filtro dos
  // Chats): fora da lista permitida, a conversa nem aparece
  const linhas = await filterConversationsByOwner(admin, orgId, vis, user.id, (data || []) as unknown as Linha[]);
  return { data: linhas, error: null, groupsEnabled };
}
