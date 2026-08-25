/**
 * GET /api/wa-agents/runs  (admin)
 * query: agentId?, conversationId?, limit? (<= 100, padrão 50), before? (cursor created_at)
 * -> { runs: RunRow[], agents: Record<id, name> }
 */
import { z } from 'zod';
import { json } from '@/lib/whatsapp/api';
import type { RunRow } from '@/lib/wa-agents/types';
import { guardRoute, searchParamsToObject, validationError } from '../_shared';

export const runtime = 'nodejs';

const QuerySchema = z.object({
  agentId: z.string().uuid().optional(),
  conversationId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  before: z
    .string()
    .max(64)
    .refine(v => !Number.isNaN(Date.parse(v)), 'Data inválida')
    .optional(),
});

export async function GET(req: Request) {
  const auth = await guardRoute({ admin: true });
  if (!auth.ok) return auth.response;
  const orgId = auth.user.organizationId;

  const parsed = QuerySchema.safeParse(searchParamsToObject(req));
  if (!parsed.success) return validationError(parsed.error);
  const { agentId, conversationId, limit, before } = parsed.data;

  let query = auth.admin
    .from('wa_ai_agent_runs')
    .select('*')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (agentId) query = query.eq('agent_id', agentId);
  if (conversationId) query = query.eq('conversation_id', conversationId);
  if (before) query = query.lt('created_at', new Date(before).toISOString());

  const [runsRes, agentsRes] = await Promise.all([
    query,
    auth.admin.from('wa_ai_agents').select('id, name').eq('organization_id', orgId),
  ]);
  if (runsRes.error) return json({ error: runsRes.error.message }, 500);
  if (agentsRes.error) return json({ error: agentsRes.error.message }, 500);

  const agents: Record<string, string> = {};
  for (const a of agentsRes.data ?? []) agents[String(a.id)] = String(a.name ?? '');

  return json({ runs: (runsRes.data ?? []) as RunRow[], agents });
}
