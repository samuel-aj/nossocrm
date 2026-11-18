import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { EvolutionProvider } from './providers/evolution';
import { MetaCloudProvider } from './providers/metaCloud';
import { monitorConnections } from './connectionMonitor';
import { observeConnection } from './connectionIncidents';

vi.mock('./connectionIncidents', () => ({ observeConnection: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
const config = { baseUrl: 'https://evolution.invalid', instanceName: 'teste', token: 'teste', phoneNumberId: '123' };
const reply = (data: unknown, status = 200) => Response.json(data, { status });

describe('verificação em segundo plano sem envio', () => {
  it('confere a sessão aberta com uma consulta nova e não reutiliza uma resposta em cache', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(reply({ instance: { state: 'open' } })).mockResolvedValueOnce(reply([]))
      .mockResolvedValueOnce(reply({ instance: { state: 'open' } })).mockResolvedValueOnce(new Response('Connection Closed', { status: 400 }));
    vi.stubGlobal('fetch', fetcher);
    const provider = new EvolutionProvider(config);
    expect((await provider.checkConnectionHealth()).state).toBe('connected');
    expect((await provider.checkConnectionHealth()).state).toBe('disconnected');
    expect(fetcher.mock.calls.map(([url]) => new URL(url).pathname)).toEqual([
      '/instance/connectionState/teste', '/chat/whatsappNumbers/teste', '/instance/connectionState/teste', '/chat/whatsappNumbers/teste',
    ]);
  });

  it('mantém a verificação inconclusiva quando o provedor está indisponível', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(reply({}, 503)).mockResolvedValueOnce(reply({ state: 'open' })).mockResolvedValueOnce(reply({}, 429)));
    const provider = new EvolutionProvider(config);
    expect((await provider.checkConnectionHealth()).state).toBe('unknown');
    expect((await provider.checkConnectionHealth()).state).toBe('unknown');
  });

  it('verifica autorização e disponibilidade da linha da Meta com uma consulta', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(reply({ health_status: { can_send_message: 'AVAILABLE' } }))
      .mockResolvedValueOnce(reply({ health_status: { can_send_message: 'BLOCKED' } }))
      .mockResolvedValueOnce(reply({ health_status: { can_send_message: 'LIMITED' } }))
      .mockResolvedValueOnce(reply({ error: { code: 190 } }, 401));
    vi.stubGlobal('fetch', fetcher);
    const provider = new MetaCloudProvider(config);
    for (const state of ['connected', 'disconnected', 'unknown', 'disconnected']) expect((await provider.checkConnectionHealth()).state).toBe(state);
    expect(fetcher.mock.calls.every(([url, init]) => new URL(url).searchParams.get('fields') === 'health_status' && !init.body)).toBe(true);
  });

  it('registra também consultas inconclusivas com a hora de início e não toca nas conversas', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')));
    const rpc = vi.fn().mockResolvedValue({ data: [{ id: 'linha', instance_name: 'teste', provider: 'evolution', base_url: config.baseUrl }] });
    const admin = { rpc } as unknown as SupabaseClient;
    await monitorConnections(admin, Date.now() + 30_000);
    expect(rpc).toHaveBeenCalledExactlyOnceWith('wa_claim_connection_probes', { p_limit: 8 });
    expect(observeConnection).toHaveBeenCalledWith(admin, 'linha', 'unknown', 'poll', expect.any(String), expect.any(String));
  });

  it('exige a identidade da própria instância antes de liberar uma linha QR', async () => {
    const state = () => reply({ state: 'open' });
    const fetcher = vi.fn().mockResolvedValueOnce(state()).mockResolvedValueOnce(reply([]))
      .mockResolvedValueOnce(reply([{ name: 'outro', ownerJid: '5511000000010@s.whatsapp.net' }]))
      .mockResolvedValueOnce(state()).mockResolvedValueOnce(reply([]))
      .mockResolvedValueOnce(reply([{ name: 'teste', ownerJid: '5511999990010@s.whatsapp.net' }]));
    vi.stubGlobal('fetch', fetcher);
    const admin = { rpc: vi.fn().mockResolvedValue({ data: [{ id: 'linha', provider: 'evolution', instance_name: 'teste', base_url: config.baseUrl }] }) } as unknown as SupabaseClient;
    await monitorConnections(admin, Date.now() + 30_000);
    expect(observeConnection).toHaveBeenLastCalledWith(admin, 'linha', 'unknown', 'poll', expect.any(String), 'identity_unavailable');
    await monitorConnections(admin, Date.now() + 30_000);
    expect(observeConnection).toHaveBeenLastCalledWith(admin, 'linha', 'connected', 'poll', expect.any(String), 'verified_session', expect.objectContaining({ phone: '+5511999990010' }));
  });
});
