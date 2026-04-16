import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authPublicApi } from '@/lib/public-api/auth';
import { createStaticAdminClient } from '@/lib/supabase/server';
import { isValidUUID, sanitizeUUID } from '@/lib/supabase/utils';
import { decodeOffsetCursor, encodeOffsetCursor, parseLimit } from '@/lib/public-api/cursor';

export const runtime = 'nodejs';

const ItemCreateSchema = z.object({
  name: z.string().min(1),
  quantity: z.number().int().min(1).optional().default(1),
  price: z.number().min(0).optional().default(0),
  product_id: z.string().uuid().optional(),
}).strict();

export async function GET(request: Request, ctx: { params: Promise<{ dealId: string }> }) {
  const auth = await authPublicApi(request);
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status });

  const { dealId } = await ctx.params;
  if (!isValidUUID(dealId)) {
    return NextResponse.json({ error: 'Invalid deal id', code: 'VALIDATION_ERROR' }, { status: 422 });
  }

  const url = new URL(request.url);
  const limit = parseLimit(url.searchParams.get('limit'));
  const offset = decodeOffsetCursor(url.searchParams.get('cursor'));

  const sb = createStaticAdminClient();

  // Verify deal belongs to org
  const { data: deal } = await sb
    .from('deals')
    .select('id,organization_id')
    .eq('id', dealId)
    .eq('organization_id', auth.organizationId)
    .is('deleted_at', null)
    .maybeSingle();
  if (!deal) return NextResponse.json({ error: 'Deal not found', code: 'NOT_FOUND' }, { status: 404 });

  const { data, count, error } = await sb
    .from('deal_items')
    .select('id,product_id,name,quantity,price,created_at', { count: 'exact' })
    .eq('deal_id', dealId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) return NextResponse.json({ error: error.message, code: 'DB_ERROR' }, { status: 500 });

  const total = count ?? 0;
  const nextOffset = offset + limit;
  const nextCursor = nextOffset < total ? encodeOffsetCursor(nextOffset) : null;

  return NextResponse.json({
    data: (data ?? []).map((i: any) => ({ ...i, price: Number(i.price ?? 0) })),
    nextCursor,
  });
}

export async function POST(request: Request, ctx: { params: Promise<{ dealId: string }> }) {
  const auth = await authPublicApi(request);
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status });

  const { dealId } = await ctx.params;
  if (!isValidUUID(dealId)) {
    return NextResponse.json({ error: 'Invalid deal id', code: 'VALIDATION_ERROR' }, { status: 422 });
  }

  const body = await request.json().catch(() => null);
  const parsed = ItemCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', code: 'VALIDATION_ERROR' }, { status: 422 });
  }

  const sb = createStaticAdminClient();

  // Verify deal belongs to org
  const { data: deal } = await sb
    .from('deals')
    .select('id,organization_id')
    .eq('id', dealId)
    .eq('organization_id', auth.organizationId)
    .is('deleted_at', null)
    .maybeSingle();
  if (!deal) return NextResponse.json({ error: 'Deal not found', code: 'NOT_FOUND' }, { status: 404 });

  const { data, error } = await sb
    .from('deal_items')
    .insert({
      deal_id: dealId,
      organization_id: auth.organizationId,
      name: parsed.data.name.trim(),
      quantity: parsed.data.quantity,
      price: parsed.data.price,
      product_id: sanitizeUUID(parsed.data.product_id) || null,
    })
    .select('id,product_id,name,quantity,price,created_at')
    .single();

  if (error) return NextResponse.json({ error: error.message, code: 'DB_ERROR' }, { status: 500 });

  return NextResponse.json({ data: { ...data, price: Number(data.price ?? 0) }, action: 'created' }, { status: 201 });
}
