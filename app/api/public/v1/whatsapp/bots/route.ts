/**
 * GET /api/public/v1/whatsapp/bots -> robôs de atendimento da organização.
 *
 * Serve para a integração descobrir o `bot_id` que vai em
 * POST /whatsapp/conversations/bot.
 *
 * -> { data: [{ id, name, enabled, connection_id }] }
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
    .from('wa_bots')
    .select('id, name, enabled, connection_id')
    .eq('organization_id', auth.organizationId)
    .order('name', { ascending: true });
  if (error) return NextResponse.json({ error: error.message, code: 'DB_ERROR' }, { status: 500 });

  return NextResponse.json({
    data: (data ?? []).map(b => ({
      id: String(b.id),
      name: String(b.name ?? ''),
      enabled: b.enabled === true,
      connection_id: (b.connection_id as string | null) ?? null,
    })),
  });
}
