/**
 * POST /api/integrations/api4com/calls  (membro com a API4com conectada)
 *   { phone, deal_id?, contact_id? } -> { call }
 * Clique para ligar: a API4com toca no Webphone da pessoa e, quando ela
 * atende, disca para o cliente. A resposta só vem depois disso (até ~90 s).
 */
import { z } from 'zod';
import { json } from '@/lib/whatsapp/api';
import { guardRoute, readJsonBody, validationError, getErrorMessage } from '@/app/api/wa-agents/_shared';
import { startCall } from '@/lib/api4com/calls';
import { Api4comError } from '@/lib/api4com/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const Body = z.object({
  phone: z.string().trim().min(3).max(40),
  deal_id: z.string().uuid().nullable().optional(),
  contact_id: z.string().uuid().nullable().optional(),
});

export async function POST(req: Request) {
  const auth = await guardRoute({ req });
  if (!auth.ok) return auth.response;
  const parsed = Body.safeParse(await readJsonBody(req));
  if (!parsed.success) return validationError(parsed.error);
  const orgId = auth.user.organizationId;
  const input = parsed.data;

  let contactId = input.contact_id ?? null;
  if (input.deal_id) {
    const { data: deal } = await auth.admin.from('deals').select('id, contact_id').eq('id', input.deal_id).eq('organization_id', orgId).maybeSingle();
    if (!deal) return json({ error: 'Lead não encontrado' }, 404);
    contactId = contactId ?? ((deal as { contact_id: string | null }).contact_id ?? null);
  }

  try {
    const call = await startCall(auth.admin, { orgId, userId: auth.user.id, dealId: input.deal_id ?? null, contactId, phone: input.phone });
    return json({ call });
  } catch (err) {
    if (err instanceof Api4comError) {
      // 401 da API4com não é "sem sessão no CRM": vira 409 para a tela mostrar a mensagem
      const status = err.code === 'NOT_CONNECTED' || err.status === 401 ? 409 : err.status >= 400 && err.status < 600 ? err.status : 502;
      return json({ error: err.message, code: err.code }, status);
    }
    return json({ error: getErrorMessage(err, 'Falha ao ligar') }, 500);
  }
}
