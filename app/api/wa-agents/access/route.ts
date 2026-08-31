/**
 * /api/wa-agents/access
 *   GET -> { agentsApproved, isAdmin }
 *
 * Diz à interface o que esta organização pode usar em Automações:
 * - ROBÔS: sempre (não há chave; por isso nem aparece na resposta).
 * - AGENTE DE IA: só quando o SUPER ADMIN da agência liberou a organização.
 *
 * Não existe POST aqui de propósito: o cliente não se autolibera. A liberação
 * fica em /api/superadmin/organizations/[id]/ai-agents.
 */
import { json } from '@/lib/whatsapp/api';
import { isAiAgentsApproved } from '@/lib/wa-agents/beta';
import { guardRoute } from '../_shared';

export const runtime = 'nodejs';

export async function GET() {
  const auth = await guardRoute();
  if (!auth.ok) return auth.response;

  const agentsApproved = await isAiAgentsApproved(auth.admin, auth.user.organizationId);
  return json({ agentsApproved, isAdmin: auth.isAdmin });
}
