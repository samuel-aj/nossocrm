import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { json, requireOrgUser } from '@/lib/whatsapp/api';

export async function POST(req: Request, ctx: { params: Promise<{ dealId: string }> }) {
  if (!isAllowedOrigin(req)) return json({ error: 'Origem inválida' }, 403);
  const auth = await requireOrgUser();
  if (!auth.ok) return auth.response;
  const { dealId } = await ctx.params;
  const body = await req.json().catch(() => null);
  const parsed = z.object({ expectedId: z.string().uuid() }).strict().safeParse(body);
  if (!z.string().uuid().safeParse(dealId).success || !parsed.success) return json({ error: 'Alerta inválido' }, 400);
  const client = await createClient();
  const { data: visible, error: visibilityError } = await client.from('deals').select('id').eq('id', dealId).eq('organization_id', auth.user.organizationId).is('deleted_at', null).maybeSingle();
  if (visibilityError) return json({ error: 'Não foi possível verificar o acesso' }, 500);
  if (!visible) return json({ error: 'Lead não encontrado' }, 404);
  const { data, error } = await auth.admin.rpc('acknowledge_deal_alert', { p_org: auth.user.organizationId, p_deal: dealId, p_expected: parsed.data.expectedId, p_user: auth.user.id });
  if (error) return json({ error: 'Não foi possível reconhecer o alerta' }, 500);
  return json({ acknowledged: data === true });
}
