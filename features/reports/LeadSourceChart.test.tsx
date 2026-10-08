import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { LeadSourceChart } from './LeadSourceChart';
import { groupLeadSources } from './leadSourceReport';
import { lead } from './performanceTestFixtures';

it('mostra quantidade/percentual acessíveis e abre os mesmos leads por legenda e teclado', async () => {
  const groups = groupLeadSources([lead('a', { leadSource: 'Meta Ads' }), lead('b', { leadSource: null })]);
  const onSelect = vi.fn();
  render(<LeadSourceChart groups={groups} total={2} mode="cohort" legacySnapshotCount={1} onSelect={onSelect} />);
  expect(screen.getByRole('group', { name: 'Distribuição de 2 leads por origem' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Detalhar Meta Ads: 1 lead, 50,0%' }));
  expect(onSelect).toHaveBeenLastCalledWith(['source:meta ads']);
  fireEvent.keyDown(screen.getByRole('button', { name: 'Ver Não informado: 1 lead, 50,0%' }), { key: 'Enter' });
  expect(onSelect).toHaveBeenLastCalledWith(['not_informed']);
  fireEvent.keyDown(screen.getByRole('button', { name: 'Ver Meta Ads: 1 lead, 50,0%' }), { key: ' ' });
  expect(onSelect).toHaveBeenLastCalledWith(['source:meta ads']);
  fireEvent.click(screen.getByRole('button', { name: 'Ver todas as origens' }));
  expect(onSelect).toHaveBeenLastCalledWith();
  expect(screen.getByText(/1 lead tem origem histórica reconstruída/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Sobre a origem dos leads' }));
  const information = await screen.findByRole('dialog');
  expect(within(information).getByText(/Leads criados no período e registrados neste funil/)).toBeInTheDocument();
  expect(within(information).getByText(/Ela não comprova a origem na data histórica/)).toBeInTheDocument();
});
it('exibe estado vazio sem fatias nem percentuais artificiais', () => {
  render(<LeadSourceChart groups={[]} total={0} mode="current" legacySnapshotCount={0} onSelect={vi.fn()} />);
  expect(screen.getByText('Nenhum lead nesta base para distribuir por origem.')).toBeInTheDocument();
  expect(screen.queryByRole('group', { name: /Distribuição/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Ver todas as origens' })).not.toBeInTheDocument();
});
