import { z } from 'zod';
import { json } from '@/lib/whatsapp/api';
import { guardRoute } from '../../_shared';
import { canPublishBotTemplates, readTemplateBody } from '../_shared';
type Ctx = { params: Promise<{ id: string }> };
export async function PATCH(req: Request, ctx: Ctx) {
  const auth = await guardRoute({ req, admin: true }); if (!auth.ok) return auth.response;
  try {
    if (!(await canPublishBotTemplates(auth.admin, auth.user.id))) return json({ error: 'Só o superadmin pode publicar modelos oficiais' }, 403);
    const id = z.string().uuid().parse((await ctx.params).id);
    const body = z.object({ published: z.boolean() }).strict().parse(await readTemplateBody(req));
    const { data, error } = await auth.admin.from('wa_bot_templates').update({ published: body.published, updated_at: new Date().toISOString() }).eq('id', id).eq('official', true).select('id,published').maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return json({ error: 'Modelo oficial não encontrado' }, 404);
    return json({ template: data });
  } catch (err) { return json({ error: err instanceof Error ? err.message : 'Falha ao publicar' }, 400); }
}
