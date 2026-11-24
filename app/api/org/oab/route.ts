import { z } from 'zod';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { isOrgAdmin, json, requireOrgUser } from '@/lib/whatsapp/api';
import { loadConfirmedOabRegistrations, OabRegistrationSchema } from '@/lib/wa-agents/oabRegistry';

const confirmation = OabRegistrationSchema.extend({ confirmed: z.literal(true) });
const revocation = z.object({ id: z.string().uuid() }).strict();

async function authorize(request?: Request) {
  if (request && !isAllowedOrigin(request)) return { ok: false as const, response: json({ error: 'Origem inválida' }, 403) };
  const auth = await requireOrgUser();
  if (auth.ok && !isOrgAdmin(auth.user.role)) return { ok: false as const, response: json({ error: 'Acesso negado' }, 403) };
  return auth;
}

export async function GET() {
  const auth = await authorize();
  if (!auth.ok) return auth.response;
  try {
    const response = json({ registrations: await loadConfirmedOabRegistrations(auth.admin, auth.user.organizationId) });
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  } catch {
    return json({ error: 'Não foi possível carregar as inscrições da OAB.' }, 503);
  }
}

export async function POST(request: Request) {
  const auth = await authorize(request);
  if (!auth.ok) return auth.response;
  const input = confirmation.safeParse(await request.json().catch(() => null));
  if (!input.success) return json({ error: 'Confira o nome, a UF e o número antes de confirmar a inscrição.' }, 400);
  const { professionalName, state, number } = input.data;
  const { error } = await auth.admin.from('organization_oab_registrations').insert({
    organization_id: auth.user.organizationId, professional_name: professionalName, state, number, confirmed_by: auth.user.id,
  });
  if (error?.code === '23505') return json({ error: 'Esta inscrição já está confirmada no escritório.' }, 409);
  if (error) return json({ error: 'Não foi possível confirmar a inscrição.' }, 503);
  return json({ ok: true }, 201);
}

export async function DELETE(request: Request) {
  const auth = await authorize(request);
  if (!auth.ok) return auth.response;
  const input = revocation.safeParse(await request.json().catch(() => null));
  if (!input.success) return json({ error: 'Inscrição inválida.' }, 400);
  const { error } = await auth.admin.from('organization_oab_registrations').delete()
    .eq('organization_id', auth.user.organizationId).eq('id', input.data.id);
  if (error) return json({ error: 'Não foi possível remover a inscrição.' }, 503);
  return json({ ok: true });
}
