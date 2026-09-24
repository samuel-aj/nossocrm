import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { requireOrgUser, isOrgAdmin, json } from '@/lib/whatsapp/api';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { getConnectionByIdForOrg } from '@/lib/whatsapp/service';
import { TEMPLATE_MEDIA_BUCKET, validateTemplateMedia } from '@/lib/templateMedia';
import { getTemplateMedia, readTemplateMedia } from '@/lib/whatsapp/templateMedia';
export const runtime = 'nodejs';
const Schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('prepare'), connectionId: z.string().uuid(), headerType: z.enum(['image','video','document']), fileName: z.string().min(1).max(200), mimeType: z.string(), size: z.number().int().positive() }).strict(),
  z.object({ action: z.literal('complete'), connectionId: z.string().uuid(), mediaId: z.string().uuid(), templateId: z.string().uuid().optional() }).strict(),
]);
export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);
  const auth = await requireOrgUser();
  if (!auth.ok) return auth.response;
  if (!isOrgAdmin(auth.user.role)) return json({ error: 'Forbidden' }, 403);
  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: 'Dados de upload inválidos' }, 422);
  const input = parsed.data;
  const orgId = auth.user.organizationId;
  const conn = await getConnectionByIdForOrg(auth.admin, orgId, input.connectionId);
  if (!conn || conn.provider !== 'meta_cloud') return json({ error: 'Mídia em modelos exige conexão Meta Cloud.' }, 422);
  try {
    if (input.action === 'prepare') {
      validateTemplateMedia(input.headerType, input.mimeType, input.size);
      const id = randomUUID();
      const fileName = input.fileName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120).replace(/^[_.]+/, '') || 'arquivo';
      const path = `${orgId}/${conn.id}/${id}/${fileName}`;
      const { error } = await auth.admin.from('message_template_media').insert({ id, organization_id: orgId, connection_id: conn.id, storage_path: path, header_type: input.headerType, mime_type: input.mimeType, byte_size: input.size, file_name: fileName });
      if (error) throw new Error('Não foi possível preparar o arquivo.');
      const signed = await auth.admin.storage.from(TEMPLATE_MEDIA_BUCKET).createSignedUploadUrl(path);
      if (signed.error || !signed.data) throw new Error('Não foi possível preparar o upload.');
      return json({ mediaId: id, path: signed.data.path, token: signed.data.token });
    }
    const media = await getTemplateMedia(auth.admin, orgId, conn.id, input.mediaId);
    await readTemplateMedia(auth.admin, media);
    const verified = await auth.admin.from('message_template_media').update({ verified_at: new Date().toISOString() }).eq('id', media.id).eq('organization_id', orgId);
    if (verified.error) throw new Error('Não foi possível validar o upload.');
    if (input.templateId) {
      const { data: template } = await auth.admin.from('message_templates').select('id,header_type').eq('id', input.templateId).eq('organization_id', orgId).eq('connection_id', conn.id).eq('type', 'whatsapp_api').maybeSingle();
      if (!template || template.header_type !== media.header_type) throw new Error('O arquivo não corresponde ao cabeçalho deste modelo.');
      const linked = await auth.admin.from('message_templates').update({ media_id: media.id, updated_at: new Date().toISOString() }).eq('id', template.id).eq('organization_id', orgId);
      if (linked.error) throw new Error('Não foi possível vincular o arquivo.');
    }
    const signed = await auth.admin.storage.from(TEMPLATE_MEDIA_BUCKET).createSignedUrl(media.storage_path, 600);
    return json({ mediaId: media.id, previewUrl: signed.data?.signedUrl ?? null });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Falha no upload' }, 422);
  }
}

export async function GET(req: Request) {
  const auth = await requireOrgUser();
  if (!auth.ok) return auth.response;
  const id = z.string().uuid().safeParse(new URL(req.url).searchParams.get('templateId'));
  if (!id.success) return json({ error: 'Modelo inválido' }, 422);
  const { data: template } = await auth.admin.from('message_templates').select('connection_id,header_type,media_id')
    .eq('id', id.data).eq('organization_id', auth.user.organizationId).maybeSingle();
  if (!template?.media_id || !template.connection_id) return json({ error: 'Arquivo ainda não vinculado' }, 404);
  try {
    const media = await getTemplateMedia(auth.admin, auth.user.organizationId, template.connection_id, template.media_id, template.header_type);
    if (!media.verified_at) return json({ error: 'Arquivo ainda não validado' }, 422);
    const { data, error } = await auth.admin.storage.from(TEMPLATE_MEDIA_BUCKET).createSignedUrl(media.storage_path, 600);
    if (error || !data) throw new Error('Falha ao abrir a prévia');
    const response = json({ previewUrl: data.signedUrl, fileName: media.file_name });
    response.headers.set('cache-control', 'private, no-store');
    return response;
  } catch { return json({ error: 'Arquivo indisponível' }, 404); }
}
