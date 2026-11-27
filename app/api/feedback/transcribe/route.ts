/** POST /api/feedback/transcribe { path } — transcreve um áudio que a própria pessoa enviou. */
import { json, requireOrgUser } from '@/lib/whatsapp/api';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { enforceRateLimit, LIMITS } from '@/lib/security/rateLimit';
import { TranscribeSchema } from '@/lib/feedback/schemas';
import { ownsFeedbackPath } from '@/lib/feedback/paths';
import { FEEDBACK_BUCKET } from '@/lib/feedback/constants';
import { transcribeAudio } from '@/lib/ai/transcribeAudio';

export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);
  const auth = await requireOrgUser();
  if (!auth.ok) return auth.response;
  const limited = await enforceRateLimit({ scope: 'ai', id: auth.user.id, limit: LIMITS.aiPerUser(), request: req,
    actorId: auth.user.id, organizationId: auth.user.organizationId });
  if (limited) return limited;
  const parsed = TranscribeSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success || !ownsFeedbackPath(auth.user.organizationId, auth.user.id, parsed.data.path)) {
    return json({ error: 'Áudio inválido.' }, 422);
  }
  const { data: file, error } = await auth.admin.storage.from(FEEDBACK_BUCKET).download(parsed.data.path);
  if (error || !file) return json({ error: 'Não foi possível ler o áudio.' }, 404);
  const result = await transcribeAudio({ admin: auth.admin, organizationId: auth.user.organizationId,
    bytes: await file.arrayBuffer(), mime: file.type });
  return result.ok ? json({ transcript: result.text }) : json({ error: result.error }, result.status);
}
