import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import ReportsPage from './ReportsPage';
import { calculatePerformance } from './performanceMetrics';
import type { Board, Deal } from '@/types';
import { august, board as fixtureBoard, lead, lifecycle, snapshot } from './performanceTestFixtures';

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
  const empty = () => ({ ...calculatePerformance([], [], board, range, '', undefined, snapshot, { mode: 'period' }), deals: [] });
  it('conecta a rosca aos leads da origem selecionada e mostra o valor histórico na lista', () => {
    const deals = [lead('source-meta', { title: 'Entrada Meta', leadSource: 'Google Ads' }), lead('source-unknown', { title: 'Entrada sem origem', leadSource: null })];
    const lifecycleEvents = deals.map(deal => lifecycle(deal, 'entered_board', deal.createdAt, { leadSource: deal.id === 'source-meta' ? 'Meta Ads' : null }));
    state.data = { ...calculatePerformance(deals, [], fixtureBoard, august, '', undefined, snapshot, { mode: 'period', lifecycleEvents }), deals };
    render(<ReportsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Detalhar Meta Ads: 1 lead, 50,0%' }));
    const modal = screen.getByRole('dialog');
    expect(within(modal).getAllByRole('link')).toHaveLength(1);
    expect(within(modal).getByRole('link', { name: /Entrada Meta/ })).toBeInTheDocument();
    expect(within(modal).getByRole('columnheader', { name: 'Origem do lead' })).toBeInTheDocument();
    expect(within(modal).getByRole('cell', { name: 'Meta Ads' })).toBeInTheDocument();
    expect(within(modal).queryByRole('cell', { name: 'Google Ads' })).not.toBeInTheDocument();
    fireEvent.click(within(modal).getByRole('button', { name: /Fechar/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Ver todas as origens' }));
    expect(within(screen.getByRole('dialog')).getAllByRole('link')).toHaveLength(2);
  });
  it('consulta e exporta sempre os resultados do período, sem seletor de visão', () => {
    state.data = { ...empty(), qualifiedCount: 40, qualificationRate: 80, closingRate: 37.5,
      hasQualifiedStage: true, cohortWonDeals: Array(15).fill({}), wonDeals: Array.from({length:15}, (_, i) => ({ id: String(i), value: 100, owner: { name: 'Samuel' } })),
      lostDeals: [...Array(10).fill({ lossCategory: 'qualified' }), ...Array(5).fill({ lossCategory: 'disqualified' })],
      wonRevenue: 1500, revenueChange: -31.6, fastestSalesCycle: 3, slowestSalesCycle: 50, avgSalesCycle: 18 };
    render(<ReportsPage />);
    const card = screen.getByText('Fechamentos').parentElement!.parentElement!;
    expect(within(card).getByText('15 ganhos')).toBeInTheDocument();
    expect(within(card).getByText('10 perdas qualificadas')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Visão do relatório' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resultados no período' })).not.toBeInTheDocument();
    expect(screen.getByText('Faturamento fechado')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Total perdidos/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Taxa de Qualificação')).not.toBeInTheDocument();
    expect(screen.getByText('Qualificados no período')).toBeInTheDocument();
    expect(screen.getByText('-31,6% vs mês passado')).toBeInTheDocument();
    expect(state.query).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), '', expect.anything(), '', 'period');
    fireEvent.click(screen.getByRole('button', { name: 'PDF' }));
    expect(state.pdf).toHaveBeenCalledWith(state.data, expect.objectContaining({ mode: 'period' }));
  });
  it('mantém entradas e reaberturas detalháveis junto das etapas, sem avisos no cabeçalho', () => {
    const deal = lead('reopened', { title: 'Lead reaberto' });
    const lifecycleEvents = [lifecycle(deal, 'entered_board', deal.createdAt), lifecycle(deal, 'reopened', '2026-08-10')];
    state.data = { ...calculatePerformance([deal], [], fixtureBoard, august, '', undefined, snapshot, { mode: 'period', lifecycleEvents }), deals: [deal] };
    state.data.coverage.unknownQualificationCount = 3;
    state.data.coverage.legacySnapshotCount = 5;
    render(<ReportsPage />);
    expect(screen.queryByText('Histórico incompleto.')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Visão e base do relatório' })).not.toBeInTheDocument();
    const stages = screen.getByRole('region', { name: 'Chegadas por etapa no período' });
    fireEvent.click(within(stages).getByRole('button', { name: 'Entradas no funil: 1' }));
    expect(within(screen.getByRole('dialog')).getByRole('link', { name: /Lead reaberto/ })).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Fechar/i }));
    fireEvent.click(within(stages).getByRole('button', { name: 'Reaberturas: 1' }));
    expect(within(screen.getByRole('dialog')).getByRole('link', { name: /Lead reaberto/ })).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Fechar/i }));
    fireEvent.click(screen.getByRole('button', { name: /^Filtros/ }));
    expect(within(screen.getByRole('dialog')).getByText('Período')).toBeInTheDocument();
  });

  it('abre os leads de perdas e motivos, permite buscar e conserva o link do cartão', () => {
    const board = { id: 'board', name: 'Teste', stages: [{ id: 'q', label: 'Qualificado' }] } as Board;
    const deals = ['Contato repetido', 'Sem interesse'].map((reason, i) => ({ id: `lost-${i}`, title: `Lead ${i}`, boardId: 'board', status: 'q', owner: { name: 'Ana' }, items: [],
      createdAt: '2026-08-01', isLost: true, isWon: false, closedAt: '2026-08-05', lossCategory: 'disqualified', lossReason: reason, value: 0 } as Deal));
    state.data = { ...calculatePerformance(deals, deals.map(deal => ({ dealId: deal.id, stageId: 'q', boardId: 'board', date: deal.createdAt })), board, { start: new Date('2026-08-01'), end: new Date('2026-08-31') }, '', undefined, snapshot, { mode: 'period' }), deals };
    render(<ReportsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Total desqualificados 2' }));
    const modal = screen.getByRole('dialog');
    expect(within(modal).getAllByRole('link')).toHaveLength(2);
    expect(within(modal).getByRole('link', { name: /Lead 0/ })).toHaveAttribute('href', '/boards?deal=lost-0');
    fireEvent.change(within(modal).getByRole('textbox'), { target: { value: 'Lead 1' } });
    expect(within(modal).getAllByRole('link')).toHaveLength(1);
    fireEvent.click(within(modal).getByRole('button', { name: /Fechar/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Contato repetido: ver 1 leads' }));
    expect(within(screen.getByRole('dialog')).getAllByRole('link')).toHaveLength(1);
  });

  it('detalha qualificações e propaga o filtro de produto para consulta e PDF do período', () => {
    const board = { id: 'board', name: 'Teste', stages: [{ id: 'q', label: 'Qualificado' }] } as Board;
    const deals = [{ id: 'q1', title: 'Lead qualificado', owner: { name: 'Ana' }, boardId: 'board', status: 'q', items: [], createdAt: '2026-08-01', qualifiedAt: '2026-08-03', qualificationDateSource: 'history', isLost: false, isWon: false } as Deal];
    state.data = { ...calculatePerformance(deals, deals.map(deal => ({ dealId: deal.id, stageId: 'q', boardId: 'board', date: deal.createdAt })), board, { start: new Date('2026-08-01'), end: new Date('2026-08-31') }, '', undefined, snapshot, { mode: 'period' }), deals, productOptions: [{ id: 'product', name: 'Produto Teste' }] };
    render(<ReportsPage />);
    fireEvent.click(screen.getByRole('button', { name: /Qualificados no período/ }));
    const modal = screen.getByRole('dialog');
    expect(within(modal).getByRole('link', { name: /Lead qualificado/ })).toBeInTheDocument();
    expect(within(modal).queryByRole('button', { name: 'Entradas (1)' })).not.toBeInTheDocument();
    fireEvent.click(within(modal).getByRole('button', { name: /Fechar/i }));
    expect(screen.getByRole('combobox', { name: 'Selecionar Pipeline' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Filtrar por Produto' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Filtros/ }));
    expect(within(screen.getByRole('dialog')).queryByRole('combobox', { name: 'Selecionar Pipeline' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('combobox', { name: 'Filtrar por Produto' }));
    fireEvent.click(screen.getByRole('option', { name: 'Produto Teste' }));
    expect(state.query).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), '', expect.anything(), '', 'period');
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar filtros' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(state.query).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), '', expect.anything(), 'product', 'period');
    fireEvent.click(screen.getByRole('combobox', { name: 'Selecionar Pipeline' }));
    fireEvent.click(screen.getByRole('option', { name: 'Outra pipeline' }));
    expect(state.query).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'other' }), expect.anything(), '', expect.anything(), 'product', 'period');
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
