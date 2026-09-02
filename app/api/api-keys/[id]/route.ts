/**
 * PATCH  /api/api-keys/[id]  -> revoga (revoked_at = agora)
 * DELETE /api/api-keys/[id]  -> exclui, só se já estiver revogada
 * Sempre restrito à organização atual do request (ver lib/apiKeys/server).
 */
import { NextResponse } from 'next/server';
import { createStaticAdminClient } from '@/lib/supabase/server';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { isValidUUID } from '@/lib/supabase/utils';
import { API_KEY_COLUMNS, getAuthedAdmin } from '@/lib/apiKeys/server';

export const runtime = 'nodejs';

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!isAllowedOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const auth = await getAuthedAdmin();
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await ctx.params;
  if (!isValidUUID(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 422 });
  const sb = createStaticAdminClient();
  const { data, error } = await sb
    .from('api_keys')
    .update({ revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('organization_id', auth.organizationId)
    .is('revoked_at', null)
    .select(API_KEY_COLUMNS)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Chave não encontrada ou já revogada' }, { status: 404 });
  return NextResponse.json({ data });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!isAllowedOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const auth = await getAuthedAdmin();
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await ctx.params;
  if (!isValidUUID(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 422 });
  const sb = createStaticAdminClient();
  // Só chaves já revogadas podem ser excluídas (nunca some uma chave ativa por engano)
  const { error, count } = await sb
    .from('api_keys')
    .delete({ count: 'exact' })
    .eq('id', id)
    .eq('organization_id', auth.organizationId)
    .not('revoked_at', 'is', null);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!count) return NextResponse.json({ error: 'Chave não encontrada ou ainda ativa' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
