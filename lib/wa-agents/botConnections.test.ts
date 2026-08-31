import { describe, expect, it } from 'vitest';
import { botConnectionIds } from './bots';

/**
 * O robô é exclusivo dos números escolhidos nele. Antes o envio saía pelo número
 * da CONVERSA — um robô configurado para o número oficial acabava falando pelo
 * número do QR.
 */
describe('botConnectionIds', () => {
  it('usa a lista quando ela existe', () => {
    expect(botConnectionIds({ connection_ids: ['a', 'b'], connection_id: 'c' })).toEqual(['a', 'b']);
  });

  it('cai no número antigo quando a lista está vazia (robôs de antes da mudança)', () => {
    expect(botConnectionIds({ connection_ids: [], connection_id: 'c' })).toEqual(['c']);
  });

  it('robô sem número nenhum devolve lista vazia', () => {
    expect(botConnectionIds({ connection_ids: [], connection_id: null })).toEqual([]);
    expect(botConnectionIds({ connection_ids: null as unknown as string[], connection_id: null })).toEqual([]);
  });

  it('ignora buracos na lista', () => {
    expect(botConnectionIds({ connection_ids: ['', 'a'] as string[], connection_id: null })).toEqual(['a']);
  });
});
