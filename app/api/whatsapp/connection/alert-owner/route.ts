import { z } from 'zod';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { isOrgAdmin, json, requireOrgUser } from '@/lib/whatsapp/api';

const input = z.object({ connectionId: z.uuid(), ownerId: z.uuid().nullable() });

export async function PATCH(request: Request) {
  if (!isAllowedOrigin(request)) return json({ error: 'Origem não permitida.' }, 403);
  const auth = await requireOrgUser();
  if (!auth.ok) return auth.response;
  if (!isOrgAdmin(auth.user.role)) return json({ error: 'Somente administradores podem alterar o responsável.' }, 403);

  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: 'Número ou responsável inválido.' }, 400);
  const { connectionId, ownerId } = parsed.data;
  const org = auth.user.organizationId;
  if (ownerId) {
    const [profile, member] = await Promise.all([
      auth.admin.from('profiles').select('id').eq('id', ownerId).eq('organization_id', org).neq('role', 'super_admin').maybeSingle(),
      auth.admin.from('user_organizations').select('user_id').eq('user_id', ownerId).eq('organization_id', org).maybeSingle(),
    ]);
    if (profile.error || member.error) return json({ error: 'Falha ao verificar o responsável.' }, 500);
    if (!profile.data && !member.data) return json({ error: 'Escolha um membro deste escritório.' }, 422);
  }
  const { data, error } = await auth.admin.from('wa_connections').update({ health_alert_owner_id: ownerId })
    .eq('id', connectionId).eq('organization_id', org).select('id').maybeSingle();
  if (error) return json({ error: 'Não foi possível salvar o responsável por este número.' }, 422);
  return data ? json({ ownerId }) : json({ error: 'Número não encontrado.' }, 404);
}
