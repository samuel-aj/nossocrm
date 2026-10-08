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
vi.mock('@/context/CRMContext', () => ({ useCRM: () => ({ boards: [{ id: 'board', name: 'Teste', isDefault: true, stages: [{ id: 'q', label: 'Qualificado' }] }, { id: 'other', name: 'Outra pipeline', stages: [] }], deals: [] }) }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ profile: { first_name: 'Teste' } }) }));
vi.mock('./usePerformanceReport', () => ({ usePerformanceReport: (...args: unknown[]) => { state.query(...args); return { ...state, refetch: vi.fn() }; } }));
vi.mock('@/components/charts', () => ({ ChartWrapper: ({ children }: any) => <div>{children}</div>, LazyStageConversionChart: ({ data }: any) => <div>{JSON.stringify(data)}</div> }));
vi.mock('@/features/dashboard/hooks/useDashboardMetrics', () => ({ getDateRange: () => ({ start: new Date('2026-08-01'), end: new Date('2026-08-31') }), PERIOD_LABELS: { this_month: 'Este mês' }, COMPARISON_LABELS: { this_month: 'vs mês passado' } }));
vi.mock('./utils/generateReportPDF', () => ({ generateReportPDF: (...args: any[]) => state.pdf(...args) }));

describe('tela Performance', () => {
  beforeEach(() => { state.data = null; state.isError = false; state.error = null; state.isFetching = false; state.pdf.mockClear(); state.query.mockClear(); });
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
  const board = { id: 'board', name: 'Teste', stages: [{ id: 'q', label: 'Proposta enviada', linkedLifecycleStage: 'MQL' }] } as Board;
  const range = { start: new Date('2026-08-01'), end: new Date('2026-08-31') };
  const empty = () => ({ ...calculatePerformance([], [], board, range), deals: [] });
  it('explica perdas qualificadas e exporta a visão selecionada', () => {
    state.data = { ...empty(), qualifiedCount: 40, qualificationRate: 80, closingRate: 37.5,
      hasQualifiedStage: true, cohortWonDeals: Array(15).fill({}), wonDeals: Array.from({length:15}, (_, i) => ({ id: String(i), value: 100, owner: { name: 'Samuel' } })),
      lostDeals: [...Array(10).fill({ lossCategory: 'qualified' }), ...Array(5).fill({ lossCategory: 'disqualified' })],
      wonRevenue: 1500, revenueChange: -31.6, fastestSalesCycle: 3, slowestSalesCycle: 50, avgSalesCycle: 18 };
    render(<ReportsPage />);
    const card = screen.getByText('Fechamentos').parentElement!.parentElement!;
    expect(within(card).getByText('15 ganhos')).toBeInTheDocument();
    expect(within(card).getByText('10 perdas qualificadas')).toBeInTheDocument();
    expect(screen.getByText('Valor ganho pelos leads do grupo')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Resultados no período' }));
    expect(screen.queryByText('Taxa de Qualificação')).not.toBeInTheDocument();
    expect(screen.getByText('Qualificados no período')).toBeInTheDocument();
    expect(screen.getByText('-31,6% vs mês passado')).toBeInTheDocument();
    expect(state.query).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), '', expect.anything(), '', 'period');
    fireEvent.click(screen.getByRole('button', { name: 'PDF' }));
    expect(state.pdf).toHaveBeenCalledWith(state.data, expect.objectContaining({ mode: 'period' }));
  });
  it('mostra cobertura histórica e não apresenta taxas na carteira atual', () => {
    state.data = { ...empty(), coverage: { unknownQualificationCount: 3, estimatedQualificationCount: 2, unknownClosureCount: 1, legacySnapshotCount: 5, unknownBoardMembershipCount: 2 }, currentDeals: Array(4).fill({}), currentValue: 400 };
    render(<ReportsPage />);
    expect(screen.getByText('Histórico incompleto.')).toBeInTheDocument();
    expect(screen.getByText(/As taxas e os períodos usam apenas datas e vínculos/)).toHaveTextContent('com data estimada: 2');
    fireEvent.click(screen.getByRole('button', { name: 'Carteira atual' }));
    expect(screen.queryByText('Taxa de Fechamento')).not.toBeInTheDocument();
    expect(screen.getByText('Negócios abertos')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.queryByText('Histórico incompleto.')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Filtros/ }));
    expect(within(screen.getByRole('dialog')).queryByText('Período')).not.toBeInTheDocument();
  });

  it('abre os leads de perdas e motivos, permite buscar e conserva o link do cartão', () => {
    const board = { id: 'board', name: 'Teste', stages: [{ id: 'q', label: 'Qualificado' }] } as Board;
    const deals = ['Contato repetido', 'Sem interesse'].map((reason, i) => ({ id: `lost-${i}`, title: `Lead ${i}`, boardId: 'board', status: 'q', owner: { name: 'Ana' }, items: [],
      createdAt: '2026-08-01', isLost: true, isWon: false, closedAt: '2026-08-05', lossCategory: 'disqualified', lossReason: reason, value: 0 } as Deal));
    state.data = { ...calculatePerformance(deals, deals.map(deal => ({ dealId: deal.id, stageId: 'q', boardId: 'board', date: deal.createdAt })), board, { start: new Date('2026-08-01'), end: new Date('2026-08-31') }), deals };
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
    const deals = [{ id: 'q1', title: 'Lead qualificado', owner: { name: 'Ana' }, boardId: 'board', status: 'q', items: [], createdAt: '2026-08-01', qualifiedAt: '2026-08-03', qualificationDateSource: 'history', isLost: false, isWon: false } as Deal];
    state.data = { ...calculatePerformance(deals, deals.map(deal => ({ dealId: deal.id, stageId: 'q', boardId: 'board', date: deal.createdAt })), board, { start: new Date('2026-08-01'), end: new Date('2026-08-31') }), deals, productOptions: [{ id: 'product', name: 'Produto Teste' }] };
    render(<ReportsPage />);
    fireEvent.click(screen.getByRole('button', { name: /Taxa de Qualificação/ }));
    const modal = screen.getByRole('dialog');
    expect(within(modal).getByRole('link', { name: /Lead qualificado/ })).toBeInTheDocument();
    fireEvent.click(within(modal).getByRole('button', { name: 'Entradas (1)' }));
    expect(within(modal).getByRole('link', { name: /Lead qualificado/ })).toBeInTheDocument();
    fireEvent.click(within(modal).getByRole('button', { name: /Fechar/i }));
    expect(screen.getByRole('combobox', { name: 'Selecionar Pipeline' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Filtrar por Produto' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Filtros/ }));
    expect(within(screen.getByRole('dialog')).queryByRole('combobox', { name: 'Selecionar Pipeline' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('combobox', { name: 'Filtrar por Produto' }));
    fireEvent.click(screen.getByRole('option', { name: 'Produto Teste' }));
    expect(state.query).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), '', expect.anything(), '', 'cohort');
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar filtros' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(state.query).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), '', expect.anything(), 'product', 'cohort');
    fireEvent.click(screen.getByRole('combobox', { name: 'Selecionar Pipeline' }));
    fireEvent.click(screen.getByRole('option', { name: 'Outra pipeline' }));
    expect(state.query).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'other' }), expect.anything(), '', expect.anything(), 'product', 'cohort');
    fireEvent.click(screen.getByRole('button', { name: /^Filtros/ }));
    expect(screen.getByRole('combobox', { name: 'Filtrar por Produto' })).toHaveTextContent('Produto Teste');
    fireEvent.click(screen.getByRole('combobox', { name: 'Filtrar por Produto' }));
    fireEvent.click(screen.getByRole('option', { name: 'Sem produto' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    fireEvent.click(screen.getByRole('button', { name: /^Filtros/ }));
    expect(screen.getByRole('combobox', { name: 'Filtrar por Produto' })).toHaveTextContent('Produto Teste');
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Filtros do relatório' }), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'PDF' }));
    expect(state.pdf).toHaveBeenCalledWith(state.data, expect.objectContaining({ product: 'Produto Teste' }));
  });
});
