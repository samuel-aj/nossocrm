// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { GET, PATCH } from './route';

const m = vi.hoisted(() => ({ access: vi.fn(), read: vi.fn(), edit: vi.fn(), from: vi.fn(), upload: vi.fn(), update: vi.fn() }));
vi.mock('@/lib/whatsapp/groupAccess', () => ({ getAccessibleGroup: m.access }));
vi.mock('@/lib/whatsapp/groups', () => ({ readGroupProperties: m.read, editGroupProperty: m.edit }));
vi.mock('@/lib/whatsapp/api', () => ({ json: (body: unknown, status = 200) => Response.json(body, { status }) }));
const conn = { id: 'connection', provider: 'evolution' };
const url = 'https://crm.test/api/whatsapp/groups/properties?conversationId=conversation';
const req = (field: string, value: string | Blob, origin = 'https://crm.test') => {
  const form = new FormData();
  form.set('field', field);
  form.set('value', value);
  return new Request(url, { method: 'PATCH', body: form, headers: { origin, host: 'crm.test' } });
};
beforeEach(() => {
  vi.resetAllMocks();
  const q = { eq: vi.fn().mockReturnThis(), error: null };
  m.update.mockReturnValue(q);
  m.from.mockReturnValue({ update: m.update });
  m.upload.mockResolvedValue({ error: null });
  const admin = { from: m.from, storage: { from: () => ({ upload: m.upload }) } };
  m.access.mockResolvedValue({ conn, admin, orgId: 'org', group: { id: 'conversation' }, groupId: 'group@g.us' });
  m.edit.mockResolvedValue({ ok: true, pending: false });
});
describe('group properties', () => {
  it('reads through the scoped group and never writes when it is opened', async () => {
    const properties = { subject: 'Equipe', description: 'Avisos', pictureUrl: null };
    m.read.mockResolvedValue({ ok: true, properties });
    expect(await (await GET(new Request(url))).json()).toEqual(properties);
    expect(m.read).toHaveBeenCalledWith(conn, 'group@g.us');
    expect(m.edit).not.toHaveBeenCalled();
  });
  it('requires same-origin writes and access to the selected conversation', async () => {
    expect((await PATCH(req('subject', 'Equipe', 'https://other.test'))).status).toBe(403);
    expect(m.access).not.toHaveBeenCalled();
    m.access.mockResolvedValue(new Response(null, { status: 404 }));
    expect((await PATCH(req('subject', 'Equipe'))).status).toBe(404);
    expect(m.edit).not.toHaveBeenCalled();
  });
  it('saves the confirmed group name to the existing conversation', async () => {
    expect((await PATCH(req('subject', '  Atendimento  '))).status).toBe(200);
    expect(m.edit).toHaveBeenCalledWith(conn, 'group@g.us', { field: 'subject', value: 'Atendimento' });
    expect(m.update).toHaveBeenCalledWith({ wa_name: 'Atendimento' });
  });
  it('keeps CRM metadata untouched on refusal or pending confirmation', async () => {
    m.edit.mockResolvedValueOnce({ ok: false, error: 'Acesso negado' });
    expect((await PATCH(req('subject', 'Grupo'))).status).toBe(502);
    m.edit.mockResolvedValueOnce({ ok: true, pending: true });
    expect((await PATCH(req('subject', 'Grupo'))).status).toBe(202);
    expect(m.update).not.toHaveBeenCalled();
  });
  it('rejects invalid names and fake images before contacting WhatsApp', async () => {
    expect((await PATCH(req('subject', ' '))).status).toBe(400);
    expect((await PATCH(req('photo', new Blob(['fake'], { type: 'image/jpeg' })))).status).toBe(400);
    expect(m.edit).not.toHaveBeenCalled();
  });
  it('normalizes a PNG and updates the private avatar only after confirmation', async () => {
    const png = await sharp({ create: { width: 10, height: 20, channels: 3, background: 'red' } }).png().toBuffer();
    const response = await PATCH(req('photo', new Blob([Uint8Array.from(png)], { type: 'image/png' })));
    expect(response.status).toBe(200);
    const edit = m.edit.mock.calls[0][2];
    expect(await sharp(edit.jpeg).metadata()).toMatchObject({ format: 'jpeg', width: 640, height: 640 });
    expect(m.upload).toHaveBeenCalledWith('org/avatars/conversation.jpg', edit.jpeg, expect.anything());
    expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ avatar_path: 'org/avatars/conversation.jpg' }));
  });
});
