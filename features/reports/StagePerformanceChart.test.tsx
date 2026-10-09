import React from 'react';
import { expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StageConversionChart } from './StagePerformanceChart';

it('mantém nome completo, quantidade e explicação acessível no mesmo controle', async () => {
  const user = userEvent.setup();
  const name = 'Reunião de apresentação e avaliação detalhada da proposta comercial';
  render(<StageConversionChart data={[
    { stageId: 'long', name, count: 137, fill: '#a855f7', conversionRate: 67.5, comparisonBase: '137 de 203 leads', conversionLabel: 'chegaram a esta etapa' },
    { stageId: 'empty', name: 'Contrato em análise', count: 0, fill: '#22c55e' },
  ]} onStageClick={vi.fn()} />);
  const bar = screen.getByRole('button', { name: `Ver 137 leads em ${name}` });
  expect(within(bar).getByText(name)).toBeVisible();
  expect(within(bar).getByText('137', { exact: true })).toBeVisible();
  expect(bar).toHaveAccessibleDescription('67,5% · chegaram a esta etapa · 137 de 203 leads');
  await user.tab();
  expect(await screen.findByRole('tooltip')).toHaveTextContent('67,5% · chegaram a esta etapa · 137 de 203 leads');
  expect(within(screen.getByRole('button', { name: 'Ver 0 leads em Contrato em análise' })).getByText('0')).toBeVisible();
});

it('abre a etapa correta por clique e ativação nativa de teclado, uma vez por gesto', async () => {
  const user = userEvent.setup();
  const onStageClick = vi.fn();
  render(<StageConversionChart data={[{ stageId: 'q', name: 'Qualificado', count: 13, fill: '#a855f7' }]} onStageClick={onStageClick} />);
  const bar = screen.getByRole('button', { name: 'Ver 13 leads em Qualificado' });
  await user.click(bar);
  await user.keyboard('{Enter}');
  await user.keyboard(' ');
  expect(onStageClick.mock.calls).toEqual([['q'], ['q'], ['q']]);
});

it('explica ausência de etapas e não oferece ação sem callback', () => {
  const { rerender } = render(<StageConversionChart data={[]} />);
  expect(screen.getByText('Nenhuma etapa disponível para esta visão.')).toBeVisible();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  rerender(<StageConversionChart data={[{ stageId: 'q', name: 'Qualificado', count: 13, fill: '#a855f7' }]} />);
  expect(screen.getByRole('button', { name: 'Ver 13 leads em Qualificado' })).toBeDisabled();
});

it('identifica a contagem acumulada no controle acessível sem afirmar presença literal na etapa', () => {
  render(<StageConversionChart description="Mesmos leads que entraram no período" data={[
    { stageId: 'q', name: 'Qualificado', count: 12, fill: '#a855f7', countingMethod: 'reached_or_beyond', populationLabel: 'Nesta etapa ou em uma posterior' },
  ]} onStageClick={vi.fn()} />);
  expect(screen.getByText('Mesmos leads que entraram no período')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Ver 12 leads em Qualificado ou além' })).toHaveAccessibleDescription('Nesta etapa ou em uma posterior');
});
