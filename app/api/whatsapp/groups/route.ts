/**
 * GET/PATCH /api/whatsapp/groups — chave "Grupos do WhatsApp no chat" da org.
 *
 * Desligada (padrão): mensagens de grupo são ignoradas na entrada e nenhum
 * grupo aparece na página Chats. Ligada: grupos dos números conectados por
 * QR Code entram como conversas (a API oficial da Meta não tem grupos).
 * Agentes de IA e robôs nunca respondem em grupo. Leitura: qualquer membro.
 * Escrita: admin.
 */
import { requireOrgUser, isOrgAdmin, json } from '@/lib/whatsapp/api';
import { getWaGroupsEnabled } from '@/lib/whatsapp/service';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';

export const runtime = 'nodejs';

export async function GET() {
  const auth = await requireOrgUser();
  if (!auth.ok) return auth.response;
  const enabled = await getWaGroupsEnabled(auth.admin, auth.user.organizationId);
  return json({ enabled });
}

export async function PATCH(req: Request) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);
  const auth = await requireOrgUser();
  if (!auth.ok) return auth.response;
  if (!isOrgAdmin(auth.user.role)) return json({ error: 'Só administradores alteram esta configuração' }, 403);

  const body = (await req.json().catch(() => null)) as { enabled?: unknown } | null;
  if (typeof body?.enabled !== 'boolean') return json({ error: 'enabled (true/false) é obrigatório' }, 400);

  const { error } = await auth.admin.from('organization_settings').upsert(
    {
      organization_id: auth.user.organizationId,
      wa_groups_enabled: body.enabled,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'organization_id' }
  );
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true, enabled: body.enabled });
}
