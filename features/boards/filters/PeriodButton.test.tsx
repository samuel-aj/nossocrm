import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PeriodButton } from './PeriodButton';
import { BoardFilterControls } from './useBoardFilters';
import { EMPTY_GENERAL, EMPTY_PERIOD } from './boardFilters';
function controls(): BoardFilterControls { return { general: EMPTY_GENERAL, period: EMPTY_PERIOD, saved: { general: null, period: null }, setGeneral: vi.fn(), setPeriod: vi.fn(), pin: vi.fn(), saving: false, ready: true, loading: false, loadError: false }; }
describe('period panel', () => {
  beforeEach(cleanup);
  it('pins the selected draft, including both dates with AND, without pinning general filters', () => {
    const c = controls(); render(<PeriodButton controls={c} />);
    fireEvent.click(screen.getByLabelText('Filtrar por período'));
    fireEvent.click(screen.getByText('Mês passado'));
    fireEvent.click(screen.getByLabelText('Encerramento'));
    expect(screen.getByRole('combobox')).toHaveValue('AND');
    fireEvent.click(screen.getByText('Fixar período'));
    expect(c.pin).toHaveBeenCalledWith({ period: { ...EMPTY_PERIOD, preset: 'lastMonth', closed: true } });
    expect(c.setPeriod).toHaveBeenCalledWith({ ...EMPTY_PERIOD, preset: 'lastMonth', closed: true });
  });
  it('rejects incomplete custom dates and no selected date fields', () => {
    const c = controls(); render(<PeriodButton controls={c} />);
    fireEvent.click(screen.getByLabelText('Filtrar por período'));
    fireEvent.click(screen.getByText('Personalizado'));
    fireEvent.click(screen.getByText('Fixar período'));
    expect(screen.getByRole('alert')).toHaveTextContent('intervalo válido');
    expect(c.pin).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Hoje'));
    fireEvent.click(screen.getByLabelText('Criação'));
    fireEvent.click(screen.getByText('Aplicar período'));
    expect(screen.getByRole('alert')).toHaveTextContent('Selecione pelo menos uma data');
    expect(c.setPeriod).not.toHaveBeenCalled();
  });
  it('removes only the period default', () => {
    const c = controls(); c.saved = { general: EMPTY_GENERAL, period: EMPTY_PERIOD };
    render(<PeriodButton controls={c} />);
    fireEvent.click(screen.getByLabelText('Filtrar por período'));
    fireEvent.click(screen.getByText('Desafixar'));
    expect(c.pin).toHaveBeenCalledWith({ period: null });
  });
});
