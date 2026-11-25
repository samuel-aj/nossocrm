/**
 * /api/wa-agents/knowledge-gaps/summary  (admin + beta)
 *   GET -> { counts: { [agentId]: dúvidas abertas } }
 */
import { json } from '@/lib/whatsapp/api';
import { openGapCountsByAgent } from '@/lib/wa-agents/knowledgeGaps';
import { getErrorMessage, guardRoute } from '../../_shared';

export const runtime = 'nodejs';

export async function GET() {
  const auth = await guardRoute({ admin: true, agents: true });
  if (!auth.ok) return auth.response;
  try {
    return json({ counts: await openGapCountsByAgent(auth.admin, auth.user.organizationId) });
  } catch (err) {
    return json({ error: getErrorMessage(err, 'Falha ao contar as dúvidas') }, 500);
  }
}
