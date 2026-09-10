import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { periodSchema, generalSchema } from '@/features/boards/filters/boardFilters';

type Context = { params: Promise<{ boardId: string }> };
const patchSchema = z.object({ period: periodSchema.nullable().optional(), general: generalSchema.nullable().optional() })
  .strict().refine(v => v.period !== undefined || v.general !== undefined);
async function access(req: Request, context: Context) {
  const { boardId } = await context.params;
  if (!z.string().uuid().safeParse(boardId).success) return { error: NextResponse.json({ error: 'Funil inválido.' }, { status: 422 }) };
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  // Authenticated board lookup uses existing board RLS, including custom roles.
  const { data: board } = await sb.from('boards').select('id,organization_id').eq('id', boardId).maybeSingle();
  if (!board || (req.headers.get('x-org-id') && req.headers.get('x-org-id') !== board.organization_id)) {
    return { error: NextResponse.json({ error: 'Acesso negado ao funil.' }, { status: 403 }) };
  }
  return { sb, userId: user.id, boardId };
}
export async function GET(req: Request, context: Context) {
  const auth = await access(req, context);
  if ('error' in auth) return auth.error;
  const { data, error } = await auth.sb.from('user_board_filters').select('period,general').eq('user_id', auth.userId).eq('board_id', auth.boardId).maybeSingle();
  if (error) return NextResponse.json({ error: 'Não foi possível carregar seus filtros.' }, { status: 500 });
  return NextResponse.json({ period: data?.period ?? null, general: data?.general ?? null });
}
export async function PATCH(req: Request, context: Context) {
  if (!isAllowedOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const auth = await access(req, context);
  if ('error' in auth) return auth.error;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Confira os filtros e as datas informadas.' }, { status: 422 });
  // Upsert updates only the submitted group, preserving the other pin.
  const { data, error } = await auth.sb.from('user_board_filters').upsert({ user_id: auth.userId, board_id: auth.boardId, ...parsed.data }, { onConflict: 'user_id,board_id' }).select('period,general').single();
  if (error) return NextResponse.json({ error: 'Não foi possível salvar seus filtros.' }, { status: 500 });
  return NextResponse.json(data);
}
