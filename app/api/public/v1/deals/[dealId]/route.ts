import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authPublicApi } from '@/lib/public-api/auth';
import { createStaticAdminClient } from '@/lib/supabase/server';
import { isValidUUID, sanitizeUUID } from '@/lib/supabase/utils';
import { normalizeText } from '@/lib/public-api/sanitize';
import { moveStageByDealId } from '@/lib/public-api/dealsMoveStage';
import { resolveOwnerId } from '@/lib/public-api/resolve';

export const runtime = 'nodejs';

// Inline activity payload that can be created atomically as part of a deal PATCH.
// Scoped to the deal being updated — cross-deal activities must still use the
// dedicated /activities endpoint.
const InlineActivitySchema = z.object({
  type: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  date: z.string().optional(), // ISO; defaults to now
}).strict();

const DealPatchSchema = z.object({
  title: z.string().optional(),
  description: z.string().nullable().optional(),
  // Append-to-existing description (mirrors tags_add) — lets integrations add a
  // line without a GET-merge-PATCH round-trip. Mutually exclusive with
  // `description` (replace).
  description_append: z.string().optional(),
  value: z.number().optional(),
  contact_id: z.string().uuid().optional(),
  client_company_id: z.string().uuid().nullable().optional(),
  // Responsável (owner): owner_id (UUID; null limpa) OU owner_email.
  owner_id: z.string().uuid().nullable().optional(),
  owner_email: z.string().email().optional(),
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
  // Unified stage change — lets integrations do everything in one PATCH instead
  // of a separate POST /deals/{id}/move-stage round-trip.
  to_stage_id: z.string().uuid().optional(),
  to_stage_label: z.string().min(1).optional(),
  mark: z.enum(['won', 'lost']).optional(),
  // Optional activity creation (task/call/meeting/note) in the same request.
  activity: InlineActivitySchema.optional(),
  // Produtos ADICIONADOS na mesma chamada (espelha o POST /deals):
  // `product_id` = atalho p/ 1 produto do catálogo; `products_add` = lista
  // (product_id do catálogo OU name+price manual). Dispensa o POST /items.
  product_id: z.string().uuid().optional(),
  products_add: z.array(z.object({
    product_id: z.string().uuid().optional(),
    name: z.string().min(1).max(200).optional(),
    quantity: z.number().int().min(1).max(100000).optional(),
    price: z.number().min(0).optional(),
  }).strict()).max(50).optional(),
}).strict().refine(
  (v) => !(v.tags !== undefined && (v.tags_add !== undefined || v.tags_remove !== undefined)),
  { message: 'Use either `tags` (replace) OR `tags_add`/`tags_remove` (incremental), not both.' }
).refine(
  (v) => !(v.custom_fields !== undefined && v.custom_fields_patch !== undefined),
  { message: 'Use either `custom_fields` (replace) OR `custom_fields_patch` (merge), not both.' }
).refine(
  (v) => !(v.description !== undefined && v.description_append !== undefined),
  { message: 'Use either `description` (replace) OR `description_append` (append), not both.' }
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
    .select('id,title,description,value,board_id,stage_id,contact_id,client_company_id,is_won,is_lost,loss_reason,closed_at,created_at,updated_at,owner_id,tags,custom_fields,probability,priority')
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
    return NextResponse.json(
      { error: 'Invalid payload', code: 'VALIDATION_ERROR', details: parsed.error.flatten() },
      { status: 422 }
    );
  }

  const sb = createStaticAdminClient();

  // Always fetch the current row to (a) validate ownership up-front with a
  // clear 404 and (b) compute merged tags/custom_fields when the caller asks
  // for incremental semantics.
  const { data: current, error: currentError } = await sb
    .from('deals')
    .select('id,description,tags,custom_fields')
    .eq('organization_id', auth.organizationId)
    .eq('id', dealId)
    .is('deleted_at', null)
    .maybeSingle();
  if (currentError) return NextResponse.json({ error: currentError.message, code: 'DB_ERROR' }, { status: 500 });
  if (!current) return NextResponse.json({ error: 'Deal not found', code: 'NOT_FOUND' }, { status: 404 });

  // Produtos (validação ANTES de aplicar qualquer update, p/ falhar limpo):
  // resolve product_id(s) do catálogo (org-scoped) e itens manuais name+price.
  type ResolvedItem = { product_id: string | null; name: string; quantity: number; price: number };
  let resolvedItems: ResolvedItem[] = [];
  {
    const rawItems: Array<{ product_id?: string; name?: string; quantity?: number; price?: number }> = [];
    if (parsed.data.product_id) rawItems.push({ product_id: parsed.data.product_id });
    if (parsed.data.products_add?.length) rawItems.push(...parsed.data.products_add);
    if (rawItems.length) {
      const productIds = Array.from(
        new Set(rawItems.map((i) => sanitizeUUID(i.product_id)).filter(Boolean) as string[])
      );
      const productMap = new Map<string, { name: string; price: number }>();
      if (productIds.length) {
        const { data: prods, error: prodErr } = await sb
          .from('products')
          .select('id,name,price')
          .eq('organization_id', auth.organizationId)
          .in('id', productIds);
        if (prodErr) return NextResponse.json({ error: prodErr.message, code: 'DB_ERROR' }, { status: 500 });
        for (const p of prods || []) {
          productMap.set(p.id as string, { name: p.name as string, price: Number((p as any).price ?? 0) });
        }
        const missing = productIds.find((id) => !productMap.has(id));
        if (missing) {
          return NextResponse.json({ error: `Produto não encontrado nesta organização: ${missing}`, code: 'PRODUCT_NOT_FOUND' }, { status: 422 });
        }
      }
      resolvedItems = rawItems.map((i) => {
        const pid = sanitizeUUID(i.product_id) || null;
        const prod = pid ? productMap.get(pid) : null;
        const name = (i.name?.trim() || prod?.name || '').trim();
        const price = i.price != null ? Number(i.price) : prod ? prod.price : 0;
        return { product_id: pid, name, quantity: i.quantity ?? 1, price };
      });
      if (resolvedItems.some((it) => !it.name)) {
        return NextResponse.json({ error: 'Cada produto precisa de product_id (do catálogo) ou name', code: 'VALIDATION_ERROR' }, { status: 422 });
      }
    }
  }

  const currentTags: string[] = Array.isArray(current.tags) ? (current.tags as string[]) : [];
  const currentCustomFields: Record<string, unknown> =
    (current.custom_fields && typeof current.custom_fields === 'object')
      ? (current.custom_fields as Record<string, unknown>)
      : {};

  const updates: any = {};
  if (parsed.data.title !== undefined) updates.title = normalizeText(parsed.data.title);
  if (parsed.data.description !== undefined) {
    updates.description = parsed.data.description === null ? null : (parsed.data.description.trim() || null);
  } else if (parsed.data.description_append !== undefined) {
    // Append onto the current description (newline-separated). A blank/whitespace
    // addition is a no-op so we never dirty the field for nothing.
    const addition = parsed.data.description_append.trim();
    if (addition) {
      const cur = typeof current.description === 'string' ? current.description.trim() : '';
      updates.description = cur ? `${cur}\n${addition}` : addition;
    }
  }
  if (parsed.data.value !== undefined) updates.value = Number(parsed.data.value ?? 0);
  if (parsed.data.contact_id !== undefined) updates.contact_id = sanitizeUUID(parsed.data.contact_id);
  if (parsed.data.client_company_id !== undefined) updates.client_company_id = parsed.data.client_company_id === null ? null : (sanitizeUUID(parsed.data.client_company_id) || null);
  if (parsed.data.loss_reason !== undefined) updates.loss_reason = parsed.data.loss_reason === null ? null : normalizeText(parsed.data.loss_reason);

  // Responsável (owner): owner_id (null limpa) OU owner_email (resolve p/ id).
  if (parsed.data.owner_id !== undefined || parsed.data.owner_email !== undefined) {
    if (parsed.data.owner_id === null) {
      updates.owner_id = null;
    } else {
      const ownerRes = await resolveOwnerId({
        organizationId: auth.organizationId,
        ownerId: parsed.data.owner_id,
        ownerEmail: parsed.data.owner_email,
      });
      if (!ownerRes.ok) return NextResponse.json({ error: ownerRes.error, code: 'OWNER_NOT_FOUND' }, { status: 422 });
      updates.owner_id = ownerRes.ownerId;
    }
  }

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
  const now = new Date().toISOString();
  updates.updated_at = now;

  // Apply the plain column updates first (if any). When the only change is a
  // stage move (no field updates), we skip this UPDATE entirely so we don't
  // touch updated_at redundantly before the move handler writes it too.
  const hasFieldUpdates = Object.keys(updates).some(k => k !== 'updated_at');

  if (hasFieldUpdates) {
    const { error: updateError } = await sb
      .from('deals')
      .update(updates)
      .eq('organization_id', auth.organizationId)
      .eq('id', dealId);
    if (updateError) return NextResponse.json({ error: updateError.message, code: 'DB_ERROR' }, { status: 500 });
  }

  // Stage move (optional). Delegates to the shared helper so semantics match
  // the dedicated POST /deals/{id}/move-stage endpoint exactly — including
  // won/lost auto-marking when the target stage is the board's won/lost stage.
  let stageMoveBody: unknown = null;
  if (parsed.data.to_stage_id || parsed.data.to_stage_label || parsed.data.mark) {
    const move = await moveStageByDealId({
      organizationId: auth.organizationId,
      dealId,
      target: {
        to_stage_id: parsed.data.to_stage_id ?? null,
        to_stage_label: parsed.data.to_stage_label ?? null,
      },
      mark: parsed.data.mark ?? null,
    });
    if (!move.ok) return NextResponse.json(move.body, { status: move.status });
    stageMoveBody = move.body;
  }

  // Insere os itens (produtos) resolvidos acima — best-effort como a activity:
  // se falhar, o restante do PATCH já foi aplicado e o erro vai em products_error.
  let itemsAdded: unknown[] = [];
  let productsError: string | null = null;
  if (resolvedItems.length) {
    const { data: itemsData, error: itemsErr } = await sb
      .from('deal_items')
      .insert(resolvedItems.map((it) => ({
        deal_id: dealId,
        organization_id: auth.organizationId,
        name: it.name,
        quantity: it.quantity,
        price: it.price,
        product_id: it.product_id,
      })))
      .select('id,product_id,name,quantity,price,created_at');
    if (itemsErr) productsError = itemsErr.message;
    else itemsAdded = (itemsData || []).map((i: any) => ({ ...i, price: Number(i.price ?? 0) }));
  }

  // Inline activity creation (optional). Best-effort: if the create fails the
  // error is surfaced in `activity_error` but the deal update already succeeded,
  // so we still return 200.
  let createdActivity: unknown = null;
  let activityError: string | null = null;
  if (parsed.data.activity) {
    const act = parsed.data.activity;
    const when = act.date ? new Date(act.date) : new Date();
    if (Number.isNaN(when.getTime())) {
      activityError = 'Invalid activity.date';
    } else {
      const { data: actRow, error: actErr } = await sb
        .from('activities')
        .insert({
          organization_id: auth.organizationId,
          title: normalizeText(act.title) || act.title,
          description: act.description ? normalizeText(act.description) : null,
          type: normalizeText(act.type) || act.type,
          date: when.toISOString(),
          completed: false,
          deal_id: dealId,
          created_at: new Date().toISOString(),
        })
        .select('id,title,description,type,date,completed,deal_id,contact_id,client_company_id,created_at')
        .single();
      if (actErr) activityError = actErr.message;
      else createdActivity = actRow;
    }
  }

  // Re-read the final row so the response reflects both the field updates and
  // the stage move in a single payload.
  const { data: finalRow, error: finalErr } = await sb
    .from('deals')
    .select('id,title,description,value,board_id,stage_id,contact_id,client_company_id,is_won,is_lost,loss_reason,closed_at,created_at,updated_at,owner_id,tags,custom_fields,probability,priority')
    .eq('organization_id', auth.organizationId)
    .eq('id', dealId)
    .maybeSingle();
  if (finalErr) return NextResponse.json({ error: finalErr.message, code: 'DB_ERROR' }, { status: 500 });
  if (!finalRow) return NextResponse.json({ error: 'Deal not found', code: 'NOT_FOUND' }, { status: 404 });

  const [boardRes, stageRes] = await Promise.all([
    finalRow.board_id ? sb.from('boards').select('name,key').eq('id', finalRow.board_id).maybeSingle() : Promise.resolve({ data: null }),
    finalRow.stage_id ? sb.from('board_stages').select('name,label').eq('id', finalRow.stage_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const boardName = (boardRes.data as any)?.name ?? null;
  const boardKey = (boardRes.data as any)?.key ?? null;
  const stageName = (stageRes.data as any) ? ((stageRes.data as any).label || (stageRes.data as any).name) : null;

  const responseBody: Record<string, unknown> = {
    data: {
      ...finalRow,
      description: finalRow.description ?? null,
      value: Number(finalRow.value ?? 0),
      tags: finalRow.tags ?? [],
      custom_fields: finalRow.custom_fields ?? {},
      probability: finalRow.probability ?? 0,
      priority: finalRow.priority ?? 'medium',
      board_name: boardName,
      board_key: boardKey,
      stage_name: stageName,
    },
  };
  if (stageMoveBody) responseBody.stage_move = stageMoveBody;
  if (createdActivity) responseBody.activity = createdActivity;
  if (activityError) responseBody.activity_error = activityError;
  if (itemsAdded.length) responseBody.items_added = itemsAdded;
  if (productsError) responseBody.products_error = productsError;
  return NextResponse.json(responseBody);
}
