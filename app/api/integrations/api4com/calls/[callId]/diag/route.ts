/**
 * POST /api/integrations/api4com/calls/[callId]/diag  (só quem ligou)
 *   { diag } -> { ok }
 * Resumo técnico da ligação vindo do telefone embutido (tempos, caminho de
 * rede, perda de pacotes, toques extras). Fica em api4com_calls.metadata.diag
 * para investigar áudio ruim. Não tem dado pessoal: só números e estados.
 */
import { json } from '@/lib/whatsapp/api';
import { guardRoute, readJsonBody, getErrorMessage } from '@/app/api/wa-agents/_shared';
import { isValidUUID } from '@/lib/supabase/utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ callId: string }> };

const MAX_BYTES = 16_000;

export async function POST(req: Request, ctx: Ctx) {
  const auth = await guardRoute({ req });
  if (!auth.ok) return auth.response;
  const { callId } = await ctx.params;
  if (!isValidUUID(callId)) return json({ error: 'not found' }, 404);
  const body = (await readJsonBody(req)) as { diag?: unknown } | null;
  const diag = body?.diag;
  if (!diag || typeof diag !== 'object' || Array.isArray(diag)) return json({ error: 'diag inválido' }, 400);
  if (JSON.stringify(diag).length > MAX_BYTES) return json({ error: 'diag grande demais' }, 413);
  try {
    const { data, error } = await auth.admin
      .from('api4com_calls')
      .select('id, user_id, metadata')
      .eq('organization_id', auth.user.organizationId)
      .eq('id', callId)
      .maybeSingle();
    if (error) return json({ error: error.message }, 500);
    const row = data as { id: string; user_id: string; metadata: Record<string, unknown> | null } | null;
    if (!row || row.user_id !== auth.user.id) return json({ error: 'not found' }, 404);
    const metadata = { ...(row.metadata ?? {}), diag: { ...(diag as Record<string, unknown>), saved_at: new Date().toISOString() } };
    const { error: upErr } = await auth.admin.from('api4com_calls').update({ metadata }).eq('id', row.id).eq('organization_id', auth.user.organizationId);
    if (upErr) return json({ error: upErr.message }, 500);
    return json({ ok: true });
  } catch (err) {
    return json({ error: getErrorMessage(err, 'Falha ao guardar o resumo da ligação') }, 500);
  }
}
