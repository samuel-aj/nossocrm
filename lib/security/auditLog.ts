import type { SupabaseClient } from '@supabase/supabase-js';
import { createStaticAdminClient } from '@/lib/supabase/server';

/**
 * Registro de eventos críticos (item "monitorar e registrar eventos críticos
 * no back-end" da auditoria de segurança de 23/11/2026).
 *
 * Tudo vai para a tabela `audit_logs`, gravada só com a chave de serviço: o
 * navegador não lê nem escreve nela (a leitura é pela rota
 * /api/security/events, que confere quem pede).
 *
 * Regras:
 *  - gravar é "melhor esforço": falha de registro nunca derruba a operação;
 *  - segredo nunca entra no registro (chave, token, senha são trocados por
 *    "[oculto]" e textos longos são cortados);
 *  - evento que um estranho consegue provocar à vontade (ex.: chave de API
 *    errada) passa por `shouldLogThrottled`, para não encher o banco.
 */

type SuperAdminAction =
  | 'superadmin.org.create'
  | 'superadmin.org.update'
  | 'superadmin.org.delete'
  | 'superadmin.org.switch'
  | 'superadmin.org.ai_agents'
  | 'superadmin.user.create'
  | 'superadmin.user.promote'
  | 'superadmin.user.demote'
  | 'superadmin.user.memberships'
  | 'superadmin.user.password_reset'
  | 'superadmin.setup';

export type SecurityAction =
  | SuperAdminAction
  | 'team.invite.created'
  | 'team.invite.revoked'
  | 'team.invite.accepted'
  | 'team.member.added'
  | 'team.member.removed'
  | 'api_key.created'
  | 'api_key.revoked'
  | 'ai.settings.changed'
  | 'whatsapp.connection.saved'
  | 'whatsapp.connection.removed'
  | 'integration.zapsign.changed'
  | 'data.contacts.exported'
  | 'public_api.invalid_key'
  | 'auth.login'
  | 'rate_limit.exceeded'
  | 'auth.login_failed';

export type AuditSeverity = 'info' | 'warning' | 'critical';

export interface SecurityEvent {
  action: SecurityAction;
  /** Quem fez. Ausente quando não há usuário (ex.: chave de API inválida). */
  actorId?: string | null;
  organizationId?: string | null;
  resourceType: string;
  /** Id do recurso. Só é gravado na coluna própria quando for UUID. */
  resourceId?: string | null;
  details?: Record<string, unknown>;
  severity?: AuditSeverity;
}

const SECRET_KEY = /(key|token|secret|password|senha|authorization|credential)/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_TEXT = 300;
const MAX_ITEMS = 30;

/** Tira segredos e encurta o que vai para a coluna `details`. */
export function sanitizeAuditDetails(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.length > MAX_TEXT ? `${value.slice(0, MAX_TEXT)}…` : value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (depth >= 3) return '[resumido]';
  if (Array.isArray(value)) return value.slice(0, MAX_ITEMS).map(v => sanitizeAuditDetails(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, MAX_ITEMS)) {
      out[k] = SECRET_KEY.test(k) && typeof v !== 'boolean' ? '[oculto]' : sanitizeAuditDetails(v, depth + 1);
    }
    return out;
  }
  return String(value).slice(0, MAX_TEXT);
}

/** IP e navegador de quem chamou (a Vercel preenche x-forwarded-for). */
export function requestMeta(request?: Request | null): { ip: string | null; userAgent: string | null } {
  if (!request) return { ip: null, userAgent: null };
  const forwarded = request.headers.get('x-forwarded-for') || '';
  const ip = (forwarded.split(',')[0] || request.headers.get('x-real-ip') || '').trim().slice(0, 64);
  const userAgent = (request.headers.get('user-agent') || '').slice(0, MAX_TEXT);
  return { ip: ip || null, userAgent: userAgent || null };
}

/** "fulano@escritorio.com" vira "fu***@escritorio.com": dá para investigar sem guardar o e-mail inteiro. */
export function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  return `${local.slice(0, 2)}***@${domain}`;
}

const throttle = new Map<string, number>();

/**
 * true só na primeira vez de cada `key` dentro da janela. Serve para eventos
 * que um estranho consegue repetir à vontade. A memória é da instância do
 * servidor, o que basta para não transformar o registro em porta de sobrecarga.
 */
export function shouldLogThrottled(key: string, windowMs = 60_000, now = Date.now()): boolean {
  const last = throttle.get(key);
  if (last !== undefined && now - last < windowMs) return false;
  if (throttle.size > 2000) {
    for (const [k, t] of throttle) if (now - t >= windowMs) throttle.delete(k);
    if (throttle.size > 2000) throttle.clear();
  }
  throttle.set(key, now);
  return true;
}

/** Só para testes. */
export function resetAuditThrottle(): void {
  throttle.clear();
}

/**
 * Grava um evento crítico. Nunca lança erro: quem chama não precisa de try/catch.
 * `client` é opcional; sem ele usa a chave de serviço.
 */
export async function logSecurityEvent(
  event: SecurityEvent,
  request?: Request | null,
  client?: SupabaseClient,
): Promise<void> {
  try {
    const { ip, userAgent } = requestMeta(request);
    const details = (sanitizeAuditDetails(event.details ?? {}) ?? {}) as Record<string, unknown>;
    const resourceId = event.resourceId && UUID.test(event.resourceId) ? event.resourceId : null;
    if (event.resourceId && !resourceId) details.resource_ref = String(event.resourceId).slice(0, 120);
    const sb = client ?? createStaticAdminClient();
    const { error } = await sb.from('audit_logs').insert({
      user_id: event.actorId || null,
      organization_id: event.organizationId || null,
      action: event.action,
      resource_type: event.resourceType,
      resource_id: resourceId,
      details,
      severity: event.severity || 'info',
      ip_address: ip,
      user_agent: userAgent,
    });
    if (error) console.error('[audit] falha ao gravar', event.action, error.code || error.message);
  } catch (err) {
    console.error('[audit] falha ao gravar', event.action, err instanceof Error ? err.message : err);
  }
}

interface AuditEntry {
  action: SuperAdminAction;
  actor_id: string;
  org_id?: string;
  resource_type: 'organization' | 'user' | 'system';
  resource_id?: string;
  details?: Record<string, unknown>;
  severity?: AuditSeverity;
}

/**
 * Ação de super admin (melhor esforço). Passe `request` para registrar também
 * o IP e o navegador.
 */
export async function logSuperAdminAction(supabase: SupabaseClient, entry: AuditEntry, request?: Request | null) {
  await logSecurityEvent(
    {
      action: entry.action,
      actorId: entry.actor_id,
      organizationId: entry.org_id,
      resourceType: entry.resource_type,
      resourceId: entry.resource_id,
      details: entry.details,
      severity: entry.severity || 'warning',
    },
    request,
    supabase,
  );
}
