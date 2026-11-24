import { describe, expect, it } from 'vitest';
import { detailLines, eventLabel, severityLabel } from './eventLabels';

describe('rótulos do registro de segurança', () => {
  it('traduz eventos conhecidos e mantém o código dos desconhecidos', () => {
    expect(eventLabel('team.member.removed')).toBe('Membro removido');
    expect(eventLabel('auth.login_failed')).toBe('Senha recusada no login');
    expect(eventLabel('algo.novo')).toBe('algo.novo');
    expect(severityLabel('critical')).toBe('Crítico');
  });

  it('monta os detalhes em pares legíveis', () => {
    expect(
      detailLines({ segredo_trocado: true, events: ['a', 'b'], vazio: null, total: 3, obj: { a: 1 } }),
    ).toEqual([
      ['segredo trocado', 'sim'],
      ['events', 'a, b'],
      ['total', '3'],
      ['obj', '{"a":1}'],
    ]);
    expect(detailLines(null)).toEqual([]);
  });
});
