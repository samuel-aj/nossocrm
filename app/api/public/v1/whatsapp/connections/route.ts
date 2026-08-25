/**
 * GET /api/public/v1/whatsapp/connections -> números de WhatsApp da organização.
 *
 * Use o `id` em `connection_id` ao enviar por POST /whatsapp/messages quando a
 * org tem mais de um número (omitido = o número padrão).
 */
import { NextResponse } from 'next/server';
import { authPublicApi } from '@/lib/public-api/auth';
import { createStaticAdminClient } from '@/lib/supabase/server';
import { getConnectionsByOrg } from '@/lib/whatsapp/service';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const auth = await authPublicApi(request);
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status });

  const sb = createStaticAdminClient();
  const rows = await getConnectionsByOrg(sb, auth.organizationId);
  return NextResponse.json({
    data: rows.map(c => ({
      id: c.id,
      phone_number: c.phone_number ?? null,
      name: c.profile_name ?? null,
      provider: c.provider,
      status: c.status,
      // API oficial da Meta: única que envia modelos (templates) aprovados
      official_api: c.provider === 'meta_cloud',
      supports_templates: c.provider === 'meta_cloud',
    })),
  });
}
