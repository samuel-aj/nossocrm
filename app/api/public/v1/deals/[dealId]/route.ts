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
  // Full-replace semantics (backwards compatible).
  tags: z.array(z.string()).optional(),
  custom_fields: z.record(z.string(), z.any()).optional(),
  // Incremental semantics — additive / subtractive so integrations don't
  // need to GET-merge-PATCH just to add a tag or set a single custom field.
  tags_add: z.array(z.string()).optional(),
  tags_remove: z.array(z.string()).optional(),
  custom_fields_patch: z.record(z.string(), z.any()).optional(),
  probability: z.number().int().min(0).max(100).optional(),
  priority: z.enum(['low', 'medium', 'high']).optional(),
}).strict().refine(
  (v) => !(v.tags !== undefined && (v.tags_add !== undefined || v.tags_remove !== undefined)),
  { message: 'Use either `tags` (replace) OR `tags_add`/`tags_remove` (incremental), not both.' }
).refine(
  (v) => !(v.custom_fields !== undefined && v.custom_fields_patch !== undefined),
  { message: 'Use either `custom_fields` (replace) OR `custom_fields_patch` (merge), not both.' }
);

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

  const sb = createStaticAdminClient();

  // If the caller asked for incremental tags/custom_fields changes, we need
  // the current row to compute the merged value. Single SELECT scoped to the
  // caller's org so we also reject unknown/foreign deal ids with 404 before
  // the UPDATE runs.
  const needsCurrent =
    parsed.data.tags_add !== undefined ||
    parsed.data.tags_remove !== undefined ||
    parsed.data.custom_fields_patch !== undefined;

  let currentTags: string[] = [];
  let currentCustomFields: Record<string, unknown> = {};
  if (needsCurrent) {
    const { data: current, error: currentError } = await sb
      .from('deals')
      .select('tags,custom_fields')
      .eq('organization_id', auth.organizationId)
      .eq('id', dealId)
      .is('deleted_at', null)
      .maybeSingle();
    if (currentError) return NextResponse.json({ error: currentError.message, code: 'DB_ERROR' }, { status: 500 });
    if (!current) return NextResponse.json({ error: 'Deal not found', code: 'NOT_FOUND' }, { status: 404 });
    currentTags = Array.isArray(current.tags) ? (current.tags as string[]) : [];
    currentCustomFields = (current.custom_fields && typeof current.custom_fields === 'object') ? current.custom_fields as Record<string, unknown> : {};
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

  // Tags: replace vs. incremental. Incremental path merges onto the current
  // array, dedupes (case-sensitive), removes anything in tags_remove, and
  // preserves insertion order of the original + appended-new.
  if (parsed.data.tags !== undefined) {
    updates.tags = parsed.data.tags;
  } else if (parsed.data.tags_add !== undefined || parsed.data.tags_remove !== undefined) {
    const toAdd = parsed.data.tags_add ?? [];
    const toRemove = new Set(parsed.data.tags_remove ?? []);
    const next: string[] = [];
    const seen = new Set<string>();
    for (const t of [...currentTags, ...toAdd]) {
      if (!t || toRemove.has(t) || seen.has(t)) continue;
      seen.add(t);
      next.push(t);
    }
    updates.tags = next;
  }

  // Custom fields: replace vs. merge. `custom_fields_patch` spread onto the
  // current object; keys with value `null` are deleted (lets callers clear
  // individual fields without wiping the whole object).
  if (parsed.data.custom_fields !== undefined) {
    updates.custom_fields = parsed.data.custom_fields;
  } else if (parsed.data.custom_fields_patch !== undefined) {
    const merged: Record<string, unknown> = { ...currentCustomFields };
    for (const [k, v] of Object.entries(parsed.data.custom_fields_patch)) {
      if (v === null) delete merged[k];
      else merged[k] = v;
    }
    updates.custom_fields = merged;
  }

  if (parsed.data.probability !== undefined) updates.probability = parsed.data.probability;
  if (parsed.data.priority !== undefined) updates.priority = parsed.data.priority;
  updates.updated_at = new Date().toISOString();

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

