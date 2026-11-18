import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { EvolutionProvider } from './providers/evolution';
import { MetaCloudProvider } from './providers/metaCloud';
import { monitorConnections } from './connectionMonitor';
import { observeConnection } from './connectionIncidents';
import { evolutionConnectionEvent } from '@/supabase/functions/whatsapp-webhook/connection-event-time';

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
    expect(await provider.checkConnectionHealth()).toEqual({ state: 'unknown', reason: 'evolution_http_503' });
    expect(await provider.checkConnectionHealth()).toEqual({ state: 'unknown', reason: 'evolution_socket_http_429' });
  });

  it('preserva a causa explícita da própria sessão e descarta motivos de outra linha ou anteriores à reconexão', async () => {
    const now = Date.now();
    const lastConnected = new Date(now - 180_000).toISOString();
    const row = { name: 'teste', disconnectionReasonCode: 401, disconnectionAt: new Date(now - 1000).toISOString() };
    const closed = () => reply({ instance: { state: 'close' } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(closed()).mockResolvedValueOnce(reply([row]))
      .mockResolvedValueOnce(closed()).mockResolvedValueOnce(reply([{ ...row, disconnectionAt: new Date(now - 200_000).toISOString() }]))
      .mockResolvedValueOnce(closed()).mockResolvedValueOnce(reply([{ ...row, name: 'outro' }])));
    const provider = new EvolutionProvider(config);
    for (const reason of ['evolution_disconnect_401', 'evolution_state_close', 'evolution_state_close']) {
      expect(await provider.checkConnectionHealth(lastConnected)).toEqual({ state: 'disconnected', reason });
    }
  });

  it('ordena a queda pela hora de origem e recebe somente o código do webhook', () => {
    const when = '2024-01-01T08:00:00.000Z';
    const detail = { status: 'closed', disconnectionReasonCode: 401, disconnectionAt: when, disconnectionObject: 'dado privado' };
    expect(evolutionConnectionEvent('status.instance', detail, '2024-01-01T09:00:00.000Z'))
      .toEqual({ state: 'disconnected', reason: 'evolution_disconnect_401', emittedAt: when });
    expect(evolutionConnectionEvent('connection.update', { state: 'refused', lastDisconnect: { error: { output: { statusCode: 428 } } } }, null))
      .toEqual({ state: 'unknown', reason: 'webhook_undated_evolution_disconnect_428', emittedAt: null });
    expect(evolutionConnectionEvent('connection.update', { state: 'close', statusReason: '5511000000000' }, when).reason).toBe('disconnected');
    expect(evolutionConnectionEvent('connection.update', { state: 'open', statusReason: 200 }, when).reason).toBe('connected');
  });

  it('verifica autorização e disponibilidade da linha da Meta com uma consulta', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(reply({ health_status: { can_send_message: 'AVAILABLE' } }))
      .mockResolvedValueOnce(reply({ health_status: { can_send_message: 'BLOCKED', entities: [{ can_send_message: 'BLOCKED', errors: [{ error_code: 123, details: 'privado' }] }] } }))
      .mockResolvedValueOnce(reply({ health_status: { can_send_message: 'LIMITED' } }))
      .mockResolvedValueOnce(reply({ error: { code: 190, error_subcode: 463 } }, 401));
    vi.stubGlobal('fetch', fetcher);
    const provider = new MetaCloudProvider(config);
    for (const [state, reason] of [['connected', undefined], ['disconnected', 'meta_code_123'], ['unknown', 'meta_health_limited'], ['disconnected', 'meta_code_190_sub_463']]) {
      const health = await provider.checkConnectionHealth();
      expect([health.state, health.reason]).toEqual([state, reason]);
    }
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
