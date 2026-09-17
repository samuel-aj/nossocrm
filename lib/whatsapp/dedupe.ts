/**
 * UM NÚMERO = UMA CONEXÃO por organização.
 *
 * O WhatsApp aceita parear o mesmo celular em vários aparelhos, então a
 * Evolution deixa duas instâncias QR "conectadas" com o MESMO número. No CRM
 * isso parte o chat: cada conexão tem as próprias conversas e cada mensagem
 * (inclusive a enviada pelo celular) cai só na conversa da conexão que gravou
 * primeiro. Aqui a org volta a ter uma conexão só por número, com as
 * conversas das repetidas unificadas na que fica.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { brPhoneVariants } from '@/lib/phone';
import { envEvolution, getProvider, isBusinessConnection } from '@/lib/whatsapp';
import { deleteEvolutionInstance } from '@/lib/whatsapp/admin';
import type { WaConnectionRow } from '@/lib/whatsapp/service';

/** Chave do número que ignora a grafia do nono dígito BR (com e sem o 9 = mesma chave). */
export function phoneKey(phone?: string | null): string | null {
  const variants = brPhoneVariants(phone);
  if (!variants.length) return null;
  return [...variants].sort((a, b) => b.length - a.length)[0];
}

/** Outra conexão CONECTADA da org com o mesmo número (null = número livre). */
export function findConnectedSameNumber(
  conns: Array<Pick<WaConnectionRow, 'id' | 'phone_number' | 'status'>>,
  phone: string | null | undefined,
  exceptId?: string | null
) {
  const key = phoneKey(phone);
  if (!key) return null;
  return conns.find(c => c.id !== exceptId && c.status === 'connected' && phoneKey(c.phone_number) === key) ?? null;
}

type ConvRow = {
  id: string;
  wa_phone: string;
  is_group: boolean | null;
  contact_id: string | null;
  deal_id: string | null;
  assigned_owner_id: string | null;
  label_ids: string[] | null;
  unread_count: number | null;
  last_message_at: string | null;
  last_message_preview: string | null;
};

const CONV_COLS = 'id, wa_phone, is_group, contact_id, deal_id, assigned_owner_id, label_ids, unread_count, last_message_at, last_message_preview';

/**
 * Passa as conversas de `fromId` (null = órfãs, sem conexão) para `toId`.
 * Conversa do mesmo telefone que já existe no destino é UNIFICADA (mensagens
 * e execuções de robô/agente migram, a repetida some); o resto só troca de
 * conexão. Devolve quantas conversas saíram da origem.
 */
export async function mergeConnectionConversations(
  admin: SupabaseClient,
  orgId: string,
  fromId: string | null,
  toId: string,
  /** Restringe a estas conversas (ex.: as de uma conexão que acabou de ser apagada) */
  onlyIds?: string[]
): Promise<number> {
  if (onlyIds && onlyIds.length === 0) return 0;
  let srcQuery = admin.from('wa_conversations').select(CONV_COLS).eq('organization_id', orgId);
  srcQuery = fromId ? srcQuery.eq('connection_id', fromId) : srcQuery.is('connection_id', null);
  if (onlyIds) srcQuery = srcQuery.in('id', onlyIds);
  const [{ data: src, error: srcError }, { data: dst, error: dstError }] = await Promise.all([
    srcQuery,
    admin.from('wa_conversations').select(CONV_COLS).eq('organization_id', orgId).eq('connection_id', toId),
  ]);
  if (srcError || dstError) {
    console.error('[whatsapp] unificar conversas: leitura falhou:', srcError?.message || dstError?.message);
    return 0;
  }
  const targets = (dst ?? []) as ConvRow[];
  let moved = 0;

  for (const s of (src ?? []) as ConvRow[]) {
    const variants = s.is_group ? [s.wa_phone] : brPhoneVariants(s.wa_phone);
    const match = targets.find(d => variants.includes(d.wa_phone));

    if (!match) {
      const { error } = await admin.from('wa_conversations').update({ connection_id: toId }).eq('id', s.id);
      if (error) console.error('[whatsapp] unificar conversas: mover falhou:', error.message);
      else {
        moved++;
        targets.push(s);
      }
      continue;
    }

    // Mesmo telefone nos dois lados: tudo vai para a conversa do destino
    const { error: msgError } = await admin.from('wa_messages').update({ conversation_id: match.id }).eq('conversation_id', s.id);
    if (msgError) {
      // Sem mover as mensagens não dá para apagar a conversa (o histórico iria junto)
      console.error('[whatsapp] unificar conversas: mensagens falharam:', msgError.message);
      continue;
    }
    await admin.from('wa_ai_agent_runs').update({ conversation_id: match.id }).eq('conversation_id', s.id);
    await admin.from('wa_bot_runs').update({ conversation_id: match.id }).eq('conversation_id', s.id);

    const srcNewer = (s.last_message_at ?? '') > (match.last_message_at ?? '');
    const patch = {
      contact_id: match.contact_id ?? s.contact_id,
      deal_id: match.deal_id ?? s.deal_id,
      assigned_owner_id: match.assigned_owner_id ?? s.assigned_owner_id,
      label_ids: Array.from(new Set([...(match.label_ids ?? []), ...(s.label_ids ?? [])])),
      unread_count: (match.unread_count ?? 0) + (s.unread_count ?? 0),
      last_message_at: srcNewer ? s.last_message_at : match.last_message_at,
      last_message_preview: srcNewer ? s.last_message_preview : match.last_message_preview,
    };
    const { error: patchError } = await admin.from('wa_conversations').update(patch).eq('id', match.id);
    if (patchError) console.error('[whatsapp] unificar conversas: atualizar destino falhou:', patchError.message);
    Object.assign(match, patch);

    const { error: delError } = await admin.from('wa_conversations').delete().eq('id', s.id);
    if (delError) console.error('[whatsapp] unificar conversas: apagar repetida falhou:', delError.message);
    else moved++;
  }
  return moved;
}

/**
 * Tudo que guarda o id de uma conexão passa para outra: robôs (coluna antiga e
 * lista de números), modelos e AGENTES DE IA (lista de números). Sem isto, o
 * agente ficava preso ao id apagado: parava de atender e não salvava mais.
 */
export async function repointConnectionRefs(
  admin: SupabaseClient,
  orgId: string,
  fromId: string,
  toId: string
): Promise<void> {
  const swap = (ids: string[] | null) =>
    Array.from(new Set((ids ?? []).map(id => (id === fromId ? toId : id))));
  await admin.from('wa_bots').update({ connection_id: toId }).eq('organization_id', orgId).eq('connection_id', fromId);
  await admin.from('message_templates').update({ connection_id: toId }).eq('connection_id', fromId);
  for (const table of ['wa_ai_agents', 'wa_bots'] as const) {
    const { data, error } = await admin
      .from(table)
      .select('id, connection_ids')
      .eq('organization_id', orgId)
      .contains('connection_ids', [fromId]);
    if (error) {
      console.error(`[whatsapp] repontar ${table} falhou:`, error.message);
      continue;
    }
    for (const row of (data ?? []) as Array<{ id: string; connection_ids: string[] | null }>) {
      const { error: upError } = await admin.from(table).update({ connection_ids: swap(row.connection_ids) }).eq('id', row.id);
      if (upError) console.error(`[whatsapp] repontar ${table} ${row.id} falhou:`, upError.message);
    }
  }
}

/** Derruba a instância na Evolution (logout + exclusão), só quando ela é do nosso servidor. */
export async function tearDownEvolutionInstance(conn: WaConnectionRow): Promise<void> {
  if (isBusinessConnection(conn)) return;
  try {
    await getProvider(conn).logout();
  } catch {
    // sessão morta: a exclusão abaixo resolve
  }
  const normalize = (u: string) => u.replace(/\/+$/, '').replace(/\/manager$/, '');
  const base = normalize(conn.base_url || '');
  if (!base || base === normalize(envEvolution().baseUrl)) {
    await deleteEvolutionInstance(conn.instance_name);
  }
}

export interface RemovedConnection {
  id: string;
  phoneNumber: string | null;
  /** true = era um pareamento repetido de um número que já estava conectado */
  duplicate: boolean;
  keptId: string;
}

/**
 * Garante uma conexão por número na org. `statusOf` traz o status ao vivo
 * (quando a rota já consultou o provedor); sem ele vale o salvo no banco.
 *
 * Por número com 2+ linhas e pelo menos uma conectada:
 * - fica a pareada mais recentemente (a API oficial ganha do QR);
 * - as outras linhas QR somem: conversas unificadas, instância derrubada e
 *   linha apagada. Linha de API oficial nunca é apagada aqui.
 * Número sem nenhuma conexão ativa fica como está (nada a decidir).
 */
export async function enforceOneConnectionPerNumber(
  admin: SupabaseClient,
  orgId: string,
  conns: WaConnectionRow[],
  statusOf: (c: WaConnectionRow) => string = c => c.status
): Promise<RemovedConnection[]> {
  const groups = new Map<string, WaConnectionRow[]>();
  for (const c of conns) {
    const key = phoneKey(c.phone_number);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }

  const removed: RemovedConnection[] = [];
  for (const rows of groups.values()) {
    if (rows.length < 2) continue;
    const connected = rows.filter(c => statusOf(c) === 'connected');
    if (!connected.length) continue;
    // Fica o pareamento MAIS RECENTE: a instância antiga pode ser "zumbi" (a
    // Evolution responde conectada com a sessão morta) e é justamente por isso
    // que a pessoa pareou de novo. As conversas vêm junto, nada se perde.
    const freshness = (c: WaConnectionRow) => c.last_connected_at ?? (c as { created_at?: string }).created_at ?? '';
    const newestFirst = [...connected].sort((a, b) => freshness(b).localeCompare(freshness(a)));
    const keeper = newestFirst.find(isBusinessConnection) ?? newestFirst[0];

    for (const extra of rows) {
      if (extra.id === keeper.id || isBusinessConnection(extra)) continue;
      const wasConnected = statusOf(extra) === 'connected';
      // Agentes, robôs e modelos presos à linha repetida passam para a que fica
      // (modelos seriam apagados junto com a linha: a FK deles é CASCADE)
      await repointConnectionRefs(admin, orgId, extra.id, keeper.id);
      const { data: convs } = await admin
        .from('wa_conversations')
        .select('id')
        .eq('organization_id', orgId)
        .eq('connection_id', extra.id);
      // Apagar a linha é a TRAVA: duas telas abertas ao mesmo tempo não
      // unificam em dobro (só quem apagou segue). As conversas dela ficam
      // sem conexão (FK SET NULL) e são unificadas logo abaixo.
      const { data: gone, error } = await admin.from('wa_connections').delete().eq('id', extra.id).select('id');
      if (error) {
        console.error('[whatsapp] remover conexão repetida falhou:', error.message);
        continue;
      }
      if (!gone?.length) continue;
      await tearDownEvolutionInstance(extra);
      await mergeConnectionConversations(admin, orgId, null, keeper.id, (convs ?? []).map(c => c.id as string));
      console.log(`[whatsapp] conexão repetida removida org=${orgId} conn=${extra.id} mantida=${keeper.id}`);
      removed.push({ id: extra.id, phoneNumber: extra.phone_number, duplicate: wasConnected, keptId: keeper.id });
    }
  }
  return removed;
}
