import type { SupabaseClient } from '@supabase/supabase-js';
import type { WaConnectionRow } from './service';
import { TEMPLATE_MEDIA_BUCKET, validateTemplateMedia, type TemplateHeaderType } from '@/lib/templateMedia';

export interface TemplateMediaRow {
  id: string; organization_id: string; connection_id: string; storage_path: string;
  header_type: TemplateHeaderType; mime_type: string; byte_size: number; file_name: string;
  verified_at: string | null; meta_handle: string | null;
}
export function verifyMediaBytes(bytes: Uint8Array, mime: string) {
  const starts = (...values: number[]) => values.every((v, i) => bytes[i] === v);
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));
  const valid = mime === 'image/jpeg' ? starts(255, 216, 255)
    : mime === 'image/png' ? starts(137, 80, 78, 71, 13, 10, 26, 10)
    : mime === 'application/pdf' ? ascii(0, 5) === '%PDF-'
    : mime === 'video/mp4' ? ascii(4, 8) === 'ftyp' : false;
  if (!valid) throw new Error('O conteúdo do arquivo não corresponde ao formato informado.');
}
export async function getTemplateMedia(admin: SupabaseClient, orgId: string, connectionId: string, id: string, type?: string | null) {
  const { data, error } = await admin.from('message_template_media').select('*')
    .eq('id', id).eq('organization_id', orgId).eq('connection_id', connectionId).maybeSingle();
  const media = data as TemplateMediaRow | null;
  if (error || !media || (type && media.header_type !== type) ||
      !media.storage_path.startsWith(`${orgId}/${connectionId}/`) || media.storage_path.includes('..')) {
    throw new Error('Mídia não encontrada para esta organização e conexão.');
  }
  validateTemplateMedia(media.header_type, media.mime_type, media.byte_size);
  return media;
}
export async function readTemplateMedia(admin: SupabaseClient, media: TemplateMediaRow) {
  const { data, error } = await admin.storage.from(TEMPLATE_MEDIA_BUCKET).download(media.storage_path);
  if (error || !data) throw new Error('Arquivo não encontrado. Faça o upload novamente.');
  validateTemplateMedia(media.header_type, data.type, data.size);
  if (data.size !== media.byte_size || data.type !== media.mime_type) throw new Error('Arquivo diferente do upload autorizado.');
  const bytes = new Uint8Array(await data.arrayBuffer());
  verifyMediaBytes(bytes, media.mime_type);
  return bytes;
}
/** Only server-owned Storage references are resolved; arbitrary URLs are never fetched. */
export async function resolveTemplateComponents(admin: SupabaseClient, orgId: string, connectionId: string,
  template: { header_type?: string | null; media_id?: string | null }, params: string[]) {
  const components: Record<string, unknown>[] = [];
  if (template.header_type) {
    if (!template.media_id) throw new Error('Este modelo precisa de mídia. Selecione o arquivo em Configurações → Modelos.');
    const media = await getTemplateMedia(admin, orgId, connectionId, template.media_id, template.header_type);
    if (!media.verified_at) throw new Error('Upload de mídia ainda não concluído.');
    const { data, error } = await admin.storage.from(TEMPLATE_MEDIA_BUCKET).createSignedUrl(media.storage_path, 600);
    if (error || !data?.signedUrl) throw new Error('Não foi possível preparar a mídia do modelo.');
    components.push({ type: 'header', parameters: [{ type: media.header_type, [media.header_type]: {
      link: data.signedUrl, ...(media.header_type === 'document' ? { filename: media.file_name } : {}),
    } }] });
  }
  if (params.length) components.push({ type: 'body', parameters: params.map(text => ({ type: 'text', text })) });
  return components.length ? components : undefined;
}
/** Resumable Upload API returns a handle used exclusively as the approval sample. */
export async function uploadMetaTemplateSample(conn: WaConnectionRow, media: TemplateMediaRow, bytes: Uint8Array) {
  const appId = conn.meta_app_id || process.env.META_ES_APP_ID;
  if (conn.provider !== 'meta_cloud' || !appId || !conn.instance_token) throw new Error('Amostras de mídia exigem conexão Meta Cloud com App ID configurado.');
  const base = `https://graph.facebook.com/${process.env.META_GRAPH_VERSION || 'v21.0'}`;
  const query = new URLSearchParams({ file_name: media.file_name, file_length: String(bytes.length), file_type: media.mime_type });
  const session = await fetch(`${base}/${encodeURIComponent(appId)}/uploads?${query}`, {
    method: 'POST', headers: { authorization: `Bearer ${conn.instance_token}` }, cache: 'no-store',
  });
  const started = await session.json();
  if (!session.ok || typeof started.id !== 'string' || !started.id.startsWith('upload:')) throw new Error('Meta não autorizou a amostra. Confira App ID e permissões da conexão.');
  const uploaded = await fetch(`${base}/${started.id}`, {
    method: 'POST', headers: { authorization: `OAuth ${conn.instance_token}`, file_offset: '0', 'content-type': 'application/octet-stream' },
    body: Buffer.from(bytes), cache: 'no-store',
  });
  const result = await uploaded.json();
  if (!uploaded.ok || typeof result.h !== 'string') throw new Error('Meta recusou a amostra de mídia. Verifique formato e permissões.');
  return result.h as string;
}
