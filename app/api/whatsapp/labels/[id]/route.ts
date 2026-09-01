/**
 * Uma etiqueta da organização.
 *
 *   PATCH  -> renomeia / troca a cor { name?, color? }
 *   DELETE -> apaga (o gatilho no banco tira a etiqueta das conversas)
 *
 * Renomear e recolorir refletem em todos os chats de uma vez, que é o ponto
 * de a etiqueta ser da organização e não texto por conversa.
 */
import { requireOrgUser, json } from '@/lib/whatsapp/api';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { isLabelColor, normalizeLabelName } from '@/lib/whatsapp/labels';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);
  const auth = await requireOrgUser();
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;

  let body: { name?: unknown; color?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'JSON inválido' }, 400);
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if ('name' in body) {
    const name = normalizeLabelName(body.name);
    if (!name) return json({ error: 'Dê um nome para a etiqueta' }, 400);
    patch.name = name;
  }
  if ('color' in body) {
    if (!isLabelColor(body.color)) return json({ error: 'Cor inválida' }, 400);
    patch.color = body.color;
  }

  const { data, error } = await auth.admin
    .from('wa_labels')
    .update(patch)
    .eq('organization_id', auth.user.organizationId)
    .eq('id', id)
    .select('id, name, color')
    .maybeSingle();

  if (error) {
    if (/duplicate|unique/i.test(error.message)) {
      return json({ error: 'Já existe uma etiqueta com esse nome' }, 409);
    }
    return json({ error: error.message }, 500);
  }
  if (!data) return json({ error: 'Etiqueta não encontrada' }, 404);
  return json({ label: data });
}

export async function DELETE(req: Request, ctx: Ctx) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);
  const auth = await requireOrgUser();
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;

  const { error } = await auth.admin
    .from('wa_labels')
    .delete()
    .eq('organization_id', auth.user.organizationId)
    .eq('id', id);
  if (error) return json({ error: error.message }, 500);

  return json({ ok: true });
}
