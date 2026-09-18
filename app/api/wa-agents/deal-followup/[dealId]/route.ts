/**
 * GET /api/wa-agents/deal-followup/[dealId]  (membro da org)
 *   -> { followup: { rule, schedule } | null }
 * Estado do follow-up por inatividade do lead, mostrado discretamente na tela dele.
 */
import { json } from '@/lib/whatsapp/api';
import { isValidUUID } from '@/lib/supabase/utils';
import { guardRoute } from '../../_shared';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ dealId: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const auth = await guardRoute();
  if (!auth.ok) return auth.response;
  const { dealId } = await ctx.params;
  if (!isValidUUID(dealId)) return json({ error: 'ID inválido' }, 400);
  const orgId = auth.user.organizationId;

  const { data: deal } = await auth.admin
    .from('deals')
    .select('id, stage_id, organization_id')
    .eq('id', dealId)
    .eq('organization_id', orgId)
    .maybeSingle();
  if (!deal) return json({ error: 'Lead não encontrado' }, 404);
  const stageId = (deal as { stage_id: string | null }).stage_id;

  const [{ data: sched, error }, { data: rule }] = await Promise.all([
    auth.admin
      .from('deal_followup_schedules')
      .select('status, due_at, fired_at, last_result, stage_id, anchor_at')
      .eq('deal_id', dealId)
      .maybeSingle(),
    stageId
      ? auth.admin.from('stage_followup_rules').select('enabled, delay_seconds, action_type').eq('stage_id', stageId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  if (error) return json({ followup: null });
  const r = rule as { enabled: boolean; delay_seconds: number; action_type: string } | null;
  const s = sched as {
    status: string;
    due_at: string;
    fired_at: string | null;
    last_result: unknown;
    stage_id: string;
    anchor_at: string;
  } | null;
  if (!r?.enabled) return json({ followup: null });
  // agendamento de outra etapa não vale para a etapa atual
  return json({ followup: { rule: r, schedule: s && s.stage_id === stageId ? s : null } });
}
