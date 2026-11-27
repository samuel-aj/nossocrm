import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authPublicApi } from '@/lib/public-api/auth';
import { isValidUUID, sanitizeUUID } from '@/lib/supabase/utils';
import { moveStageByDealId } from '@/lib/public-api/dealsMoveStage';

export const runtime = 'nodejs';

const MoveStageSchema = z.object({
  to_stage_id: z.string().uuid().optional(),
  to_stage_label: z.string().min(1).optional(),
  mark: z.enum(['won', 'lost']).optional(),
}).strict().refine((v) => !!(v.to_stage_id || v.to_stage_label), {
  message: 'to_stage_id or to_stage_label is required',
});

export async function POST(request: Request, ctx: { params: Promise<{ dealId: string }> }) {
  const auth = await authPublicApi(request);
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status, headers: auth.headers });

  const { dealId } = await ctx.params;
  if (!isValidUUID(dealId)) {
    return NextResponse.json({ error: 'Invalid deal id', code: 'VALIDATION_ERROR' }, { status: 422 });
  }

  const body = await request.json().catch(() => null);
  const parsed = MoveStageSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', code: 'VALIDATION_ERROR' }, { status: 422 });
  }

  const res = await moveStageByDealId({
    organizationId: auth.organizationId,
    dealId: sanitizeUUID(dealId) || dealId,
    target: { to_stage_id: parsed.data.to_stage_id ?? null, to_stage_label: parsed.data.to_stage_label ?? null },
    mark: parsed.data.mark ?? null,
  });
  return NextResponse.json(res.body, { status: res.status });
}

