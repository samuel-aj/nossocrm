import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import ReportsPage from './ReportsPage';
import { calculatePerformance } from './performanceMetrics';
import type { Board, Deal } from '@/types';

const state = vi.hoisted(() => ({ data: null as any, error: null as any, isError: false, isFetching: false, pdf: vi.fn(), query: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next/dynamic', () => ({ default: () => () => null }));
vi.mock('next/image', () => ({ default: () => null }));
vi.mock('@/context/CRMContext', () => ({ useCRM: () => ({ boards: [{ id: 'board', name: 'Teste', isDefault: true, stages: [{ id: 'q', label: 'Qualificado' }] }], deals: [] }) }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ profile: { first_name: 'Teste' } }) }));
vi.mock('./usePerformanceReport', () => ({ usePerformanceReport: (...args: unknown[]) => { state.query(...args); return { ...state, refetch: vi.fn() }; } }));
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

  it('abre os leads de perdas e motivos, permite buscar e conserva o link do cartão', () => {
    const board = { id: 'board', name: 'Teste', stages: [{ id: 'q', label: 'Qualificado' }] } as Board;
    const deals = ['Contato repetido', 'Sem interesse'].map((reason, i) => ({ id: `lost-${i}`, title: `Lead ${i}`, boardId: 'board', status: 'q', owner: { name: 'Ana' }, items: [],
      createdAt: '2026-08-01', isLost: true, isWon: false, closedAt: '2026-08-05', lossCategory: 'disqualified', lossReason: reason, value: 0 } as Deal));
    state.data = { ...calculatePerformance(deals, [], board, { start: new Date('2026-08-01'), end: new Date('2026-08-31') }), deals };
    render(<ReportsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Desqualificados 2' }));
    const modal = screen.getByRole('dialog');
    expect(within(modal).getAllByRole('link')).toHaveLength(2);
    expect(within(modal).getByRole('link', { name: /Lead 0/ })).toHaveAttribute('href', '/boards?deal=lost-0');
    fireEvent.change(within(modal).getByRole('textbox'), { target: { value: 'Lead 1' } });
    expect(within(modal).getAllByRole('link')).toHaveLength(1);
    fireEvent.click(within(modal).getByRole('button', { name: /Fechar/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Contato repetido: ver 1 leads' }));
    expect(within(screen.getByRole('dialog')).getAllByRole('link')).toHaveLength(1);
  });

  it('mostra as duas bases da taxa e propaga o filtro de produto para consulta e PDF', () => {
    const board = { id: 'board', name: 'Teste', stages: [{ id: 'q', label: 'Qualificado' }] } as Board;
    const deals = [{ id: 'q1', title: 'Lead antigo', owner: { name: 'Ana' }, boardId: 'board', status: 'q', items: [], createdAt: '2026-07-01', qualifiedAt: '2026-08-03', isLost: false, isWon: false } as Deal];
    state.data = { ...calculatePerformance(deals, [], board, { start: new Date('2026-08-01'), end: new Date('2026-08-31') }), deals, productOptions: [{ id: 'product', name: 'Produto Teste' }] };
    render(<ReportsPage />);
    fireEvent.click(screen.getByRole('button', { name: /Taxa de Qualificação/ }));
    const modal = screen.getByRole('dialog');
    expect(within(modal).getByRole('link', { name: /Lead antigo/ })).toBeInTheDocument();
    fireEvent.click(within(modal).getByRole('button', { name: 'Total de leads (0)' }));
    expect(within(modal).queryByRole('link')).not.toBeInTheDocument();
    fireEvent.click(within(modal).getByRole('button', { name: /Fechar/i }));
    fireEvent.click(screen.getByRole('combobox', { name: 'Filtrar por Produto' }));
    fireEvent.click(screen.getByRole('option', { name: 'Produto Teste' }));
    expect(state.query).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), '', expect.anything(), 'product');
    fireEvent.click(screen.getByRole('button', { name: 'PDF' }));
    expect(state.pdf).toHaveBeenCalledWith(state.data, expect.objectContaining({ product: 'Produto Teste' }));
  });
});
