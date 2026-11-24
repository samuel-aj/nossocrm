/**
 * PATCH  /api/api-keys/[id]  -> revoga (revoked_at = agora)
 * DELETE /api/api-keys/[id]  -> exclui, só se já estiver revogada
 * Sempre restrito à organização atual do request (ver lib/apiKeys/server).
 */
import { NextResponse } from 'next/server';
import { logSecurityEvent } from '@/lib/security/auditLog';
import { safeErrorMessage } from '@/lib/security/safeError';
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
  if (error) return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Chave não encontrada ou já revogada' }, { status: 404 });
  const revoked = data as { name?: string | null; key_prefix?: string | null };
  await logSecurityEvent({
    action: 'api_key.revoked',
    actorId: auth.userId,
    organizationId: auth.organizationId,
    resourceType: 'api_key',
    resourceId: id,
    details: { name: revoked.name ?? null, prefixo: revoked.key_prefix ?? null },
    severity: 'warning',
  }, req);
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
  if (error) return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  if (!count) return NextResponse.json({ error: 'Chave não encontrada ou ainda ativa' }, { status: 404 });
  await logSecurityEvent({
    action: 'api_key.revoked',
    actorId: auth.userId,
    organizationId: auth.organizationId,
    resourceType: 'api_key',
    resourceId: id,
    details: { excluida: true },
  }, req);
  return NextResponse.json({ ok: true });
}
