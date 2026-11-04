/**
 * GET /api/integrations/api4com/calls/[callId]  (quem ligou, ou admin)
 *   -> { call }   estado atual da ligação (a tela consulta enquanto ela dura)
 */
import { json } from '@/lib/whatsapp/api';
import { guardRoute, getErrorMessage } from '@/app/api/wa-agents/_shared';
import { isValidUUID } from '@/lib/supabase/utils';
import type { CallRow } from '@/lib/api4com/shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ callId: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const auth = await guardRoute();
  if (!auth.ok) return auth.response;
  const { callId } = await ctx.params;
  if (!isValidUUID(callId)) return json({ error: 'not found' }, 404);
  try {
    const { data, error } = await auth.admin.from('api4com_calls').select('*').eq('organization_id', auth.user.organizationId).eq('id', callId).maybeSingle();
    if (error) return json({ error: error.message }, 500);
    const call = data as CallRow | null;
    if (!call) return json({ error: 'not found' }, 404);
    if (call.user_id !== auth.user.id && !auth.isAdmin) return json({ error: 'Esta ligação é de outra pessoa.' }, 403);
    return json({ call });
  } catch (err) {
    return json({ error: getErrorMessage(err, 'Falha ao consultar a ligação') }, 500);
  }
}
