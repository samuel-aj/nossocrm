/**
 * /api/wa-agents/beta
 *   GET  -> { enabled, isAdmin }   estado da chave beta "Agentes de IA e Robôs" da org
 *   POST -> { enabled }            (admin) liga/desliga a chave em ai_feature_flags
 *
 * Única rota do módulo que funciona com a beta desligada (é ela que liga).
 */
import { z } from 'zod';
import { json } from '@/lib/whatsapp/api';
import { WA_AGENTS_BETA_FLAG } from '@/lib/wa-agents/types';
import { isWaAgentsBetaEnabled } from '@/lib/wa-agents/beta';
import { guardRoute, readJsonBody, validationError } from '../_shared';

export const runtime = 'nodejs';

const BodySchema = z.object({ enabled: z.boolean() });

export async function GET() {
  const auth = await guardRoute({ beta: false });
  if (!auth.ok) return auth.response;

  const enabled = await isWaAgentsBetaEnabled(auth.admin, auth.user.organizationId);
  return json({ enabled, isAdmin: auth.isAdmin });
}

export async function POST(req: Request) {
  const auth = await guardRoute({ req, admin: true, beta: false });
  if (!auth.ok) return auth.response;

  const parsed = BodySchema.safeParse(await readJsonBody(req));
  if (!parsed.success) return validationError(parsed.error);

  const { error } = await auth.admin.from('ai_feature_flags').upsert(
    {
      organization_id: auth.user.organizationId,
      key: WA_AGENTS_BETA_FLAG,
      enabled: parsed.data.enabled,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'organization_id,key' }
  );
  if (error) return json({ error: error.message }, 500);

  return json({ enabled: parsed.data.enabled });
}
