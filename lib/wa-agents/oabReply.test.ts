import { describe, expect, it } from 'vitest';
import { protectOabReply } from './oabReply';
import type { ConfirmedOabRegistration } from './oabRegistry';
import type { ReplySegment } from './replyOutput';

const ana: ConfirmedOabRegistration = { professionalName: 'Ana Exemplo', state: 'MS', number: '12345' };
const bruno: ConfirmedOabRegistration = { professionalName: 'Bruno Exemplo', state: 'SP', number: '7123A' };
const draft = (text: string): ReplySegment => ({ kind: 'text', text });
const textOf = (segments: ReplySegment[]) => segments.map(s => s.kind === 'text' ? s.text : s.caption).join('\n');

describe('respostas sobre a inscrição profissional', () => {
  it.each([
    ['', 'A O.A.B. é 99.999'],
    ['Qual é a inscrição da advogada?', 'noventa e nove mil'],
    ['O número da OAB é 99999?', 'Isso mesmo!'],
    ['Confirma a OAB 99999?', 'É esse!'],
    ['', 'Minha inscrição profissional é 99999.'],
    ['', 'Sou a Dra. Ana, inscrita sob o número 99999.'],
  ])('evita divulgar ou confirmar inscrição sem cadastro', (question, response) => {
    const result = protectOabReply([draft(response)], [], question);
    expect(result.adjusted).toBe(true);
    expect(textOf(result.segments)).toContain('confirmar a inscrição');
  });
  it.each([
    ['A Ana tem OAB?', 'OAB/SP 7123A', [bruno]],
    ['Qual a OAB da Dra. Beatriz?', 'OAB/SP 7123A', [bruno]],
    ['Qual a OAB?', 'OAB/MS 12345', [ana, bruno]],
    ['Qual a OAB da Ana Exemplo?', 'OAB/SP 12345', [ana, bruno]],
    ['Qual a OAB da Dra. Ana?', 'OAB/MS 12345', [ana, { ...ana, professionalName: 'Ana Teste', number: '12346' }]],
  ] as const)('não atribui a inscrição de outra pessoa ou UF', (question, response, records) => {
    const output = textOf(protectOabReply([draft(response)], records, question).segments);
    expect(output).not.toMatch(/\d/);
  });
  it('trata a legenda e a fala antes do envio, preservando o telefone de contato', () => {
    const guarded = protectOabReply([
      { kind: 'media', name: 'oab_advogada', caption: 'OAB/SP 77777' },
      { kind: 'text', text: '77777', voice: true },
      draft('Telefone: (11) 90000-1111'),
    ], [bruno], 'Qual a OAB do Bruno Exemplo?');
    expect(guarded.segments[0]).toMatchObject({ kind: 'media', caption: expect.stringContaining('OAB/SP 7123A') });
    expect(textOf(guarded.segments)).not.toContain('77777');
    expect(textOf(guarded.segments)).toContain('Telefone: (11) 90000-1111');
  });
  it('deixa as demais respostas da conversa como foram escritas', () => {
    const normal = [draft('O retorno está marcado para as 15h30.')];
    expect(protectOabReply(normal, [])).toEqual({ adjusted: false, segments: normal });
  });
  it('preserva o link de assinatura na mesma linha de uma alegação não confirmada', () => {
    const original = 'Minha OAB é 99999. Você pode assinar em https://example.test/assinatura/123.';
    const result = textOf(protectOabReply([draft(original)], []).segments);
    expect(result).toContain('Você pode assinar em https://example.test/assinatura/123.');
    expect(result).not.toContain('99999');
  });
});
