import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { SplitEditor } from './SplitEditor';
import { createBlock } from './serialize';
import type { BlockOfType } from './types';

it('lets an author add C and D, set percentages, rename routes and return to alternating distribution', async () => {
  let saved = createBlock('split') as BlockOfType<'split'>;
  function Harness() {
    const [block, setBlock] = useState(saved);
    return <SplitEditor block={block} update={next => { saved = next; setBlock(next); }} />;
  }
  render(<Harness />);
  const originalA = saved.data.branches[0].id;
  expect(screen.getByRole('button', { name: 'Remover saída 1' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Adicionar saída' }));
  fireEvent.click(screen.getByRole('button', { name: 'Adicionar saída' }));
  expect(saved.data.branches.map(branch => branch.label)).toEqual(['A', 'B', 'C', 'D']);
  fireEvent.keyDown(screen.getByRole('combobox', { name: 'Modo de distribuição' }), { key: 'ArrowDown' });
  fireEvent.click(await screen.findByRole('option', { name: 'Aleatório por porcentagem' }));
  expect(screen.getAllByRole('spinbutton')).toHaveLength(4);
  [40, 30, 20, 10].forEach((weight, i) => fireEvent.change(screen.getByRole('spinbutton', { name: `Porcentagem da saída ${i + 1}` }), { target: { value: String(weight) } }));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole('textbox', { name: 'Nome da saída 1' }), { target: { value: 'Mensagem curta' } });
  expect(saved.data.branches[0]).toEqual({ id: originalA, label: 'Mensagem curta', weight: 40 });
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Porcentagem da saída 1' }), { target: { value: '50' } });
  expect(screen.getByRole('alert')).toHaveTextContent('Total: 110%');
  fireEvent.click(screen.getByRole('button', { name: 'Dividir igualmente' }));
  expect(saved.data.branches.map(branch => branch.weight)).toEqual([25, 25, 25, 25]);
  fireEvent.click(screen.getByRole('button', { name: 'Remover saída 4' }));
  expect(saved.data.branches.map(branch => branch.weight)).toEqual([34, 33, 33]);
  fireEvent.keyDown(screen.getByRole('combobox', { name: 'Modo de distribuição' }), { key: 'ArrowDown' });
  fireEvent.click(await screen.findByRole('option', { name: 'Alternado (round robin)' }));
  expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
  expect(saved.data.branches[0].id).toBe(originalA);
});
