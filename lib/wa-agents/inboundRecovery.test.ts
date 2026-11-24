import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleInboundMessage } from './engine';
import { processInboundRecovery } from './inboundRecovery';

vi.mock('./engine', () => ({ handleInboundMessage: vi.fn() }));
const handle = vi.mocked(handleInboundMessage);
const key = { organization_id: 'org', conversation_id: 'conv', message_id: 'message' };
const work = { ...key, lease_token: 'lease', completed_steps: ['bots'], recover_only_if_unanswered: true };
const lease = { p_message_id: work.message_id, p_lease_token: work.lease_token };

function database(rows = [work]) {
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === 'claim_wa_inbound_work') return { data: rows, error: null };
    if (name === 'advance_wa_inbound_work') return { data: 'ready', error: null };
    if (name === 'finish_wa_inbound_work') return { data: args.p_outcome, error: null };
    throw new Error('unexpected RPC: ' + name);
  });
  return { admin: { rpc } as unknown as SupabaseClient, rpc };
}
beforeEach(() => vi.resetAllMocks());

describe('recuperação da entrada do WhatsApp', () => {
  it('a notificação do banco só pode processar a mensagem no escopo da própria conversa', async () => {
    const { admin, rpc } = database([]);
    await processInboundRecovery(admin, key);
    expect(rpc).toHaveBeenCalledExactlyOnceWith('claim_wa_inbound_work', {
      p_org: 'org', p_conversation: 'conv', p_message_id: 'message', p_limit: 1,
    });
    expect(handle).not.toHaveBeenCalled();
  });

  it('encaminha fases persistidas e protege cada novo efeito com o token da reserva', async () => {
    const { admin, rpc } = database();
    handle.mockImplementationOnce(async ({ delivery }) => {
      expect(delivery?.completedSteps).toEqual(['bots']);
      expect(delivery?.recoverOnlyIfUnanswered).toBe(true);
      await delivery!.beginStep('message_received');
      await delivery!.finishStep('message_received');
      await delivery!.beginStep('dispatch');
      return { status: 'ok', disposition: 'done' };
    });
    await processInboundRecovery(admin);
    expect(rpc.mock.calls).toEqual([
      ['claim_wa_inbound_work', { p_org: null, p_conversation: null, p_message_id: null, p_limit: 3 }],
      ['advance_wa_inbound_work', { ...lease, p_step: 'message_received', p_finished: false }],
      ['advance_wa_inbound_work', { ...lease, p_step: 'message_received', p_finished: true }],
      ['advance_wa_inbound_work', { ...lease, p_step: 'dispatch', p_finished: false }],
      ['finish_wa_inbound_work', { ...lease, p_outcome: 'done', p_reason: null }],
    ]);
  });

  it.each([false, true])('distingue timeout antes de gerar e timeout após autorização de envio (%s)', async started => {
    const { admin, rpc } = database();
    handle.mockImplementationOnce(async ({ delivery }) => {
      if (started) await delivery!.beginStep('dispatch');
      throw new Error('statement timeout');
    });
    await processInboundRecovery(admin, key);
    expect(rpc).toHaveBeenLastCalledWith('finish_wa_inbound_work', {
      ...lease, p_outcome: started ? 'review' : 'retry', p_reason: 'statement timeout',
    });
  });

  it('encerra a entrada assumida pela equipe e encaminha uma entrega incerta para o sino', async () => {
    const { admin, rpc } = database();
    handle.mockResolvedValueOnce({ status: 'skipped', disposition: 'done', reason: 'atendente respondeu' });
    await processInboundRecovery(admin, key);
    expect(rpc).toHaveBeenLastCalledWith('finish_wa_inbound_work', { ...lease, p_outcome: 'cancelled', p_reason: 'atendente respondeu' });
    handle.mockResolvedValueOnce({ status: 'error', disposition: 'attention', reason: 'entrega incerta' });
    await processInboundRecovery(admin, key);
    expect(rpc).toHaveBeenLastCalledWith('finish_wa_inbound_work', { ...lease, p_outcome: 'review', p_reason: 'entrega incerta' });
  });

  it('uma reserva perdida antes de uma ação interrompe o trabalho sem gravar por cima do novo estado', async () => {
    const { admin, rpc } = database();
    rpc.mockResolvedValueOnce({ data: [work], error: null }).mockResolvedValueOnce({ data: 'cancelled', error: null });
    handle.mockImplementationOnce(async ({ delivery }) => {
      await expect(delivery!.beginStep('dispatch')).rejects.toThrow();
      await expect(delivery!.beginStep('dispatch')).rejects.toThrow();
      return { status: 'error', disposition: 'retry' };
    });
    await processInboundRecovery(admin, key);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('uma perda de conexão ao confirmar a fase deixa a reserva expirar e permite atender outra conversa do lote', async () => {
    const other = { ...work, conversation_id: 'other-conversation', message_id: 'other-message', lease_token: 'other-lease' };
    const { admin, rpc } = database([work, other]);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    rpc.mockImplementation(async (name, args) => {
      if (name === 'claim_wa_inbound_work') return { data: [work, other], error: null };
      if (name === 'advance_wa_inbound_work' && args.p_message_id === work.message_id) {
        throw new Error('connection reset after commit');
      }
      return { data: name === 'advance_wa_inbound_work' ? 'ready' : 'done', error: null };
    });
    handle.mockImplementation(async ({ delivery }) => {
      await delivery!.beginStep('dispatch');
      return { status: 'ok', disposition: 'done' };
    });
    try {
      await processInboundRecovery(admin);
      expect(log).toHaveBeenCalledWith('[wa-agents] falha ao confirmar a fase da entrada', work.message_id, 'dispatch', 'connection reset after commit');
      expect(rpc.mock.calls.filter(([name]) => name === 'finish_wa_inbound_work')).toEqual([
        ['finish_wa_inbound_work', { p_message_id: other.message_id, p_lease_token: other.lease_token, p_outcome: 'done', p_reason: null }],
      ]);
    } finally {
      log.mockRestore();
    }
  });
});
