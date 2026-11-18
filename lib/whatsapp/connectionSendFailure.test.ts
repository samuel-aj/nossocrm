import { beforeEach, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { reportBlockedSend, reportRejectedSend } from './connectionSendFailure';
import { MetaCloudProvider } from './providers/metaCloud';

const rpc = vi.fn();
const admin = { rpc } as unknown as SupabaseClient;
const startedAt = '2026-11-18T02:18:00.000Z';
beforeEach(() => { rpc.mockReset().mockResolvedValue({ data: true }); });

it('distingue um bloqueio local de uma recusa explícita anterior à entrega', async () => {
  await reportBlockedSend(admin, 'linha');
  expect(rpc).toHaveBeenCalledWith('wa_observe_connection', expect.objectContaining({ p_source: 'send_blocked', p_reason: 'crm_send_blocked' }));
  const result = { ok: false, error: 'Evolution respondeu 400: Connection Closed' };
  expect(await reportRejectedSend(admin, 'linha', result, startedAt)).toBe(true);
  expect(rpc).toHaveBeenCalledWith('wa_observe_connection', expect.objectContaining({ p_source: 'send_failure', p_observed_at: startedAt, p_reason: 'evolution_send_http_400' }));
});

it('preserva incerteza de timeout e não reclassifica mensagem com id aceito', async () => {
  expect(await reportRejectedSend(admin, 'linha', { ok: false, error: 'timeout' }, startedAt)).toBe(false);
  expect(await reportRejectedSend(admin, 'linha', { ok: false, error: 'Connection Closed', providerMessageId: 'accepted' }, startedAt)).toBe(false);
  expect(rpc).not.toHaveBeenCalled();
});

it('avisa na primeira recusa da credencial do número, sem confundir a janela de um destinatário com queda', async () => {
  const fake = vi.spyOn(globalThis, 'fetch');
  try {
    const provider = new MetaCloudProvider({ baseUrl: '', instanceName: 'teste', phoneNumberId: '123', token: 'teste' });
    const rejected = async (code: number) => {
      fake.mockResolvedValueOnce(Response.json({ error: { code, error_subcode: 463, message: 'segredo do contato' } }, { status: 400 }));
      return reportRejectedSend(admin, 'linha', await provider.sendText({ to: '5511999990000', text: 'teste' }), startedAt);
    };
    expect(await rejected(131047)).toBe(false);
    expect(await rejected(190)).toBe(true);
    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith('wa_observe_connection', expect.objectContaining({ p_reason: 'meta_code_190_sub_463' }));
    expect(JSON.stringify(rpc.mock.calls)).not.toContain('segredo');
  } finally { fake.mockRestore(); }
});
