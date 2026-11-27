/**
 * POST /api/feedback/uploads { fileName, mime, size, kind }
 * URL assinada de upload no bucket privado feedback-anexos. O arquivo não passa pela Vercel:
 * o navegador sobe direto com uploadToSignedUrl(path, token, file).
 */
import { randomUUID } from 'node:crypto';
import { json, requireOrgUser } from '@/lib/whatsapp/api';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { UploadRequestSchema } from '@/lib/feedback/schemas';
import { feedbackFilePath } from '@/lib/feedback/paths';
import { FEEDBACK_BUCKET } from '@/lib/feedback/constants';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);
  const auth = await requireOrgUser();
  if (!auth.ok) return auth.response;
  const parsed = UploadRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: parsed.error.issues[0]?.message ?? 'Arquivo inválido.' }, 422);
  const path = feedbackFilePath(auth.user.organizationId, auth.user.id, randomUUID(), parsed.data.fileName);
  const { data, error } = await auth.admin.storage.from(FEEDBACK_BUCKET).createSignedUploadUrl(path);
  if (error || !data) return json({ error: 'Não foi possível preparar o envio do arquivo.' }, 500);
  return json({ path: data.path, token: data.token });
}
