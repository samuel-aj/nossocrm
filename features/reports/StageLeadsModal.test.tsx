import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { StageLeadsModal } from './StageLeadsModal';
import { calculatePerformance } from './performanceMetrics';
import type { Board, Deal } from '@/types';

const board = { id: 'b', stages: [{ id: 'q', label: 'Qualificado', color: '' }] } as Board;
const range = { start: new Date('2026-08-01'), end: new Date('2026-08-31T23:59:59Z') };
it('mostra as quatro colunas, datas reais, vazios e permite fechar', () => {
  const leads = [
    { id: 'a', title: 'Ana', boardId: 'b', status: 'q', createdAt: '2026-08-02T12:00:00Z', closedAt: '2026-08-20T12:00:00Z' },
    { id: 'b', title: 'Bruno', boardId: 'b', status: 'q', createdAt: '2026-08-03T12:00:00Z' },
  ] as Deal[];
  const stage = calculatePerformance(leads, [], board, range).stageData[0];
  const onClose = vi.fn();
  render(<StageLeadsModal stage={stage} qualificationDates={new Map([['a', '2026-08-10T12:00:00Z']])} onClose={onClose} />);
  const dialog = screen.getByRole('dialog', { name: 'Qualificado · 2 leads' });
  expect(within(dialog).getAllByRole('columnheader').map(cell => cell.textContent)).toEqual(['Nome do lead', 'Criação', 'Qualificação', 'Encerramento']);
  expect(within(screen.getByText('Ana').closest('tr')!).getAllByRole('cell').map(cell => cell.textContent)).toEqual(['Ana (abrir lead em nova aba)', '02/08/2026', '10/08/2026', '20/08/2026']);
  expect(within(screen.getByText('Bruno').closest('tr')!).getAllByRole('cell').map(cell => cell.textContent)).toEqual(['Bruno (abrir lead em nova aba)', '03/08/2026', '', '']);
  const link = screen.getByRole('link', { name: 'Ana (abrir lead em nova aba)' });
  expect(link).toHaveAttribute('href', '/boards?deal=a');
  expect(link).toHaveAttribute('target', '_blank');
  expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  fireEvent.click(screen.getByRole('button', { name: 'Fechar modal' }));
  expect(onClose).toHaveBeenCalledOnce();
});
