import { requireOrgUser, json } from '@/lib/whatsapp/api';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { isValidUUID } from '@/lib/supabase/utils';

export const runtime = 'nodejs';

/**
 * POST /api/whatsapp/conversations/ai  body: { conversationId, status: 'active' | 'paused' | 'stopped' }
 * Pausa/retoma/para o agente de IA (n8n etc.) NESTA conversa. 'stopped' = parada manual
 * (ai_paused_by preenchido): nada automático reabre; só Iniciar/Retomar na mão. A pausa automática
 * acontece no banco quando um atendente responde (gatilho wa_ai_agent_state);
 * aqui é o botão do chat. Enquanto 'paused', a API pública recusa envios do
 * agente (409 AGENT_PAUSED) e o webhook avisa conversation.ai_status.
 */
export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);
  const auth = await requireOrgUser();
  if (!auth.ok) return auth.response;

  const body = (await req.json().catch(() => null)) as { conversationId?: string; status?: string } | null;
  const conversationId = (body?.conversationId || '').trim();
  const status =
    body?.status === 'paused' ? 'paused' : body?.status === 'active' ? 'active' : body?.status === 'stopped' ? 'stopped' : null;
  if (!isValidUUID(conversationId) || !status) {
    return json({ error: 'conversationId e status (active|paused|stopped) são obrigatórios' }, 400);
  }

  const { data, error } = await auth.admin
    .from('wa_conversations')
    .update({
      ai_status: status,
      ai_status_changed_at: new Date().toISOString(),
      ai_paused_by: status === 'active' ? null : auth.user.id,
      ...(status === 'stopped' ? { ai_resume_at: null, ai_approval: null } : {}),
    })
    .eq('id', conversationId)
    .eq('organization_id', auth.user.organizationId)
    .select('id')
    .maybeSingle();
  if (error) return json({ error: error.message }, 500);
  if (!data) return json({ error: 'Conversa não encontrada' }, 404);
  return json({ ok: true, status });
}
