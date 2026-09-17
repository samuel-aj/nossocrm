import { afterEach, expect, it, vi } from 'vitest';
import { EvolutionProvider } from './evolution';
afterEach(() => vi.unstubAllGlobals());
it('requests deletion for everyone with the stored key and destination', async () => {
  const fetchMock = vi.fn().mockResolvedValue(Response.json({ key: { id: 'revoke-event' } }));
  vi.stubGlobal('fetch', fetchMock);
  const provider = new EvolutionProvider({ baseUrl: 'https://provider.test', instanceName: 'instance one', token: 'test' });
  expect(await provider.deleteMessage({ to: '123@g.us', providerMessageId: 'original' })).toEqual({ ok: true, providerMessageId: 'original' });
  expect(fetchMock).toHaveBeenCalledWith('https://provider.test/chat/deleteMessageForEveryone/instance%20one', expect.objectContaining({ method: 'DELETE', body: JSON.stringify({ id: 'original', fromMe: true, remoteJid: '123@g.us' }) }));
});
it('requires provider confirmation', async () => {
  const provider = new EvolutionProvider({ baseUrl: 'https://provider.test', instanceName: 'test', token: 'test' });
  for (const response of [Response.json({}), Response.json({ message: 'Rejected' }, { status: 400 })]) {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
    expect((await provider.deleteMessage({ to: '+5569999999999', providerMessageId: 'original' })).ok).toBe(false);
  }
});
