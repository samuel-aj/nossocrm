import { createHash } from 'node:crypto';
import { z } from 'zod';
import { isAllowedPushEndpoint, isValidPushKeys, readWebPushConfig } from '@/lib/notifications/webPush';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { requireOrgUser } from '@/lib/whatsapp/api';

export const runtime = 'nodejs';
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
const endpointSchema = z.string().min(1).max(2048);
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const registerSchema = z.object({
  subscription: z.object({
    endpoint: endpointSchema.refine(isAllowedPushEndpoint),
    expirationTime: z.number().nullable().optional(),
    keys: z.object({
      p256dh: z.string().regex(/^[A-Za-z0-9_-]{87}=?$/),
      auth: z.string().regex(/^[A-Za-z0-9_-]{22}(?:==)?$/),
    }).strict(),
  }).strict(),
}).strict();
const removeSchema = z.object({
  endpoint: endpointSchema,
  allOrganizations: z.boolean().optional(),
}).strict();

async function authorize(req: Request) {
  if (req.method !== 'GET' && !isAllowedOrigin(req)) return { ok: false as const, response: reply({ error: 'Origem não permitida.' }, 403) };
  const auth = await requireOrgUser();
  const expectedUser = req.headers.get('x-push-user-id');
  if (auth.ok && expectedUser && auth.user.id !== expectedUser) {
    return { ok: false as const, response: reply({ error: 'Sua sessão mudou. Abra as preferências novamente.' }, 409) };
  }
  return auth;
}

export async function GET(req: Request) {
  const auth = await authorize(req);
  if (!auth.ok) return auth.response;
  const device = new URL(req.url).searchParams.get('device');
  const publicKey = readWebPushConfig()?.publicKey ?? null;
  if (device === null) return reply({ publicKey, enabled: false });
  if (!hashSchema.safeParse(device).success) return reply({ error: 'Identificador de aparelho inválido.' }, 400);
  const { data, error } = await auth.admin.from('crm_push_subscriptions').select('id')
    .eq('organization_id', auth.user.organizationId).eq('user_id', auth.user.id).eq('endpoint_hash', device).maybeSingle();
  if (error) return reply({ error: 'Não foi possível consultar este aparelho.' }, 503);
  return reply({ publicKey, enabled: !!data });
}

export async function POST(req: Request) {
  const auth = await authorize(req);
  if (!auth.ok) return auth.response;
  if (!readWebPushConfig()) return reply({ error: 'As notificações push ainda não foram configuradas neste ambiente.' }, 503);
  const input = registerSchema.safeParse(await req.json().catch(() => null));
  if (!input.success) return reply({ error: 'Inscrição de notificações inválida.' }, 400);
  const { endpoint, keys, expirationTime } = input.data.subscription;
  if (expirationTime != null && expirationTime <= Date.now()) return reply({ error: 'A inscrição deste aparelho expirou.' }, 400);
  const publicKey = keys.p256dh.replace(/=+$/, '');
  const secret = keys.auth.replace(/=+$/, '');
  if (!isValidPushKeys(publicKey, secret)) {
    return reply({ error: 'Chaves do aparelho inválidas.' }, 400);
  }
  const { error } = await auth.admin.rpc('register_crm_push_subscription', {
    p_org: auth.user.organizationId, p_user: auth.user.id, p_endpoint: endpoint,
    p_p256dh: publicKey, p_auth: secret,
  });
  if (error?.code === '42501') return reply({ error: 'Acesso negado.' }, 403);
  if (error) return reply({ error: 'Não foi possível ativar as notificações neste aparelho.' }, 503);
  return reply({ enabled: true });
}

export async function DELETE(req: Request) {
  const auth = await authorize(req);
  if (!auth.ok) return auth.response;
  const input = removeSchema.safeParse(await req.json().catch(() => null));
  if (!input.success) return reply({ error: 'Inscrição de notificações inválida.' }, 400);
  const deviceHash = createHash('sha256').update(input.data.endpoint).digest('hex');
  let query = auth.admin.from('crm_push_subscriptions').delete().eq('user_id', auth.user.id).eq('endpoint_hash', deviceHash);
  if (!input.data.allOrganizations) query = query.eq('organization_id', auth.user.organizationId);
  const { error } = await query;
  if (error) return reply({ error: 'Não foi possível desativar as notificações neste aparelho.' }, 503);
  return reply({ enabled: false });
}
