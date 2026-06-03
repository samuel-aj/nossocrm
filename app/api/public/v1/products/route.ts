import { NextResponse } from 'next/server';
import { authPublicApi } from '@/lib/public-api/auth';
import { createStaticAdminClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

// Lista os produtos ativos da organização autenticada (pela API Key).
// Usado por integrações (ex.: n8n) que precisam escolher um produto
// dinamicamente — sem hardcode de IDs por organização.
export async function GET(request: Request) {
  const auth = await authPublicApi(request);
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status });

  const sb = createStaticAdminClient();
  const { data, error } = await sb
    .from('products')
    .select('id,name,price,description,sku')
    .eq('organization_id', auth.organizationId)
    .eq('active', true)
    .order('name', { ascending: true });

  if (error) return NextResponse.json({ error: error.message, code: 'DB_ERROR' }, { status: 500 });

  return NextResponse.json({
    data: (data || []).map((p: any) => ({
      id: p.id,
      name: p.name,
      price: Number(p.price ?? 0),
      description: p.description ?? null,
      sku: p.sku ?? null,
    })),
  });
}
