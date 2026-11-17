// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { editGroupProperty, getMetaGroupParticipants, readGroupProperties } from './groups';
import type { WaConnectionRow } from './service';
const qr = { provider: 'evolution', base_url: 'https://qr.test', instance_name: 'Número 1', instance_token: 'test' } as WaConnectionRow;
const meta = { provider: 'meta_cloud', instance_token: 'test' } as WaConnectionRow;
afterEach(() => vi.unstubAllGlobals());

describe('provider contracts', () => {
  it('reads the QR metadata and sends only the requested description to its group', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ subject: 'Equipe', desc: 'Avisos', pictureUrl: 'https://avatar.test/photo' }))
      .mockResolvedValueOnce(Response.json({ update: 'success' }));
    vi.stubGlobal('fetch', fetcher);
    expect(await readGroupProperties(qr, '123@g.us')).toMatchObject({ properties: { subject: 'Equipe', description: 'Avisos' } });
    expect(await editGroupProperty(qr, '123@g.us', { field: 'description', value: 'Nova descrição' })).toEqual({ ok: true, pending: false });
    const [url, init] = fetcher.mock.calls[1];
    expect(url).toContain('/group/updateGroupDescription/N%C3%BAmero%201?groupJid=123%40g.us');
    expect(JSON.parse(init.body)).toEqual({ groupJid: '123@g.us', description: 'Nova descrição' });
  });
  it('submits Meta photo updates as multipart and distinguishes acceptance from completion', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ request_id: 'req1' }));
    vi.stubGlobal('fetch', fetcher);
    expect(await editGroupProperty(meta, 'group', { field: 'photo', jpeg: new Uint8Array([1, 2]) })).toEqual({ ok: true, pending: true });
    const form: FormData = fetcher.mock.calls[0][1].body;
    expect(form.get('messaging_product')).toBe('whatsapp');
    expect(form.get('profile_picture_file')).toMatchObject({ type: 'image/jpeg', size: 2 });
  });
  it('does not interpret an opaque Meta user ID as a phone number', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ participants: [{ user_id: '123456789', username: 'Maria' }] })));
    expect(await getMetaGroupParticipants(meta, 'group')).toMatchObject({ participants: [{ name: 'Maria', phone: null }] });
  });
});
