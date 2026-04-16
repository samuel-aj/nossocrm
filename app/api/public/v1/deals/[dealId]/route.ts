import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authPublicApi } from '@/lib/public-api/auth';
import { createStaticAdminClient } from '@/lib/supabase/server';
import { isValidUUID, sanitizeUUID } from '@/lib/supabase/utils';
import { normalizeText } from '@/lib/public-api/sanitize';

export const runtime = 'nodejs';

const DealPatchSchema = z.object({
  title: z.string().optional(),
  description: z.string().nullable().optional(),
  value: z.number().optional(),
  contact_id: z.string().uuid().optional(),
  client_company_id: z.string().uuid().nullable().optional(),
  loss_reason: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  custom_fields: z.record(z.string(), z.any()).optional(),
  probability: z.number().int().min(0).max(100).optional(),
  priority: z.enum(['low', 'medium', 'high']).optional(),
}).strict();

export async function GET(request: Request, ctx: { params: Promise<{ dealId: string }> }) {
  const auth = await authPublicApi(request);
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status });

  const { dealId } = await ctx.params;
  if (!isValidUUID(dealId)) {
    return NextResponse.json({ error: 'Invalid deal id', code: 'VALIDATION_ERROR' }, { status: 422 });
  }

  const sb = createStaticAdminClient();
  const { data, error } = await sb
    .from('deals')
    .select('id,title,description,value,board_id,stage_id,contact_id,client_company_id,is_won,is_lost,loss_reason,closed_at,created_at,updated_at,tags,custom_fields,probability,priority')
    .eq('organization_id', auth.organizationId)
    .is('deleted_at', null)
    .eq('id', dealId)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message, code: 'DB_ERROR' }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Deal not found', code: 'NOT_FOUND' }, { status: 404 });

  // Fetch related notes, items, board and stage names in parallel
  const [notesRes, itemsRes, boardRes, stageRes] = await Promise.all([
    sb.from('deal_notes').select('id,content,created_at,updated_at').eq('deal_id', dealId).order('created_at', { ascending: false }),
    sb.from('deal_items').select('id,product_id,name,quantity,price,created_at').eq('deal_id', dealId).order('created_at', { ascending: false }),
    data.board_id ? sb.from('boards').select('name,key').eq('id', data.board_id).maybeSingle() : Promise.resolve({ data: null }),
    data.stage_id ? sb.from('board_stages').select('name,label').eq('id', data.stage_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);

  const boardName = (boardRes.data as any)?.name ?? null;
  const boardKey = (boardRes.data as any)?.key ?? null;
  const stageName = (stageRes.data as any) ? ((stageRes.data as any).label || (stageRes.data as any).name) : null;

  return NextResponse.json({
    data: {
      ...data,
      description: data.description ?? null,
      value: Number(data.value ?? 0),
      tags: data.tags ?? [],
      custom_fields: data.custom_fields ?? {},
      probability: data.probability ?? 0,
      priority: data.priority ?? 'medium',
      board_name: boardName,
      board_key: boardKey,
      stage_name: stageName,
      notes: notesRes.data ?? [],
      items: (itemsRes.data ?? []).map((i: any) => ({ ...i, price: Number(i.price ?? 0) })),
    },
  });
}

export async function PATCH(request: Request, ctx: { params: Promise<{ dealId: string }> }) {
  const auth = await authPublicApi(request);
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status });

  const { dealId } = await ctx.params;
  if (!isValidUUID(dealId)) {
    return NextResponse.json({ error: 'Invalid deal id', code: 'VALIDATION_ERROR' }, { status: 422 });
  }

  const body = await request.json().catch(() => null);
  const parsed = DealPatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', code: 'VALIDATION_ERROR' }, { status: 422 });
  }

  const updates: any = {};
  if (parsed.data.title !== undefined) updates.title = normalizeText(parsed.data.title);
  if (parsed.data.description !== undefined) {
    updates.description = parsed.data.description === null ? null : (parsed.data.description.trim() || null);
  }
  if (parsed.data.value !== undefined) updates.value = Number(parsed.data.value ?? 0);
  if (parsed.data.contact_id !== undefined) updates.contact_id = sanitizeUUID(parsed.data.contact_id);
  if (parsed.data.client_company_id !== undefined) updates.client_company_id = parsed.data.client_company_id === null ? null : (sanitizeUUID(parsed.data.client_company_id) || null);
  if (parsed.data.loss_reason !== undefined) updates.loss_reason = parsed.data.loss_reason === null ? null : normalizeText(parsed.data.loss_reason);
  if (parsed.data.tags !== undefined) updates.tags = parsed.data.tags;
  if (parsed.data.custom_fields !== undefined) updates.custom_fields = parsed.data.custom_fields;
  if (parsed.data.probability !== undefined) updates.probability = parsed.data.probability;
  if (parsed.data.priority !== undefined) updates.priority = parsed.data.priority;
  updates.updated_at = new Date().toISOString();

  const sb = createStaticAdminClient();
  const { data, error } = await sb
    .from('deals')
    .update(updates)
    .eq('organization_id', auth.organizationId)
    .eq('id', dealId)
    .select('id,title,description,value,board_id,stage_id,contact_id,client_company_id,is_won,is_lost,loss_reason,closed_at,created_at,updated_at,tags,custom_fields,probability,priority')
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message, code: 'DB_ERROR' }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Deal not found', code: 'NOT_FOUND' }, { status: 404 });

  const [boardRes, stageRes] = await Promise.all([
    data.board_id ? sb.from('boards').select('name,key').eq('id', data.board_id).maybeSingle() : Promise.resolve({ data: null }),
    data.stage_id ? sb.from('board_stages').select('name,label').eq('id', data.stage_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const boardName = (boardRes.data as any)?.name ?? null;
  const boardKey = (boardRes.data as any)?.key ?? null;
  const stageName = (stageRes.data as any) ? ((stageRes.data as any).label || (stageRes.data as any).name) : null;

  return NextResponse.json({
    data: {
      ...data,
      description: data.description ?? null,
      value: Number(data.value ?? 0),
      tags: data.tags ?? [],
      custom_fields: data.custom_fields ?? {},
      probability: data.probability ?? 0,
      priority: data.priority ?? 'medium',
      board_name: boardName,
      board_key: boardKey,
      stage_name: stageName,
    },
  });
}

