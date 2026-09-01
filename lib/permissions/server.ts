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
