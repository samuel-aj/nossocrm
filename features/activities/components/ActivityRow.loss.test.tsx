import React from 'react';
import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ActivityRow } from './ActivityRow';
import type { Activity } from '@/types';
vi.mock('@/context/CRMContext', () => ({ useCRM: () => ({ boards: [] }) }));
it('exibe motivo e classificação gravados na Timeline, mesmo sem o lead atual', () => {
  const activity = { id: 'loss', type: 'STATUS_CHANGE', title: 'Moveu para Perdido', description: 'Classificação: Desqualificado\nMotivo da perda: Contato repetido', date: '2026-09-11', completed: true, user: { name: 'Samuel' } } as Activity;
  render(<ActivityRow activity={activity} onToggleComplete={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />);
  expect(screen.getByText(/Classificação: Desqualificado/)).toHaveTextContent('Contato repetido');
  expect(screen.queryByRole('button', { name: /Concluir|Reabrir/ })).not.toBeInTheDocument();
});
