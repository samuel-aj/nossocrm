import type { SupabaseClient } from '@supabase/supabase-js';

type AuditAction =
  | 'superadmin.org.create'
  | 'superadmin.org.update'
  | 'superadmin.org.delete'
  | 'superadmin.org.switch'
  | 'superadmin.user.create'
  | 'superadmin.user.promote'
  | 'superadmin.user.demote'
  | 'superadmin.user.memberships'
  | 'superadmin.setup';

interface AuditEntry {
  action: AuditAction;
  actor_id: string;
  org_id?: string;
  resource_type: 'organization' | 'user' | 'system';
  resource_id?: string;
  details?: Record<string, unknown>;
  severity?: 'info' | 'warning' | 'critical';
}

/**
 * Log acao de super_admin na tabela audit_logs (best-effort).
 * Erros de escrita sao logados no console mas nao bloqueiam a operacao.
 */
export async function logSuperAdminAction(
  supabase: SupabaseClient,
  entry: AuditEntry
) {
  try {
    await supabase.from('audit_logs').insert({
      user_id: entry.actor_id,
      organization_id: entry.org_id || null,
      action: entry.action,
      resource_type: entry.resource_type,
      resource_id: entry.resource_id || null,
      details: entry.details || {},
      severity: entry.severity || 'warning',
    });
  } catch (err) {
    console.error('[audit] Failed to log superadmin action:', entry.action, err);
  }
}
