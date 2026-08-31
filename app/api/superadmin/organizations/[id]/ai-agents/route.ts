import { createClient, createStaticAdminClient } from '@/lib/supabase/server';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { logSuperAdminAction } from '@/lib/security/auditLog';
import { UserRole } from '@/types/constants';
import { WA_AGENTS_BETA_FLAG, WA_AI_AGENTS_FLAG } from '@/lib/wa-agents/types';

/**
 * Liberação do AGENTE DE IA para uma organização — só o super admin da
 * agência, porque o agente é vendido caso a caso. Robôs não passam por aqui:
 * são liberados para todo mundo.
 *
 * GET  -> { enabled }
 * POST -> { enabled } liga/desliga (e, ao desligar, solta as conversas)
 */

type Ctx = { params: Promise<{ id: string }> };

function json<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

async function requireSuperAdmin(supabase: Awaited<ReturnType<typeof createClient>>) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role')
    .eq('id', user.id)
    .single();
  if (!profile || profile.role !== UserRole.SUPER_ADMIN) return null;
  return profile;
}

/** true quando a org tem a chave nova OU a antiga da beta ligada. */
async function lerLiberacao(admin: ReturnType<typeof createStaticAdminClient>, orgId: string): Promise<boolean> {
  const { data } = await admin
    .from('ai_feature_flags')
    .select('key, enabled')
    .eq('organization_id', orgId)
    .in('key', [WA_AI_AGENTS_FLAG, WA_AGENTS_BETA_FLAG]);
  return ((data ?? []) as Array<{ enabled: boolean }>).some(r => r.enabled === true);
}

export async function GET(req: Request, ctx: Ctx) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);
  const supabase = await createClient();
  const me = await requireSuperAdmin(supabase);
  if (!me) return json({ error: 'Unauthorized' }, 403);

  const { id } = await ctx.params;
  const admin = createStaticAdminClient();
  return json({ enabled: await lerLiberacao(admin, id) });
}

export async function POST(req: Request, ctx: Ctx) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);
  const supabase = await createClient();
  const me = await requireSuperAdmin(supabase);
  if (!me) return json({ error: 'Unauthorized' }, 403);

  const { id: orgId } = await ctx.params;
  const admin = createStaticAdminClient();

  let body: { enabled?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }
  if (typeof body.enabled !== 'boolean') return json({ error: 'enabled deve ser true ou false' }, 400);
  const enabled = body.enabled;

  const { data: org } = await admin.from('organizations').select('id, name').eq('id', orgId).maybeSingle();
  if (!org) return json({ error: 'Organização não encontrada' }, 404);

  const { error } = await admin.from('ai_feature_flags').upsert(
    {
      organization_id: orgId,
      key: WA_AI_AGENTS_FLAG,
      enabled,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'organization_id,key' }
  );
  if (error) return json({ error: error.message }, 500);

  // A chave ANTIGA da beta também vale como liberação (organizações que já
  // usavam antes). Ao REVOGAR é preciso desligar as duas, senão a antiga
  // continuaria liberando o agente.
  if (!enabled) {
    await admin
      .from('ai_feature_flags')
      .update({ enabled: false, updated_at: new Date().toISOString() })
      .eq('organization_id', orgId)
      .eq('key', WA_AGENTS_BETA_FLAG);
  }

  // Desligar solta as conversas que estavam com agente (mesmo tratamento que
  // a tela da beta fazia): elas voltam ao estado "nenhum agente atuou" e os
  // inícios pendentes pelo pipeline não rodam mais.
  let desvinculadas = 0;
  if (!enabled) {
    const { data, error: convError } = await admin
      .from('wa_conversations')
      .update({
        ai_agent_id: null,
        ai_status: null,
        ai_status_changed_at: new Date().toISOString(),
        ai_resume_at: null,
        ai_approval: null,
        ai_lock_until: null,
        ai_paused_by: null,
      })
      .eq('organization_id', orgId)
      .not('ai_agent_id', 'is', null)
      .select('id');
    if (convError) {
      return json({ error: `Agente bloqueado, mas falhou ao desvincular as conversas: ${convError.message}` }, 500);
    }
    desvinculadas = (data ?? []).length;
    await admin
      .from('wa_ai_agent_deal_starts')
      .update({ status: 'cancelled', processed_at: new Date().toISOString() })
      .eq('organization_id', orgId)
      .eq('status', 'pending');
  }

  await logSuperAdminAction(admin, {
    action: 'superadmin.org.ai_agents',
    actor_id: me.id,
    org_id: orgId,
    resource_type: 'organization',
    resource_id: orgId,
    details: { org: (org as { name?: string }).name, enabled, desvinculadas },
    severity: 'warning',
  });

  return json({ ok: true, enabled, desvinculadas });
}
