import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authPublicApi } from '@/lib/public-api/auth';
import { isValidUUID } from '@/lib/supabase/utils';
import { moveStageByDealId, moveStageByIdentity } from '@/lib/public-api/dealsMoveStage';

export const runtime = 'nodejs';

const MoveStageSchema = z.object({
  // Option A: direct deal id
  deal_id: z.string().uuid().optional(),

  // Option B: identity within a board (no UUID)
  board_key_or_id: z.string().min(1).optional(),
  phone: z.string().optional(),
  email: z.string().optional(),

  // Target stage
  to_stage_id: z.string().uuid().optional(),
  to_stage_label: z.string().min(1).optional(),

  // Optional explicit close flag (independent of stage)
  mark: z.enum(['won', 'lost']).optional(),
}).strict()
  .refine((v) => !!(v.to_stage_id || v.to_stage_label), { message: 'to_stage_id or to_stage_label is required' })
  .refine((v) => {
    if (v.deal_id) return true;
    return !!(v.board_key_or_id && (v.phone || v.email));
  }, { message: 'Provide deal_id OR (board_key_or_id + phone/email)' });

export async function POST(request: Request) {
  const auth = await authPublicApi(request);
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status, headers: auth.headers });

  const body = await request.json().catch(() => null);
  const parsed = MoveStageSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', code: 'VALIDATION_ERROR' }, { status: 422 });
  }

  const target = {
    to_stage_id: parsed.data.to_stage_id ?? null,
    to_stage_label: parsed.data.to_stage_label ?? null,
  };
  const mark = parsed.data.mark ?? null;

  if (parsed.data.deal_id) {
    const dealId = parsed.data.deal_id;
    if (!isValidUUID(dealId)) {
      return NextResponse.json({ error: 'Invalid deal id', code: 'VALIDATION_ERROR' }, { status: 422 });
    }
    const res = await moveStageByDealId({ organizationId: auth.organizationId, dealId, target, mark });
    return NextResponse.json(res.body, { status: res.status });
  }

  const res = await moveStageByIdentity({
    organizationId: auth.organizationId,
    boardKeyOrId: parsed.data.board_key_or_id as string,
    phone: parsed.data.phone ?? null,
    email: parsed.data.email ?? null,
    target,
    mark,
  });
  return NextResponse.json(res.body, { status: res.status });
}

