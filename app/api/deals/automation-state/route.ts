import { z } from 'zod';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { createClient } from '@/lib/supabase/server';
import { json, requireOrgUser } from '@/lib/whatsapp/api';
import { loadAutomationState } from '@/lib/boards/loadAutomationState';

/** Read-only batch projection. Lead visibility is checked with the user's RLS first. */
export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) return json({ error: 'Origem inválida' }, 403);
  const auth = await requireOrgUser();
  if (!auth.ok) return auth.response;
  const parsed = z.object({ dealIds: z.array(z.string().uuid()).max(100) }).strict().safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: 'Leads inválidos' }, 400);
  if (!parsed.data.dealIds.length) return json({ automations: {} });
  try {
    const client = await createClient();
    const { data, error } = await client.from('deals').select('id,contact_id')
      .eq('organization_id', auth.user.organizationId).in('id', parsed.data.dealIds).is('deleted_at', null);
    if (error) throw error;
    const automations = await loadAutomationState(auth.admin, auth.user, data || []);
    const response = json({ automations });
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch (error) {
    console.error('[board automation state]', error);
    return json({ error: 'Não foi possível consultar as automações' }, 500);
  }
}
