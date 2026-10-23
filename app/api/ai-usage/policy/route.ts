import { z } from 'zod';
import { getUsagePolicy, updateUsagePolicy } from '@/lib/ai-usage/budget';
import { validTimezone } from '@/lib/ai-usage/reporting';
import { json } from '@/lib/whatsapp/api';
import { guardRoute, readJsonBody, validationError, usageError } from '../_shared';
export const runtime = 'nodejs';
const PolicyBody = z.object({
  enabled: z.boolean(), conversation_tokens: z.number().int().min(1).max(100_000_000).nullable(),
  organization_daily_tokens: z.number().int().min(1).max(1_000_000_000).nullable(),
  conversation_audio_seconds: z.number().int().min(1).max(86400).nullable(),
  timezone: z.string().min(1).max(80).refine(validTimezone, 'Fuso inválido'),
}).strict().refine(v => !v.enabled || v.conversation_tokens !== null, {
  message: 'Defina a quota de tokens por conversa antes de ativar', path: ['conversation_tokens'],
});
export async function GET() {
  const auth = await guardRoute(); if (!auth.ok) return auth.response;
  try { return json({ policy: await getUsagePolicy(auth.admin, auth.user.organizationId), canEdit: auth.isAdmin }); }
  catch { return usageError(); }
}
export async function PATCH(req: Request) {
  const auth = await guardRoute({ req, admin: true }); if (!auth.ok) return auth.response;
  const body = PolicyBody.safeParse(await readJsonBody(req)); if (!body.success) return validationError(body.error);
  try { return json({ policy: await updateUsagePolicy(auth.admin, auth.user.organizationId, body.data) }); }
  catch { return usageError(); }
}
