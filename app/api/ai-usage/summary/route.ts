import { z } from 'zod';
import { getUsagePolicy } from '@/lib/ai-usage/budget';
import { canonicalizeUsageAccounts, readFirstGainEvents, readUsageAccountLinks, readUsageAttempts, summarizeContractUsage, summarizeUsage, usageAccountRoots, usagePeriod } from '@/lib/ai-usage/reporting';
import { json } from '@/lib/whatsapp/api';
import { guardRoute, usageError, validationError } from '../_shared';
export const runtime = 'nodejs';
const Query = z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  provider: z.string().max(80).optional(), model: z.string().max(160).optional(), operation: z.string().max(80).optional(),
  scope: z.enum(['conversation', 'test', 'configuration', 'knowledge', 'crm']).optional(),
});
export async function GET(req: Request) {
  const auth = await guardRoute({ admin: true }); if (!auth.ok) return auth.response;
  const parsed = Query.safeParse(Object.fromEntries(new URL(req.url).searchParams)); if (!parsed.success) return validationError(parsed.error);
  try {
    const policy = await getUsagePolicy(auth.admin, auth.user.organizationId);
    let period;
    try { period = usagePeriod(parsed.data.from, parsed.data.to, policy.timezone); }
    catch (error) { return json({ error: (error as Error).message }, 400); }
    const asOf = new Date().toISOString();
    const snapshot = { ...period, end: Date.parse(period.end) < Date.parse(asOf) ? period.end : asOf };
    const [attempts, blocked, links] = await Promise.all([
      readUsageAttempts(auth.admin, auth.user.organizationId, snapshot),
      auth.admin.from('ai_usage_accounts').select('id', { count: 'exact', head: true }).eq('organization_id', auth.user.organizationId).is('merged_into', null).not('blocked_at', 'is', null),
      readUsageAccountLinks(auth.admin, auth.user.organizationId),
    ]);
    if (blocked.error) return usageError();
    const roots = usageAccountRoots(links);
    const all = canonicalizeUsageAccounts(attempts, roots);
    const f = parsed.data;
    const rows = all.filter(r => (!f.provider || r.provider === f.provider) && (!f.model || r.model === f.model) && (!f.operation || r.operation === f.operation) && (!f.scope || r.scope === f.scope));
    const summary = summarizeUsage(rows, period, blocked.count ?? 0);
    summary.options = summarizeUsage(all, period).options;
    summary.coverage.firstMeasuredAt = policy.measurement_started_at;
    const wins = await readFirstGainEvents(auth.admin, auth.user.organizationId, snapshot.end, asOf);
    const sinceCoverage = policy.measurement_started_at && Date.parse(policy.measurement_started_at) < Date.parse(period.start)
      ? canonicalizeUsageAccounts(await readUsageAttempts(auth.admin, auth.user.organizationId, { ...snapshot, start: policy.measurement_started_at }), roots) : all;
    summary.coverage.contracts = summarizeContractUsage(sinceCoverage, wins, policy.measurement_started_at, period);
    const contracts = summary.coverage.contracts;
    summary.coverage.contractReason = `${contracts.coveredDeals} negócios com primeiro ganho no período e cobertura comprovada; ${contracts.excludedDeals} excluídos por histórico parcial, consumo pendente ou vínculo ambíguo. Valores até o primeiro ganho, independentemente dos filtros de modelo/finalidade.`;
    const ids = [...new Set(summary.conversations.map(c => c.conversationId).filter((id): id is string => !!id))];
    for (let offset = 0; offset < ids.length; offset += 100) {
      const { data, error } = await auth.admin.from('wa_conversations').select('id,wa_name').eq('organization_id', auth.user.organizationId).in('id', ids.slice(offset, offset + 100));
      if (error) return usageError();
      for (const row of data ?? []) for (const item of summary.conversations) if (item.conversationId === row.id) item.name = row.wa_name || 'Atendimento sem nome';
    }
    return json(summary);
  } catch { return usageError(); }
}
