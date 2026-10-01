import { afterEach, describe, expect, it, vi } from 'vitest';
import { EvolutionProvider } from './evolution';
import { pairingCode, pairingPhone } from '../pairing';

const provider = () => new EvolutionProvider({ baseUrl: 'https://evo.test', instanceName: 'test / one', token: 'test' });
const response = (data: unknown, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => data });
const state = (value: string) => response({ instance: { state: value } });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('Evolution device pairing', () => {
  it('accepts formatted international phones and rejects arbitrary text and invalid numbers', () => {
    expect(pairingPhone('+55 (11) 99999-0000')).toBe('5511999990000');
    expect(pairingPhone('+1 202-555-0123')).toBe('12025550123');
    expect(pairingPhone('not a number 5511999990000')).toBeNull();
    expect(pairingPhone({})).toBeNull();
    expect(pairingPhone('123')).toBeNull();
    expect(pairingCode('abcd-2345')).toBe('ABCD2345');
    expect(pairingCode('2@qr-content')).toBeUndefined();
  });
  it('never substitutes QR content for a pairing code', async () => {
    const fetch = vi.fn().mockResolvedValue(response({ code: '2@qr-content', base64: 'data:image/png;base64,test' }));
    vi.stubGlobal('fetch', fetch);
    expect(await provider().getQrCode()).toEqual({ state: 'connecting', qrBase64: 'data:image/png;base64,test', pairingCode: undefined });
  });
  it('passes the phone in the documented number query and waits for the generated code', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockResolvedValueOnce(state('close'))
      .mockResolvedValueOnce(response({ base64: 'qr', pairingCode: null }))
      .mockResolvedValueOnce(response({ base64: 'qr', pairingCode: 'ABCD2345' }));
    vi.stubGlobal('fetch', fetch);
    const result = provider().startPairing('+5511999990000');
    await vi.runAllTimersAsync();
    expect(await result).toMatchObject({ state: 'connecting', pairingCode: 'ABCD2345' });
    expect(fetch.mock.calls[1][0]).toBe('https://evo.test/instance/connect/test%20%2F%20one?number=5511999990000');
  });
  it('does not log out an open session, including one completed during a method switch', async () => {
    for (const initial of ['open', 'connecting']) {
      const fetch = vi.fn().mockResolvedValueOnce(state(initial)).mockResolvedValue(state('open'));
      vi.stubGlobal('fetch', fetch);
      expect(await provider().startPairing('5511999990000')).toEqual({ state: 'connected' });
      expect(fetch.mock.calls.every(call => call[1].method === 'GET')).toBe(true);
      expect(fetch.mock.calls.some(call => call[0].includes('/instance/connect/'))).toBe(false);
    }
  });
  it('resets only a pending attempt before switching QR to code', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockResolvedValueOnce(state('connecting')).mockResolvedValueOnce(state('connecting'))
      .mockResolvedValueOnce(response({ status: 'SUCCESS' })).mockResolvedValueOnce(state('close'))
      .mockResolvedValueOnce(response({ pairingCode: 'WXYZ2345' }));
    vi.stubGlobal('fetch', fetch);
    const result = provider().startPairing('5511999990000');
    await vi.runAllTimersAsync();
    expect(await result).toMatchObject({ pairingCode: 'WXYZ2345' });
    expect(fetch.mock.calls[2][0]).toContain('/instance/logout/');
    expect(fetch.mock.calls[2][1].method).toBe('DELETE');
    expect(fetch.mock.calls[4][0]).toContain('?number=5511999990000');
  });
  it('keeps expired sessions closed during polling', async () => {
    const fetch = vi.fn().mockResolvedValue(state('close'));
    vi.stubGlobal('fetch', fetch);
    expect(await provider().getPairingStatus()).toEqual({ state: 'disconnected' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('fails closed on an unavailable status endpoint', async () => {
    const fetch = vi.fn().mockResolvedValue(response({ error: 'unauthorized' }, false));
    vi.stubGlobal('fetch', fetch);
    await expect(provider().startPairing()).rejects.toThrow('consultar');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('generates QR without a number query', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(state('close')).mockResolvedValueOnce(response({ base64: 'qr-image' }));
    vi.stubGlobal('fetch', fetch);
    expect(await provider().startPairing()).toMatchObject({ qrBase64: 'qr-image' });
    expect(fetch.mock.calls[1][0]).not.toContain('?');
  });
  it('rejects invalid phone input before any provider call', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(provider().startPairing('123')).rejects.toThrow('telefone válido');
    expect(fetch).not.toHaveBeenCalled();
  });
});
