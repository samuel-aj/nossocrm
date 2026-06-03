import { NextResponse } from 'next/server';
import { authPublicApi } from '@/lib/public-api/auth';
import { createStaticAdminClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

// Lista as definições de campos personalizados da organização autenticada (pela API Key).
// Usado por integrações (ex.: n8n) que precisam descobrir a `key` de cada campo
// para preencher `custom_fields` ao criar um deal — sem hardcode por organização.
export async function GET(request: Request) {
  const auth = await authPublicApi(request);
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status });

  const url = new URL(request.url);
  const entityType = (url.searchParams.get('entity_type') || '').trim();

  const sb = createStaticAdminClient();
  let query = sb
    .from('custom_field_definitions')
    .select('id,key,label,type,options,entity_type,created_at')
    .eq('organization_id', auth.organizationId)
    .order('created_at', { ascending: true });

  if (entityType) query = query.eq('entity_type', entityType);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message, code: 'DB_ERROR' }, { status: 500 });

  return NextResponse.json({
    data: (data || []).map((f: any) => ({
      id: f.id,
      key: f.key,
      label: f.label,
      type: f.type,
      options: Array.isArray(f.options) ? f.options : null,
      entity_type: f.entity_type ?? 'deal',
    })),
  });
}
