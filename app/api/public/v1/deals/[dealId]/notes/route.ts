import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authPublicApi } from '@/lib/public-api/auth';
import { createStaticAdminClient } from '@/lib/supabase/server';
import { isValidUUID } from '@/lib/supabase/utils';
import { decodeOffsetCursor, encodeOffsetCursor, parseLimit } from '@/lib/public-api/cursor';

export const runtime = 'nodejs';

const NoteCreateSchema = z.object({
  content: z.string().min(1),
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
    .select('id')
    .eq('id', dealId)
    .eq('organization_id', auth.organizationId)
    .is('deleted_at', null)
    .maybeSingle();
  if (!deal) return NextResponse.json({ error: 'Deal not found', code: 'NOT_FOUND' }, { status: 404 });

  const { data, count, error } = await sb
    .from('deal_notes')
    .select('id,content,created_at,updated_at', { count: 'exact' })
    .eq('deal_id', dealId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) return NextResponse.json({ error: error.message, code: 'DB_ERROR' }, { status: 500 });

  const total = count ?? 0;
  const nextOffset = offset + limit;
  const nextCursor = nextOffset < total ? encodeOffsetCursor(nextOffset) : null;

  return NextResponse.json({ data: data ?? [], nextCursor });
}

export async function POST(request: Request, ctx: { params: Promise<{ dealId: string }> }) {
  const auth = await authPublicApi(request);
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status });

  const { dealId } = await ctx.params;
  if (!isValidUUID(dealId)) {
    return NextResponse.json({ error: 'Invalid deal id', code: 'VALIDATION_ERROR' }, { status: 422 });
  }

  const body = await request.json().catch(() => null);
  const parsed = NoteCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', code: 'VALIDATION_ERROR' }, { status: 422 });
  }

  const sb = createStaticAdminClient();

  // Verify deal belongs to org
  const { data: deal } = await sb
    .from('deals')
    .select('id')
    .eq('id', dealId)
    .eq('organization_id', auth.organizationId)
    .is('deleted_at', null)
    .maybeSingle();
  if (!deal) return NextResponse.json({ error: 'Deal not found', code: 'NOT_FOUND' }, { status: 404 });

  const now = new Date().toISOString();
  const { data, error } = await sb
    .from('deal_notes')
    .insert({
      deal_id: dealId,
      content: parsed.data.content.trim(),
      created_at: now,
      updated_at: now,
    })
    .select('id,content,created_at,updated_at')
    .single();

  if (error) return NextResponse.json({ error: error.message, code: 'DB_ERROR' }, { status: 500 });

  return NextResponse.json({ data, action: 'created' }, { status: 201 });
}
