import { afterEach, describe, expect, it, vi } from 'vitest';
import { EvolutionProvider } from './evolution';
afterEach(() => vi.unstubAllGlobals());
describe('Evolution mention payload', () => {
  it('passes verified JIDs to text and caption endpoints, retaining LID identities', async () => {
    const request = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ key: { id: 'test' } }) });
    vi.stubGlobal('fetch', request);
    const provider = new EvolutionProvider({ baseUrl: 'https://evo.test', instanceName: 'test', token: 'test-only' });
    const mentioned = ['123456789@lid', '5511999990000@s.whatsapp.net'];
    await provider.sendText({ to: '123@g.us', text: '@123456789 olá', isGroup: true, mentioned });
    expect(JSON.parse(request.mock.calls[0][1].body)).toMatchObject({ number: '123@g.us', text: '@123456789 olá', mentioned });
    await provider.sendMedia({ to: '123@g.us', media: 'https://example.com/test.png', kind: 'image', caption: '@123456789 foto', isGroup: true, mentioned });
    expect(JSON.parse(request.mock.calls[1][1].body)).toMatchObject({ caption: '@123456789 foto', mentioned });
  });
});
