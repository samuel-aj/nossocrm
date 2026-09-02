/**
 * Chaves da API pública da ORGANIZAÇÃO ATUAL (a da aba, ver lib/supabase/tabOrgScope).
 *
 * GET  /api/api-keys        -> lista (sem o hash) só da organização do request
 * POST /api/api-keys {name} -> cria e devolve o token UMA vez
 *
 * Antes a tela consultava a tabela direto pelo cliente e criava pela RPC
 * create_api_key, que usam a organização do PERFIL: um super admin ou membro
 * de várias organizações via (e criava) chaves da organização errada.
 * Aqui tudo é filtrado pela organização resolvida do request, com o admin
 * client — nenhuma organização enxerga credenciais de outra.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createStaticAdminClient } from '@/lib/supabase/server';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { API_KEY_COLUMNS, getAuthedAdmin, makeApiKeyToken } from '@/lib/apiKeys/server';

export const runtime = 'nodejs';

const CreateSchema = z.object({ name: z.string().max(120).optional() }).strict();

export async function GET() {
  const auth = await getAuthedAdmin();
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const sb = createStaticAdminClient();
  const { data, error } = await sb
    .from('api_keys')
    .select(API_KEY_COLUMNS)
    .eq('organization_id', auth.organizationId)
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data: data ?? [] });
}

export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const auth = await getAuthedAdmin();
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const body = await req.json().catch(() => ({}));
  const parsed = CreateSchema.safeParse(body ?? {});
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 422 });
  const name = (parsed.data.name ?? '').trim() || 'Integração';
  const { token, prefix, hash } = makeApiKeyToken();
  const sb = createStaticAdminClient();
  const { data, error } = await sb
    .from('api_keys')
    .insert({
      organization_id: auth.organizationId,
      name,
      key_prefix: prefix,
      key_hash: hash,
      created_by: auth.userId,
      updated_at: new Date().toISOString(),
    })
    .select(API_KEY_COLUMNS)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data: { ...data, token } }, { status: 201 });
}
