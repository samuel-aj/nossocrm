/**
 * POST /api/whatsapp/upload -> URL assinada de upload no bucket privado wa-media.
 *
 * O arquivo NÃO passa pela Vercel (limite de ~4,5MB por request): o client
 * recebe { path, token } e sobe direto pro Supabase Storage com
 * `uploadToSignedUrl`. Depois chama /api/whatsapp/send com o `path`.
 */
import { requireOrgUser, json } from '@/lib/whatsapp/api';
import { getConnectionByOrg } from '@/lib/whatsapp/service';

function sanitizeFileName(name: string): string {
  const trimmed = (name || 'arquivo').slice(-120);
  return trimmed.replace(/[^a-zA-Z0-9à-üÀ-Ü._-]+/g, '_');
}

export async function POST(req: Request) {
  const auth = await requireOrgUser();
  if (!auth.ok) return auth.response;

  const conn = await getConnectionByOrg(auth.admin, auth.user.organizationId);
  if (!conn) return json({ error: 'Conexão de WhatsApp não configurada' }, 400);

  let body: { fileName?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'JSON inválido' }, 400);
  }

  const fileName = sanitizeFileName(body.fileName || 'arquivo');
  const path = `${auth.user.organizationId}/out/${Date.now()}_${fileName}`;

  const { data, error } = await auth.admin.storage.from('wa-media').createSignedUploadUrl(path);
  if (error || !data) {
    return json({ error: `Falha ao preparar upload: ${error?.message ?? 'desconhecida'}` }, 500);
  }
  return json({ path: data.path, token: data.token });
}
