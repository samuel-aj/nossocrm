import type { ModelMessage } from 'ai';
import { describe, expect, it, vi } from 'vitest';
import { bookExplicitReturn, guardReturnPromises, RETURN_UNCONFIRMED } from './agreedReturn';
import { resolveReturnTime } from './scheduledReturnTime';
import type { ReturnTimeInput } from './scheduledReturnTime';

const now = '2026-11-22T18:00:00.000Z';
const user = (content: string): ModelMessage => ({ role: 'user', content });
const assistant = (content: string): ModelMessage => ({ role: 'assistant', content });
function fakeReturn() {
  return {
    inspect: vi.fn(async () => ({ timezone: 'America/Manaus', now, pending: null })),
    schedule: vi.fn(async (args: ReturnTimeInput) => ({
      ok: true, id: 'return-id', timezone: args.timezone, scheduledAt: resolveReturnTime(args, new Date(now)),
    })),
    cancel: vi.fn(),
  };
}

describe('retorno combinado com o cliente', () => {
  it.each([
    [[user('Pode me chamar às 20h?')], '2026-11-22T20:00'],
    [[user('Me chama daqui a 13 horas')], '2026-11-23T03:00'],
    [[assistant('Posso te chamar amanhã às 20h?'), user('Pode sim!')], '2026-11-23T20:00'],
    [[assistant('Que horas posso falar com você?'), user('Às 20h30')], '2026-11-22T20:30'],
  ] as const)('reserva antes de prometer, com o fuso do escritório', async (messages, local) => {
    const runtime = fakeReturn();
    const result = await bookExplicitReturn([...messages], runtime);
    expect(runtime.inspect).toHaveBeenCalledOnce();
    expect(runtime.schedule).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ confirmed: true, timezone: 'America/Manaus', local }));
    expect(result?.calls.map(c => c.tool)).toEqual(['consultar_retorno', 'agendar_retorno']);
    expect(result?.text).toContain('Vou te chamar');
  });
  it.each([
    [user('Tenho consulta às 20h')],
    [user('Não me chama às 20h')],
    [user('Me chama às 20h ou às 21h')],
    [assistant('Que horas você prefere que eu não te chame?'), user('Às 20h')],
    [assistant('Posso te chamar amanhã às 20h? Ou às 21h?'), user('Sim')],
    [user('Estou no fuso de Lisboa.'), assistant('Entendi.'), user('Pode me chamar às 20h')],
    [user('Pode me chamar às 20h'), assistant('Entendi')],
  ])('deixa a interpretação com o agente quando não há um pedido inequívoco', async (...messages) => {
    const runtime = fakeReturn();
    expect(await bookExplicitReturn(messages, runtime)).toBeNull();
    expect(runtime.schedule).not.toHaveBeenCalled();
  });
  it('pergunta a data quando o horário de hoje já passou', async () => {
    const runtime = fakeReturn();
    const result = await bookExplicitReturn([user('Me chama às 10h')], runtime);
    expect(result?.text).toContain('Qual dia');
    expect(runtime.schedule).not.toHaveBeenCalled();
  });
  it('não confirma nem repete a reserva após falha do serviço', async () => {
    const runtime = fakeReturn();
    runtime.schedule.mockRejectedValue(new Error('Conversa indisponível'));
    const result = await bookExplicitReturn([user('Pode me chamar às 20h?')], runtime);
    expect(result?.text).toBe(RETURN_UNCONFIRMED);
    expect(runtime.schedule).toHaveBeenCalledOnce();
    expect(result?.calls[1].output).toMatchObject({ ok: false });
  });
  it.each(['Consigo te chamar às 20h.', 'Pode deixar que às 20h eu te chamo.', 'Seu retorno foi agendado.'])('bloqueia uma promessa sem reserva até em legendas', phrase => {
    const guarded = guardReturnPromises([{ kind: 'media', name: 'Guia', caption: 'Segue o guia. ' + phrase }], [], true);
    expect(guarded).toEqual([{ kind: 'media', name: 'Guia', caption: 'Segue o guia.' }, { kind: 'text', text: expect.stringContaining('Qual dia') }]);
    expect(guardReturnPromises([{ kind: 'text', text: phrase }], [], false)?.at(-1)).toMatchObject({ text: 'Você pode me chamar por aqui no horário que preferir.' });
  });
  it('responde com o horário da reserva consultada, mesmo que o modelo invente outro', () => {
    const pending = { id: 'existente', scheduled_for: '2026-11-23T00:00:00Z', scheduled_timezone: 'America/Manaus' };
    const result = guardReturnPromises([{ kind: 'text', text: 'Vou te chamar às 21h.' }], [{ tool: 'consultar_retorno', input: {}, output: { pending } }], true);
    expect(result).toEqual([{ kind: 'text', text: expect.stringContaining('20:00') }]);
  });
  it('não aceita um pedido de retorno com um simples combinado quando o robô está desligado', () => {
    const ack = [{ kind: 'text' as const, text: 'Combinado!' }];
    expect(guardReturnPromises(ack, [], false, [user('Pode me chamar às 20h?')])?.at(-1)).toMatchObject({ text: 'Você pode me chamar por aqui no horário que preferir.' });
    expect(guardReturnPromises(ack, [], false, [user('Me chama de Ana')])).toBeNull();
  });
  it('preserva perguntas e comunicados de erro e considera o cancelamento posterior', () => {
    expect(guardReturnPromises([{ kind: 'text', text: 'Posso te chamar às 20h? Não consegui agendar o retorno.' }], [], true)).toBeNull();
    const result = guardReturnPromises([{ kind: 'text', text: 'Te chamo amanhã.' }], [
      { tool: 'agendar_retorno', input: {}, output: { ok: true, id: 'antigo', scheduledAt: now, timezone: 'UTC' } },
      { tool: 'cancelar_retorno', input: {}, output: { ok: true, cancelled: 1 } },
    ], true);
    expect(result?.at(-1)).toMatchObject({ text: expect.stringContaining('Qual dia') });
  });
});
