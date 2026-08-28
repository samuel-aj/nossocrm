/**
 * GET /api/public/v1/whatsapp/agents -> agentes de IA nativos da organização.
 *
 * Serve para a integração descobrir o `agent_id` que vai em
 * POST /whatsapp/conversations/agent.
 *
 * -> { data: [{ id, name, persona_name, enabled }] }
 */
import { NextResponse } from 'next/server';
import { authPublicApi } from '@/lib/public-api/auth';
import { createStaticAdminClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const auth = await authPublicApi(request);
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status });

  const sb = createStaticAdminClient();
  const { data, error } = await sb
    .from('wa_ai_agents')
    .select('id, name, persona_name, enabled')
    .eq('organization_id', auth.organizationId)
    .order('name', { ascending: true });
  if (error) return NextResponse.json({ error: error.message, code: 'DB_ERROR' }, { status: 500 });

  return NextResponse.json({
    data: (data ?? []).map(a => ({
      id: String(a.id),
      name: String(a.name ?? ''),
      persona_name: (a.persona_name as string | null) ?? null,
      enabled: a.enabled === true,
    })),
  });
}
