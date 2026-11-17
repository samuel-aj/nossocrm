import sharp from 'sharp';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { json } from '@/lib/whatsapp/api';
import { getAccessibleGroup } from '@/lib/whatsapp/groupAccess';
import { editGroupProperty, readGroupProperties, type GroupEdit } from '@/lib/whatsapp/groups';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const maxPhotoBytes = 3 * 1024 * 1024;

export async function GET(req: Request) {
  const access = await getAccessibleGroup(req);
  if (access instanceof Response) return access;
  const result = await readGroupProperties(access.conn, access.groupId);
  if (!result.ok) return json({ error: result.error }, 502);
  return json(result.properties);
}

export async function PATCH(req: Request) {
  if (!isAllowedOrigin(req)) return json({ error: 'Origem inválida.' }, 403);
  const access = await getAccessibleGroup(req);
  if (access instanceof Response) return access;
  if (Number(req.headers.get('content-length')) > maxPhotoBytes + 16384) return json({ error: 'A foto deve ter até 3 MB.' }, 413);
  const form = await req.formData().catch(() => null);
  const field = form?.get('field');
  const value = form?.get('value');
  let edit: GroupEdit;
  if (field === 'subject' || field === 'description') {
    const limit = field === 'description' ? 2048 : access.conn.provider === 'meta_cloud' ? 128 : 100;
    if (typeof value !== 'string' || (field === 'subject' && !value.trim()) || Array.from(value.trim()).length > limit) {
      return json({ error: field === 'subject' ? 'Informe um nome com até ' + limit + ' caracteres.' : 'A descrição deve ter até 2048 caracteres.' }, 400);
    }
    edit = { field, value: value.trim() };
  } else if (field === 'photo' && value instanceof Blob) {
    if (value.size > maxPhotoBytes) return json({ error: 'A foto deve ter até 3 MB.' }, 413);
    try {
      const image = sharp(Buffer.from(await value.arrayBuffer()), { limitInputPixels: 32_000_000 });
      const { format } = await image.metadata();
      if (format !== 'jpeg' && format !== 'png') return json({ error: 'Escolha uma foto JPG ou PNG.' }, 400);
      const buffer = await image.rotate().resize(640, 640, { fit: 'cover' }).flatten({ background: '#ffffff' }).jpeg().toBuffer();
      edit = { field, jpeg: Uint8Array.from(buffer) };
    } catch {
      return json({ error: 'Não foi possível ler a foto. Escolha outra imagem JPG ou PNG.' }, 400);
    }
  } else return json({ error: 'Propriedade inválida.' }, 400);
  const { conn, groupId, admin, orgId, group } = access;
  const result = await editGroupProperty(conn, groupId, edit);
  if (!result.ok) return json({ error: result.error }, 502);
  if (result.pending) return json({ pending: true }, 202);
  let snapshot: { wa_name: string } | { avatar_path: string; avatar_synced_at: string } | null = null;
  if (edit.field === 'subject') snapshot = { wa_name: edit.value };
  if (edit.field === 'photo') {
    const path = orgId + '/avatars/' + group.id + '.jpg';
    const upload = await admin.storage.from('wa-media').upload(path, edit.jpeg, { contentType: 'image/jpeg', upsert: true });
    if (upload.error) return json({ warning: 'Foto salva no WhatsApp. A lista de chats pode demorar para atualizar.' });
    snapshot = { avatar_path: path, avatar_synced_at: new Date().toISOString() };
  }
  if (snapshot) {
    const { error } = await admin.from('wa_conversations').update(snapshot).eq('organization_id', orgId).eq('id', group.id).eq('connection_id', conn.id).eq('is_group', true);
    if (error) return json({ warning: 'Alteração salva no WhatsApp. A lista de chats pode demorar para atualizar.' });
  }
  return json({ pending: false });
}
