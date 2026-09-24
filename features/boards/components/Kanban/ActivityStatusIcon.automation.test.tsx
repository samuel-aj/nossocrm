import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { BoardAutomationsContext } from '../../hooks/useBoardAutomations';
import { ActivityStatusIcon } from './ActivityStatusIcon';
import type { DealAutomation } from '@/lib/boards/automationState';
const props = { status: { kind: 'overdue' as const, daysFromToday: -5, daysOverdue: 5 }, dealId: 'lead', isOpen: false, onToggle: vi.fn(), onOpenSchedule: vi.fn() };
afterEach(cleanup);
function view(value: DealAutomation | null) { return <BoardAutomationsContext.Provider value={{ data: { lead: value }, loading: false, error: false }}><ActivityStatusIcon {...props} /></BoardAutomationsContext.Provider>; }
it.each(['bot', 'ai'] as const)('shows only %s, with no overdue warning or badge, then restores tasks', kind => {
  const { rerender } = render(view({ kind, name: 'Teste', state: kind === 'bot' ? 'waiting_reply' : 'active' }));
  expect(screen.getByRole('img', { name: kind === 'bot' ? 'Robô aguardando resposta: Teste' : 'IA ativa: Teste' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /atrasada/i })).not.toBeInTheDocument();
  expect(screen.queryByText('5d')).not.toBeInTheDocument();
  rerender(view(null));
  expect(screen.getByRole('button', { name: /atrasada há 5 dias/ })).toBeInTheDocument();
  expect(screen.getByText('5d')).toBeInTheDocument();
});
it('does not show task warning when automation lookup failed', () => {
  render(<BoardAutomationsContext.Provider value={{ data: {}, loading: false, error: true }}><ActivityStatusIcon {...props} /></BoardAutomationsContext.Provider>);
  expect(screen.getByRole('img', { name: 'Estado da automação indisponível' })).toBeInTheDocument();
  expect(screen.queryByText('5d')).not.toBeInTheDocument();
});
