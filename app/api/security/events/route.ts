/**
 * GET /api/security/events
 *
 * Leitura do registro de eventos críticos (tabela audit_logs), só para super
 * admin. O navegador não lê a tabela direto: ela é trancada para a chave de
 * serviço (migração 20261124150000_seguranca_registro_eventos).
 *
 * Filtros: ?period=24h|7d|30d|90d  ?org=<uuid>
 *          ?severity=info|warning|critical|important (important = atenção + crítico)
 *          ?before=<ISO> (página seguinte)
 *          ?source=auth  -> acessos registrados pelo Supabase Auth (login,
 *                           logout, troca/recuperação de senha)
 */
import { createClient, createStaticAdminClient } from '@/lib/supabase/server';
import { safeErrorMessage } from '@/lib/security/safeError';
import { isValidUUID } from '@/lib/supabase/utils';
import { UserRole } from '@/types/constants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PAGE = 100;
const PERIOD_MS: Record<string, number> = {
  '24h': 24 * 3600_000,
  '7d': 7 * 24 * 3600_000,
  '30d': 30 * 24 * 3600_000,
  '90d': 90 * 24 * 3600_000,
};
const SEVERITIES = new Set(['info', 'warning', 'critical']);

function json<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

type AuditRow = {
  id: string;
  created_at: string;
  user_id: string | null;
  organization_id: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  details: Record<string, unknown> | null;
  severity: string;
  ip_address: string | null;
  user_agent: string | null;
};

type AuthRow = {
  id: string;
  created_at: string;
  action: string | null;
  actor_id: string | null;
  actor_email: string | null;
  ip_address: string | null;
};

type Person = { id: string; name: string | null; email: string | null };
type Org = { id: string; name: string | null };

export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const { data: me } = await supabase.from('profiles').select('id, role').eq('id', user.id).single();
  if (!me || me.role !== UserRole.SUPER_ADMIN) return json({ error: 'Acesso restrito ao super admin' }, 403);

  const url = new URL(req.url);
  const periodParam = url.searchParams.get('period') || '';
  const period = PERIOD_MS[periodParam] ? periodParam : '7d';
  const since = new Date(Date.now() - PERIOD_MS[period]).toISOString();
  const admin = createStaticAdminClient();

  if (url.searchParams.get('source') === 'auth') {
    const { data, error } = await admin.rpc('security_auth_events', { p_since: since, p_limit: PAGE });
    if (error) return json({ error: safeErrorMessage(error, 'Não foi possível ler os acessos.') }, 500);
    const rows = (data ?? []) as AuthRow[];
    return json({
      events: rows.map(r => ({
        id: r.id,
        created_at: r.created_at,
        action: `auth.${r.action || 'desconhecido'}`,
        severity: 'info',
        actor: r.actor_id || r.actor_email ? { id: r.actor_id, name: null, email: r.actor_email } : null,
        organization: null,
        resource_type: 'auth',
        details: {},
        ip: r.ip_address,
        user_agent: null,
      })),
      hasMore: false,
    });
  }

  const severity = url.searchParams.get('severity') || '';
  const org = url.searchParams.get('org') || '';
  const before = url.searchParams.get('before') || '';

  let query = admin
    .from('audit_logs')
    .select('id, created_at, user_id, organization_id, action, resource_type, resource_id, details, severity, ip_address, user_agent')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(PAGE + 1);
  const orgFilter = org && isValidUUID(org) ? org : null;
  if (severity === 'important') query = query.in('severity', ['warning', 'critical']);
  else if (SEVERITIES.has(severity)) query = query.eq('severity', severity);
  if (orgFilter) query = query.eq('organization_id', orgFilter);
  if (before && !Number.isNaN(Date.parse(before))) query = query.lt('created_at', new Date(before).toISOString());

  // Resumo do período (só na primeira página): quantos críticos e de atenção.
  const countOf = async (level: 'critical' | 'warning') => {
    let q = admin.from('audit_logs').select('id', { count: 'exact', head: true }).gte('created_at', since).eq('severity', level);
    if (orgFilter) q = q.eq('organization_id', orgFilter);
    const { count } = await q;
    return count ?? 0;
  };
  const [{ data, error }, critical, warning] = await Promise.all([
    query,
    before ? null : countOf('critical'),
    before ? null : countOf('warning'),
  ]);
  if (error) return json({ error: safeErrorMessage(error, 'Não foi possível ler o registro.') }, 500);
  const all = (data ?? []) as AuditRow[];
  const rows = all.slice(0, PAGE);

  const userIds = [...new Set(rows.map(r => r.user_id).filter((v): v is string => !!v))];
  const orgIds = [...new Set(rows.map(r => r.organization_id).filter((v): v is string => !!v))];
  const [peopleRes, orgsRes] = await Promise.all([
    userIds.length ? admin.from('profiles').select('id, name, email').in('id', userIds) : null,
    orgIds.length ? admin.from('organizations').select('id, name').in('id', orgIds) : null,
  ]);
  const people = new Map(((peopleRes?.data ?? []) as Person[]).map(p => [p.id, p]));
  const orgs = new Map(((orgsRes?.data ?? []) as Org[]).map(o => [o.id, o.name]));

  return json({
    events: rows.map(r => ({
      id: r.id,
      created_at: r.created_at,
      action: r.action,
      severity: r.severity,
      actor: r.user_id
        ? { id: r.user_id, name: people.get(r.user_id)?.name ?? null, email: people.get(r.user_id)?.email ?? null }
        : null,
      organization: r.organization_id ? { id: r.organization_id, name: orgs.get(r.organization_id) ?? null } : null,
      resource_type: r.resource_type,
      details: r.details ?? {},
      ip: r.ip_address,
      user_agent: r.user_agent,
    })),
    hasMore: all.length > PAGE,
    summary: before ? null : { critical, warning },
  });
}
