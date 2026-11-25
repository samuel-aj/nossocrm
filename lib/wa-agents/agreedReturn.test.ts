import type { ModelMessage } from 'ai';
import { describe, expect, it, vi } from 'vitest';
import { bookExplicitReturn, guardReturnPromises, RETURN_UNCONFIRMED } from './agreedReturn';
import type { ReplySegment } from './replyOutput';
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
const booked = (scheduledAt: string, timezone: string) => [{ tool: 'agendar_retorno', input: {}, output: { ok: true, id: 'return-id', scheduledAt, timezone } }];

describe('retorno combinado com o cliente', () => {
  it.each([
    [[user('Pode me chamar às 20h?')], '2026-11-22T20:00', 'Combinado! Te chamo hoje (22/11) às 20h.'],
    [[user('Me chama daqui a 13 horas')], '2026-11-23T03:00', 'Combinado! Te chamo amanhã (23/11) às 3h.'],
    [[user('Me chama daqui a 50 horas')], '2026-11-24T16:00', 'Combinado! Te chamo dia 24/11 às 16h.'],
    [[assistant('Posso te chamar amanhã às 20h?'), user('Pode sim!')], '2026-11-23T20:00', 'Combinado! Te chamo amanhã (23/11) às 20h.'],
    [[assistant('Que horas posso falar com você?'), user('Às 20h30')], '2026-11-22T20:30', 'Combinado! Te chamo hoje (22/11) às 20h30.'],
  ] as const)('reserva antes de prometer, com o fuso do escritório', async (messages, local, text) => {
    const runtime = fakeReturn();
    const result = await bookExplicitReturn([...messages], runtime);
    expect(runtime.inspect).toHaveBeenCalledOnce();
    expect(runtime.schedule).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ confirmed: true, timezone: 'America/Manaus', local }));
    expect(result?.calls.map(c => c.tool)).toEqual(['consultar_retorno', 'agendar_retorno']);
    expect(result?.text).toBe(text);
    expect(result?.text).not.toContain('GMT');
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
    const result = guardReturnPromises([{ kind: 'text', text: 'Vou te chamar às 21h.' }], [{ tool: 'consultar_retorno', input: {}, output: { pending } }], true, [], now);
    expect(result).toEqual([{ kind: 'text', text: 'Combinado! Te chamo hoje (22/11) às 20h.' }]);
  });
  it.each([
    // now, reservation, its time zone, sentence.
    // "hoje" and "amanhã" carry the date: a line held while the number is offline may be delivered on another day.
    ['2026-11-25T12:00:00Z', '2026-11-25T18:00:00Z', 'America/Sao_Paulo', 'Combinado! Te chamo hoje (25/11) às 15h.'],
    ['2026-11-24T20:00:00Z', '2026-11-25T12:00:00Z', 'America/Sao_Paulo', 'Combinado! Te chamo amanhã (25/11) às 9h.'],
    ['2026-11-24T20:00:00Z', '2026-11-27T12:00:00Z', 'America/Sao_Paulo', 'Combinado! Te chamo dia 27/11 às 9h.'],
    // A day already past is just another day, never "hoje".
    ['2026-11-25T12:00:00Z', '2026-11-24T12:00:00Z', 'America/Sao_Paulo', 'Combinado! Te chamo dia 24/11 às 9h.'],
    // Minutes only when they are not 00, never seconds. "à" before 0h and 1h, "às" from 2h on.
    ['2026-11-24T20:00:00Z', '2026-11-25T12:30:00Z', 'America/Sao_Paulo', 'Combinado! Te chamo amanhã (25/11) às 9h30.'],
    ['2026-11-24T20:00:00Z', '2026-11-27T17:05:59Z', 'America/Sao_Paulo', 'Combinado! Te chamo dia 27/11 às 14h05.'],
    ['2026-11-25T12:00:00Z', '2026-11-26T03:00:00Z', 'America/Sao_Paulo', 'Combinado! Te chamo amanhã (26/11) à 0h.'],
    ['2026-11-25T12:00:00Z', '2026-11-26T05:00:00Z', 'America/Sao_Paulo', 'Combinado! Te chamo amanhã (26/11) às 2h.'],
    // The year appears only when it differs. In São Paulo, 2027-01-01T01:00Z is still 31/12/2026.
    ['2026-12-28T15:00:00Z', '2027-01-05T12:00:00Z', 'America/Sao_Paulo', 'Combinado! Te chamo dia 05/01/2027 às 9h.'],
    ['2026-12-28T15:00:00Z', '2027-01-01T01:00:00Z', 'America/Sao_Paulo', 'Combinado! Te chamo dia 31/12 às 22h.'],
    ['2027-01-01T01:00:00Z', '2027-01-04T12:00:00Z', 'America/Sao_Paulo', 'Combinado! Te chamo dia 04/01/2027 às 9h.'],
    ['2026-12-31T15:00:00Z', '2027-01-01T12:00:00Z', 'America/Sao_Paulo', 'Combinado! Te chamo amanhã (01/01) às 9h.'],
    // The day turns in the reservation's time zone, not in UTC or in São Paulo.
    ['2026-11-25T03:30:00Z', '2026-11-25T13:00:00Z', 'America/Manaus', 'Combinado! Te chamo amanhã (25/11) às 9h.'],
    ['2026-11-25T20:00:00Z', '2026-11-26T01:00:00Z', 'America/Manaus', 'Combinado! Te chamo hoje (25/11) às 21h.'],
    ['2026-11-25T14:00:00Z', '2026-11-25T16:30:00Z', 'Asia/Tokyo', 'Combinado! Te chamo amanhã (26/11) à 1h30.'],
  ])('diz o dia e a hora no fuso da reserva, sem ano corrente nem fuso (agora %s, reserva %s, %s)', (clock, scheduledAt, timezone, text) => {
    const result = guardReturnPromises([{ kind: 'text', text: 'Te chamo depois.' }], booked(scheduledAt, timezone), true, [], clock);
    expect(result).toEqual([{ kind: 'text', text }]);
    expect(JSON.stringify(result)).not.toContain('GMT');
  });
  it('usa o relógio do sistema quando o agora não é informado', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-24T20:00:00Z'));
    try {
      const result = guardReturnPromises([{ kind: 'text', text: 'Te chamo depois.' }], booked('2026-11-25T12:00:00Z', 'America/Sao_Paulo'), true);
      expect(result).toEqual([{ kind: 'text', text: 'Combinado! Te chamo amanhã (25/11) às 9h.' }]);
    } finally { vi.useRealTimers(); }
  });
  // A return booked for 25/11 at 9h in São Paulo, confirmed on the eve.
  const guardBooked = (segments: ReplySegment[], messages: ModelMessage[] = []) =>
    guardReturnPromises(segments, booked('2026-11-25T12:00:00Z', 'America/Sao_Paulo'), true, messages, '2026-11-24T20:00:00Z');
  it('não repete o combinado que o modelo já escreveu, em texto ou legenda', () => {
    const reply = 'Combinado, Fulano! Te chamo amanhã às 9h.';
    const kept = { kind: 'text', text: 'Combinado, Fulano!' };
    const said = { kind: 'text', text: 'Te chamo amanhã (25/11) às 9h.' };
    expect(guardBooked([{ kind: 'text', text: reply }])).toEqual([kept, said]);
    expect(guardBooked([{ kind: 'text', text: reply }], [user('Me chama amanhã de manhã')])).toEqual([kept, said]);
    expect(guardBooked([{ kind: 'text', text: 'Combinado, Fulano!' }, { kind: 'text', text: 'Vou te chamar amanhã às 9h.' }])).toEqual([kept, said]);
    expect(guardBooked([{ kind: 'media', name: 'Guia', caption: reply }])).toEqual([{ kind: 'media', name: 'Guia', caption: 'Combinado, Fulano!' }, said]);
  });
  it.each(['Tá combinado, Fulano!', 'Perfeito, Fulano, combinado!', 'Combinadíssimo, Fulano!', '*Combinado*, Fulano!', '👍 Combinado!'])('não repete o combinado que não abre a frase do modelo (%s)', opening => {
    const reply = opening + ' Te chamo amanhã às 9h.';
    const said = { kind: 'text', text: 'Te chamo amanhã (25/11) às 9h.' };
    expect(guardBooked([{ kind: 'text', text: reply }])).toEqual([{ kind: 'text', text: opening }, said]);
    expect(guardBooked([{ kind: 'media', name: 'Guia', caption: reply }])).toEqual([{ kind: 'media', name: 'Guia', caption: opening }, said]);
  });
  it('mantém o combinado da reserva quando o modelo não o escreveu ou ele foi removido', () => {
    const said = { kind: 'text', text: 'Combinado! Te chamo amanhã (25/11) às 9h.' };
    expect(guardBooked([{ kind: 'text', text: 'Perfeito, Fulano! Te chamo amanhã às 9h.' }])).toEqual([{ kind: 'text', text: 'Perfeito, Fulano!' }, said]);
    expect(guardBooked([{ kind: 'text', text: 'Combinado! Te chamo amanhã às 9h.' }], [user('Me chama amanhã de manhã')])).toEqual([said]);
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
