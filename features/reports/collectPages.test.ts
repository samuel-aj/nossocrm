import { describe, expect, it } from 'vitest';
import { collectPages } from './collectPages';

describe('paginação completa do relatório', () => {
  it('continua após páginas menores que o tamanho solicitado pelo cliente', async () => {
    const rows = Array.from({ length: 1205 }, (_, i) => i);
    const calls: number[] = [];
    const result = await collectPages<number>(async from => {
      calls.push(from);
      return { data: rows.slice(from, from + 400), error: null };
    });
    expect(result).toEqual(rows);
    expect(calls).toEqual([0, 400, 800, 1200, 1205]);
  });
  it('não devolve resultados parciais se uma página falhar', async () => {
    await expect(collectPages<number>(async from => from === 0
      ? { data: [1], error: null } : { data: null, error: { message: 'Falha de acesso' } })).rejects.toThrow('Falha de acesso');
  });
});
