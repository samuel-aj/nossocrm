/**
 * Leitura das permissões de visualização no SERVIDOR (rotas com service role).
 *
 * As rotas de WhatsApp usam service role (que ignora RLS), então a regra de
 * connection_ids é aplicada aqui, em código: quem monta a consulta filtra
 * pelos números permitidos. deals/boards não precisam disso — as políticas
 * restritivas do banco já cortam na leitura do navegador.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { UserRole } from '@/types/constants';
import { normalizeVisibilityRules, type VisibilityRules } from './types';

/** Papéis que nunca são restringidos. */
export function isVisibilityExempt(role: string): boolean {
  return role === UserRole.ADMIN || role === UserRole.SUPER_ADMIN;
}

/**
 * Regras do usuário na organização; null = sem regra (vê tudo).
 * Tolerante a banco sem a migração: erro de tabela ausente = sem regra.
 */
export async function getVisibilityRules(
  admin: SupabaseClient,
  organizationId: string,
  userId: string,
  role: string
): Promise<VisibilityRules | null> {
  if (isVisibilityExempt(role)) return null;
  const { data, error } = await admin
    .from('user_visibility_rules')
    .select('rules')
    .eq('organization_id', organizationId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data) return null;
  return normalizeVisibilityRules((data as { rules: unknown }).rules);
}

/** true quando o usuário pode usar este número conectado (null = conversa sem número: só sem restrição). */
export function connectionAllowed(rules: VisibilityRules | null, connectionId: string | null): boolean {
  if (!rules || rules.whatsapp.connection_ids === null) return true;
  if (!connectionId) return false;
  return rules.whatsapp.connection_ids.includes(connectionId);
}

/** Filtra uma lista de conexões pelos números permitidos. */
export function filterAllowedConnections<T extends { id: string }>(
  rules: VisibilityRules | null,
  connections: T[]
): T[] {
  if (!rules || rules.whatsapp.connection_ids === null) return connections;
  const allowed = new Set(rules.whatsapp.connection_ids);
  return connections.filter(c => allowed.has(c.id));
}

/**
 * Responsável EFETIVO das conversas: o dono do lead do contato, com a mesma
 * preferência do filtro dos Chats (negócio ABERTO primeiro; entre vários, o
 * mais recente). Devolve contactId -> ownerId (contato sem lead ou lead sem
 * dono fica de fora do mapa = sem responsável).
 */
export async function effectiveOwnersByContact(
  admin: SupabaseClient,
  organizationId: string,
  contactIds: string[]
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = Array.from(new Set(contactIds.filter(Boolean)));
  if (unique.length === 0) return map;
  const { data } = await admin
    .from('deals')
    .select('contact_id, owner_id, is_won, is_lost, created_at')
    .eq('organization_id', organizationId)
    .in('contact_id', unique)
    .is('deleted_at', null);
  const porContato = new Map<string, Array<{ owner_id: string | null; aberto: boolean; created_at: string }>>();
  for (const d of (data ?? []) as Array<{ contact_id: string; owner_id: string | null; is_won: boolean; is_lost: boolean; created_at: string }>) {
    const lista = porContato.get(d.contact_id) ?? [];
    lista.push({ owner_id: d.owner_id, aberto: !d.is_won && !d.is_lost, created_at: d.created_at ?? '' });
    porContato.set(d.contact_id, lista);
  }
  for (const [contactId, lista] of porContato) {
    const abertos = lista.filter(l => l.aberto);
    const pool = abertos.length ? abertos : lista;
    const escolhido = pool.slice().sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))[0];
    if (escolhido?.owner_id) map.set(contactId, escolhido.owner_id);
  }
  return map;
}

/**
 * Filtra conversas pela regra de RESPONSÁVEL: fica quem não tem responsável
 * (contato sem lead, lead sem dono, grupo) ou cujo responsável é o próprio
 * usuário ou alguém da lista permitida.
 */
export async function filterConversationsByOwner<T extends { contact_id?: string | null }>(
  admin: SupabaseClient,
  organizationId: string,
  rules: VisibilityRules | null,
  userId: string,
  conversations: T[]
): Promise<T[]> {
  if (!rules || rules.whatsapp.owner_user_ids === null) return conversations;
  const allowed = new Set([userId, ...rules.whatsapp.owner_user_ids]);
  const owners = await effectiveOwnersByContact(
    admin,
    organizationId,
    conversations.map(c => c.contact_id ?? '').filter(Boolean)
  );
  return conversations.filter(c => {
    const owner = c.contact_id ? owners.get(c.contact_id) : undefined;
    return !owner || allowed.has(owner);
  });
}
