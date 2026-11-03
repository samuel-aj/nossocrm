/**
 * POST /api/integrations/api4com/calls/[callId]/hangup  (quem ligou, ou admin)
 *   -> { call }   pede à API4com para desligar; o webhook fecha o estado.
 */
import { json } from '@/lib/whatsapp/api';
import { guardRoute, getErrorMessage } from '@/app/api/wa-agents/_shared';
import { isValidUUID } from '@/lib/supabase/utils';
import { hangupCall } from '@/lib/api4com/calls';
import { Api4comError } from '@/lib/api4com/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ callId: string }> };

export async function POST(req: Request, ctx: Ctx) {
  const auth = await guardRoute({ req });
  if (!auth.ok) return auth.response;
  const { callId } = await ctx.params;
  if (!isValidUUID(callId)) return json({ error: 'not found' }, 404);
  try {
    const call = await hangupCall(auth.admin, { orgId: auth.user.organizationId, userId: auth.user.id, isAdmin: auth.isAdmin, id: callId });
    if (!call) return json({ error: 'not found' }, 404);
    return json({ call });
  } catch (err) {
    if (err instanceof Api4comError) return json({ error: err.message }, err.status >= 400 && err.status < 600 ? err.status : 502);
    return json({ error: getErrorMessage(err, 'Falha ao desligar') }, 500);
  }
}
