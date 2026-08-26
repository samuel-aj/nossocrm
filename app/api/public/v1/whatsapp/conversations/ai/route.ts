/**
 * POST /api/public/v1/whatsapp/conversations/ai -> pausa, retoma ou para o
 * agente de IA EXTERNO (n8n/Make) numa conversa, pelo telefone do contato.
 *
 * Feito para o agente encerrar o próprio atendimento: depois de registrar o
 * resultado no CRM, ele chama aqui com status "paused" e a API pública passa a
 * recusar novos envios dele nessa conversa (409 AGENT_PAUSED); o chat mostra
 * "Agente de IA pausado" com o botão Retomar. Substitui o "status on/off" que
 * antes vivia numa tabela à parte.
 *
 * Body:
 *   { phone: "+5569999999999",
 *     status: "active" | "paused" | "stopped",
 *     connection_id?: "uuid do número (GET /whatsapp/connections); omitido = padrão da org" }
 *
 * A conversa é localizada pelo telefone (com as variantes do nono dígito) no
 * número informado; se ainda não existir, é criada, para o estado valer já na
 * primeira mensagem.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authPublicApi } from '@/lib/public-api/auth';
import { normalizePhone } from '@/lib/public-api/sanitize';
import { createStaticAdminClient } from '@/lib/supabase/server';
import { isValidUUID } from '@/lib/supabase/utils';
import { ensureConversation, getConnectionByIdForOrg, getConnectionByOrg } from '@/lib/whatsapp/service';

export const runtime = 'nodejs';

const BodySchema = z.object({
  phone: z.string().trim().min(5).max(32),
  status: z.enum(['active', 'paused', 'stopped']),
  connection_id: z.string().trim().optional(),
});

export async function POST(request: Request) {
  const auth = await authPublicApi(request);
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status });

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body', code: 'BAD_JSON' }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid body', code: 'VALIDATION', details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const body = parsed.data;

  const phone = normalizePhone(body.phone);
  if (!phone) return NextResponse.json({ error: 'Invalid phone in `phone`', code: 'VALIDATION' }, { status: 400 });

  const connectionId = body.connection_id ?? '';
  if (connectionId && !isValidUUID(connectionId)) {
    return NextResponse.json({ error: 'Invalid `connection_id`', code: 'VALIDATION' }, { status: 400 });
  }

  const sb = createStaticAdminClient();
  const orgId = auth.organizationId;
  const conn = connectionId
    ? await getConnectionByIdForOrg(sb, orgId, connectionId)
    : await getConnectionByOrg(sb, orgId);
  if (!conn) {
    return NextResponse.json(
      {
        error: connectionId ? 'Connection not found' : 'No WhatsApp number connected in this organization',
        code: 'NO_CONNECTION',
      },
      { status: 404 }
    );
  }

  const conv = await ensureConversation(sb, orgId, conn.id, phone);

  // Agente NATIVO (beta) nesta conversa: o estado dele é do CRM, não do agente externo
  const { data: current } = await sb
    .from('wa_conversations')
    .select('ai_agent_id')
    .eq('id', conv.id)
    .eq('organization_id', orgId)
    .maybeSingle();
  if ((current as { ai_agent_id?: string | null } | null)?.ai_agent_id) {
    return NextResponse.json(
      { error: 'This conversation is handled by a native CRM agent', code: 'NATIVE_AGENT', conversation_id: conv.id },
      { status: 409 }
    );
  }

  const { error } = await sb
    .from('wa_conversations')
    .update({
      ai_status: body.status,
      ai_status_changed_at: new Date().toISOString(),
      // pausa/parada pedida pelo próprio agente (não por um atendente): sem carimbo de quem parou
      ai_paused_by: null,
      ai_resume_at: null,
    })
    .eq('id', conv.id)
    .eq('organization_id', orgId);
  if (error) return NextResponse.json({ error: error.message, code: 'DB_ERROR' }, { status: 500 });

  return NextResponse.json({ ok: true, conversation_id: conv.id, phone: conv.wa_phone, status: body.status });
}
