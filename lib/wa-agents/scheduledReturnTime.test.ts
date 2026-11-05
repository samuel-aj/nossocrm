import { describe, expect, it } from 'vitest';
import { resolveReturnTime } from './scheduledReturnTime';
const now = new Date('2026-10-31T12:00:00Z');
const input = { local: '2026-11-07T14:00', timezone: 'America/Manaus', context: 'Cliente pediu retorno', confirmed: true as const };
describe('horário de retorno combinado', () => {
  it('converte sábado às14h em Manaus sem aplicar calendário', () => expect(resolveReturnTime(input, now)).toBe('2026-11-07T18:00:00.000Z'));
  it('não usa o fuso do servidor', () => expect(resolveReturnTime({ ...input, timezone: 'America/Sao_Paulo' }, now)).toBe('2026-11-07T17:00:00.000Z'));
  it('rejeita horário ambíguo no fim do horário de verão', () => expect(() => resolveReturnTime({ ...input, local: '2026-11-01T01:30', timezone: 'America/New_York' }, now)).toThrow('ambíguo'));
  it('rejeita horário inexistente no início do horário de verão', () => expect(() => resolveReturnTime({ ...input, local: '2026-03-08T02:30', timezone: 'America/New_York' }, new Date('2026-03-01'))).toThrow('inexistente'));
  it.each(['2026-10-30T14:00','2027-05-01T14:00','2026-11-31T14:00'])('rejeita data inválida ou fora do intervalo %s', local => expect(() => resolveReturnTime({ ...input, local }, now)).toThrow());
  it('exige confirmação explícita', () => expect(() => resolveReturnTime({ ...input, confirmed: false } as never, now)).toThrow());
});
