import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import ReportsPage from './ReportsPage';

const state = vi.hoisted(() => ({ data: null as any, error: null as any, isError: false, isFetching: false, pdf: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next/image', () => ({ default: () => null }));
vi.mock('@/context/CRMContext', () => ({ useCRM: () => ({ boards: [{ id: 'board', name: 'Teste', isDefault: true, stages: [{ id: 'q', label: 'Qualificado' }] }], deals: [] }) }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ profile: { first_name: 'Teste' } }) }));
vi.mock('./usePerformanceReport', () => ({ usePerformanceReport: () => ({ ...state, refetch: vi.fn() }) }));
vi.mock('@/components/charts', () => ({ ChartWrapper: ({ children }: any) => <div>{children}</div>, LazyStageConversionChart: ({ data }: any) => <div>{JSON.stringify(data)}</div> }));
vi.mock('@/features/dashboard/hooks/useDashboardMetrics', () => ({ getDateRange: () => ({ start: new Date('2026-08-01'), end: new Date('2026-08-31') }), PERIOD_LABELS: { this_month: 'Este mês' }, COMPARISON_LABELS: { this_month: 'vs mês passado' } }));
vi.mock('./utils/generateReportPDF', () => ({ generateReportPDF: (...args: any[]) => state.pdf(...args) }));

describe('tela Performance', () => {
  beforeEach(() => { state.data = null; state.isError = false; state.error = null; state.isFetching = false; state.pdf.mockClear(); });
  it('não apresenta zeros como resultado durante carregamento', () => {
    render(<ReportsPage />);
    expect(screen.getByRole('status')).toHaveTextContent('Carregando');
    expect(screen.queryByText('Taxa de Qualificação')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'PDF' })).toBeDisabled();
  });
  it('explica falhas e impede exportar resultados antigos', () => {
    state.isError = true; state.error = new Error('Falha de acesso');
    render(<ReportsPage />);
    expect(screen.getByRole('alert')).toHaveTextContent('Falha de acesso');
    expect(screen.getByRole('button', { name: 'PDF' })).toBeDisabled();
  });
  it('separa perdas desqualificadas dos encerramentos qualificados', () => {
    state.data = { entries: [], qualifiedCount: 40, qualificationRate: 80, closingRate: 37.5,
      hasQualifiedStage: true, wonDeals: Array.from({length:15}, (_, i) => ({ id: String(i), value: 100, owner: { name: 'Samuel' } })),
      lostDeals: [...Array(10).fill({ lossCategory: 'qualified' }), ...Array(5).fill({ lossCategory: 'disqualified' })],
      wonRevenue: 1500, revenueChange: -31.6, fastestSalesCycle: 3, slowestSalesCycle: 50, avgSalesCycle: 18, stageData: [], unknownQualification: [], unknownClosure: [],
      webhookUnavailable: false, deals: [], qualifiedIds: new Set() };
    render(<ReportsPage />);
    const card = screen.getByText('Fechamentos').parentElement!.parentElement!;
    expect(within(card).getByText('15')).toBeInTheDocument();
    expect(within(card).getByText('10')).toBeInTheDocument();
    expect(screen.getByText('Faturamento fechado')).toBeInTheDocument();
    expect(screen.getByText('-31,6% vs mês passado')).toBeInTheDocument();
    expect(screen.getByText('Rápido: 3d | Lento: 50d')).toBeInTheDocument();
    expect(screen.queryByText('Receita ganha no período')).not.toBeInTheDocument();
    expect(screen.queryByText(/Conferir qualificados no período/)).not.toBeInTheDocument();
    expect(within(card).getByText('Ganhos / Perdas qualificadas')).toBeInTheDocument();
  });
  it('mostra a taxa acima de 100% e exporta exatamente os mesmos dados', () => {
    state.data = { entries: Array(10).fill({}), qualifiedCount: 12, qualificationRate: 120, closingRate: 25,
      hasQualifiedStage: true, wonDeals: [], lostDeals: [], wonRevenue: 0, avgSalesCycle: null,
      stageData: [{ name: 'Qualificado', count: 12 }], unknownQualification: [], unknownClosure: [],
      webhookUnavailable: false, deals: [], qualifiedIds: new Set() };
    render(<ReportsPage />);
    expect(screen.getByText('120,0%')).toBeInTheDocument();
    expect(screen.getByText('25,0%')).toBeInTheDocument();
    expect(screen.getByText('12 qualificados de 10 leads')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'PDF' }));
    expect(state.pdf).toHaveBeenCalledWith(state.data, expect.objectContaining({ boardName: 'Teste', owner: 'Todos os vendedores' }));
  });
});
