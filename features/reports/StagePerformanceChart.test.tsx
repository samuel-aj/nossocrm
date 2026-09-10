import React from 'react';
import { expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { StageConversionChart } from './StagePerformanceChart';

vi.mock('recharts', async importOriginal => {
  const actual = await importOriginal<typeof import('recharts')>();
  return { ...actual, ResponsiveContainer: ({ children }: { children: React.ReactElement }) =>
    React.cloneElement(children as React.ReactElement<{ width: number; height: number }>, { width: 800, height: 300 }) };
});

it('abre a etapa correta por clique e teclado nas barras reais', async () => {
  const onStageClick = vi.fn();
  render(<StageConversionChart data={[{ stageId: 'q', name: 'Qualificado', count: 13, fill: '#a855f7' }]} onStageClick={onStageClick} />);
  const bar = await screen.findByRole('button', { name: 'Ver 13 leads em Qualificado' }, { timeout: 5000 });
  fireEvent.click(bar);
  expect(onStageClick).toHaveBeenLastCalledWith('q');
  fireEvent.keyDown(bar, { key: 'Enter' });
  expect(onStageClick).toHaveBeenCalledTimes(2);
  fireEvent.keyDown(bar, { key: ' ' });
  expect(onStageClick).toHaveBeenCalledTimes(3);
});
