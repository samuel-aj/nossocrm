import { z } from 'zod';
import { createClient, createStaticAdminClient } from '@/lib/supabase/server';
import { makeApiKeyToken } from '@/lib/apiKeys/server';
import { logSecurityEvent } from '@/lib/security/auditLog';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { UserRole } from '@/types/constants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const columns = 'id,name,key_prefix,created_at,last_used_at,revoked_at';
const createInput = z.strictObject({ name: z.string().trim().min(1).max(120) });
const revokeInput = z.strictObject({ id: z.uuid() });
const json = (body: unknown, status = 200) => Response.json(body, {
  status, headers: { 'Cache-Control': 'private, no-store' },
});

// This platform permission comes from the authenticated profile, never the selected office.
async function authorize(req: Request) {
  if (!isAllowedOrigin(req)) return json({ error: 'Origem não permitida.' }, 403);
  const session = await createClient();
  const { data: { user } } = await session.auth.getUser();
  if (!user) return json({ error: 'Entre no CRM para continuar.' }, 401);
  const { data, error } = await session.from('profiles').select('role').eq('id', user.id).single();
  if (error || data?.role !== UserRole.SUPER_ADMIN) return json({ error: 'Acesso restrito ao superadmin.' }, 403);
  return { id: user.id };
}

export async function GET(req: Request) {
  const actor = await authorize(req);
  if (actor instanceof Response) return actor;
  const { data, error } = await createStaticAdminClient().from('aj_operator_keys')
    .select(columns).order('created_at', { ascending: false });
  return error ? json({ error: 'Não foi possível consultar as chaves.' }, 500) : json({ data });
}

export async function POST(req: Request) {
  const actor = await authorize(req);
  if (actor instanceof Response) return actor;
  const parsed = createInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: 'Informe um nome de até 120 caracteres.' }, 422);
  const { token, prefix, hash } = makeApiKeyToken('ncrmop_');
  const admin = createStaticAdminClient();
  const { data, error } = await admin.from('aj_operator_keys')
    .insert({ name: parsed.data.name, key_prefix: prefix, key_hash: hash, created_by: actor.id })
    .select(columns).single();
  if (error || !data) return json({ error: 'Não foi possível criar a chave.' }, 500);
  await logSecurityEvent({ action: 'api_key.created', actorId: actor.id, resourceType: 'aj_operator_key', resourceId: data.id, severity: 'warning' }, req, admin);
  return json({ data, token }, 201);
}

export async function DELETE(req: Request) {
  const actor = await authorize(req);
  if (actor instanceof Response) return actor;
  const parsed = revokeInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: 'Selecione uma chave válida.' }, 422);
  const admin = createStaticAdminClient();
  const { data, error } = await admin.from('aj_operator_keys')
    .update({ revoked_at: new Date().toISOString(), revoked_by: actor.id })
    .eq('id', parsed.data.id).is('revoked_at', null).select(columns).maybeSingle();
  if (error) return json({ error: 'Não foi possível revogar a chave.' }, 500);
  if (!data) return json({ error: 'A chave não está ativa.' }, 404);
  await logSecurityEvent({ action: 'api_key.revoked', actorId: actor.id, resourceType: 'aj_operator_key', resourceId: data.id, severity: 'warning' }, req, admin);
  return json({ data });
}
