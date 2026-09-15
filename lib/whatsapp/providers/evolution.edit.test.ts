import { afterEach, describe, expect, it, vi } from 'vitest';
import { EvolutionProvider } from './evolution';
afterEach(() => vi.unstubAllGlobals());
describe('Evolution message editing', () => {
  it('targets the same message and original conversation', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ key: { id: 'edit-event-id' } }));
    vi.stubGlobal('fetch', fetchMock);
    const provider = new EvolutionProvider({ baseUrl: 'https://provider.test', instanceName: 'instance one', token: 'test-token' });
    expect(await provider.editText({ to: '123@g.us', providerMessageId: 'original', text: 'Novo texto' })).toEqual({ ok: true, providerMessageId: 'original' });
    expect(fetchMock).toHaveBeenCalledWith('https://provider.test/chat/updateMessage/instance%20one', expect.objectContaining({ method: 'POST', body: JSON.stringify({ number: '123@g.us', key: { id: 'original', fromMe: true, remoteJid: '123@g.us' }, text: 'Novo texto' }) }));
  });
  it('does not report success without provider confirmation', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({})));
    const provider = new EvolutionProvider({ baseUrl: 'https://provider.test', instanceName: 'test', token: 'test' });
    expect((await provider.editText({ to: '+5569999999999', providerMessageId: 'original', text: 'Novo' })).ok).toBe(false);
  });
});
