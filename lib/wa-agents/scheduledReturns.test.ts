import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { buildAgentTools } from './tools';
import { scheduledReturnRuntime } from './scheduledReturns';
import type { AgentRow } from './types';
const agent = { id: 'agent', outcomes: [], custom_actions: [], tools: { scheduled_return_bot_id: 'configured-bot', calculator: false } } as unknown as AgentRow;
const input = { local: '2026-11-07T14:00', timezone: 'America/Manaus', context: 'Retorno solicitado', confirmed: true as const };
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-05')); });
afterEach(() => vi.useRealTimers());
it('não oferece ações de retorno quando não configurado', () => {
  expect(buildAgentTools({ ...agent, tools: { calculator: false } }).agendar_retorno).toBeUndefined();
});
it('grava somente RPC com contexto confiável, sem iniciar robô ou escolher outro destino', async () => {
  const rpc = vi.fn(async () => ({ data: 'return-id', error: null }));
  const runtime = scheduledReturnRuntime({ rpc } as never, 'org', 'conv', agent, 'anchor');
  const result = await runtime.schedule(input);
  expect(result).toMatchObject({ ok: true, scheduledAt: '2026-11-07T18:00:00.000Z' });
  expect(rpc).toHaveBeenCalledExactlyOnceWith('schedule_robot_return', expect.objectContaining({ p_org: 'org', p_conversation: 'conv', p_agent: 'agent', p_bot: 'configured-bot', p_anchor: 'anchor' }));
});
it('não confirma agendamento quando banco falha', async () => {
  const runtime = scheduledReturnRuntime({ rpc: async () => ({ data: null, error: { message: 'Conversa mudou' } }) } as never, 'org', 'conv', agent, null);
  const tools = buildAgentTools(agent, { scheduledReturn: runtime });
  const execute = tools.agendar_retorno.execute as (value: typeof input, options: unknown) => Promise<unknown>;
  expect(await execute(input, {})).toEqual({ ok: false, error: 'Conversa mudou' });
});
it('não confirma agendamento sem identificador persistido', async () => {
  const runtime = scheduledReturnRuntime({ rpc: async () => ({ data: null, error: null }) } as never, 'org', 'conv', agent, null);
  await expect(runtime.schedule(input)).rejects.toThrow('Retorno não foi salvo');
});
it('rejeita horário não confirmado antes de consultar o banco', async () => {
  const rpc = vi.fn();
  const runtime = scheduledReturnRuntime({ rpc } as never, 'org', 'conv', agent, null);
  await expect(runtime.schedule({ ...input, confirmed: false } as never)).rejects.toThrow();
  expect(rpc).not.toHaveBeenCalled();
});
it('cancela sob a mesma reserva transacional com o contexto confiável', async () => {
  const rpc = vi.fn(async () => ({ data: 1, error: null }));
  const runtime = scheduledReturnRuntime({ rpc } as never, 'org', 'conv', agent, 'anchor');
  expect(await runtime.cancel()).toEqual({ ok: true, cancelled: 1 });
  expect(rpc).toHaveBeenCalledExactlyOnceWith('cancel_scheduled_robot_return', {
    p_org: 'org', p_conversation: 'conv', p_agent: 'agent', p_anchor: 'anchor',
  });
});
it('não confirma cancelamento quando o banco detecta mudança na conversa', async () => {
  const runtime = scheduledReturnRuntime({ rpc: async () => ({ data: null, error: { message: 'Conversa mudou' } }) } as never, 'org', 'conv', agent, null);
  const tools = buildAgentTools(agent, { scheduledReturn: runtime });
  const execute = tools.cancelar_retorno.execute as (value: object, options: unknown) => Promise<unknown>;
  expect(await execute({}, {})).toEqual({ ok: false, error: 'Conversa mudou' });
});
it('consulta e cancelamento usam callbacks do simulador sem banco', async () => {
  const inspect = vi.fn(async () => ({ simulated: true })); const cancel = vi.fn(async () => ({ simulated: true }));
  const tools = buildAgentTools(agent, { scheduledReturn: { inspect, cancel, schedule: vi.fn() } });
  await (tools.consultar_retorno.execute as (input: object, options: object) => Promise<unknown>)({}, {});
  await (tools.cancelar_retorno.execute as (input: object, options: object) => Promise<unknown>)({}, {});
  expect(inspect).toHaveBeenCalledOnce(); expect(cancel).toHaveBeenCalledOnce();
});
