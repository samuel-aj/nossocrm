import React from 'react';
import { expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ReportLeadsModal } from './ReportLeadsModal';
import { reportDrilldown } from './reportDrilldown';
import { monthlyPresentationFixture } from './monthlyPresentationTestFixture';

it('reconcilia a taxa com todos os contratos e conserva fechamento conhecido sem data MQL', () => {
  const metrics = monthlyPresentationFixture();
  render(<ReportLeadsModal detail={reportDrilldown(metrics, { kind: 'closing' })} board={metrics.board}
    filtersLabel="Agosto · filtros atuais" qualificationDates={metrics.leadQualificationDates}
    estimatedQualificationIds={metrics.estimatedQualificationIds} onClose={() => {}} />);
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).getAllByRole('link')).toHaveLength(4);
  expect(within(dialog).getByText(/Total do período: 7 ganhos, incluindo 3 fora da base/)).toBeVisible();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Ganhos do período (7)' }));
  expect(within(dialog).getAllByRole('link')).toHaveLength(7);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Ganhos fora da base de entradas (3)' }));
  expect(within(dialog).getAllByRole('link')).toHaveLength(3);
  expect(within(dialog).getByText(/Estar fora da base não significa ausência de qualificação/)).toBeVisible();
  const qualifiedOutside = within(dialog).getByRole('link', { name: /Contrato 5/ }).closest('tr')!;
  expect(within(qualifiedOutside).getByRole('cell', { name: 'Sem data registrada' })).toBeVisible();
  expect(within(dialog).queryByRole('columnheader', { name: 'Prova da qualificação' })).not.toBeInTheDocument();
  expect(within(qualifiedOutside).queryByText('Não qualificado')).not.toBeInTheDocument();
  const row = within(dialog).getByRole('link', { name: /Contrato 7/ }).closest('tr')!;
  expect(within(row).getByRole('cell', { name: 'Sem data registrada' })).toBeVisible();
  expect(within(row).getByRole('cell', { name: '11/08/2026' })).toBeVisible();
  expect(within(dialog).getByRole('columnheader', { name: 'Encerramento registrado' })).toBeVisible();
  expect(within(dialog).queryByRole('columnheader', { name: /Assinatura/ })).not.toBeInTheDocument();
});
