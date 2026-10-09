import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import ReportsPage from './ReportsPage';
import { calculatePerformance } from './performanceMetrics';
import type { Board, Deal } from '@/types';
import { august, board as fixtureBoard, lead, lifecycle, movement, snapshot } from './performanceTestFixtures';

const state = vi.hoisted(() => ({ data: null as any, error: null as any, isError: false, isFetching: false, pdf: vi.fn(), query: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next/dynamic', async () => {
  const { StageConversionChart } = await import('./StagePerformanceChart');
  return { default: () => StageConversionChart };
});
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
  const empty = () => ({ ...calculatePerformance([], [], board, range, '', undefined, snapshot, { mode: 'monthly' }), deals: [] });
  it('preserva a rosca na base de entradas e na origem registrada na entrada', () => {
    const deals = [lead('source-meta', { title: 'Entrada Meta', leadSource: 'Google Ads' }), lead('source-unknown', { title: 'Entrada sem origem', leadSource: null })];
    const lifecycleEvents = deals.map(deal => lifecycle(deal, 'entered_board', deal.createdAt, { leadSource: deal.id === 'source-meta' ? 'Meta Ads' : null }));
    state.data = { ...calculatePerformance(deals, [], fixtureBoard, august, '', undefined, snapshot, { mode: 'monthly', lifecycleEvents }), deals };
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
    const card = screen.getByText('Fechamentos no período').parentElement!.parentElement!;
    expect(within(card).getByText('15 ganhos')).toBeInTheDocument();
    expect(within(card).getByText('10 perdas qualificadas')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Visão do relatório' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resultados no período' })).not.toBeInTheDocument();
    expect(screen.getByText('Faturamento fechado')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Total perdidos/ })).not.toBeInTheDocument();
    expect(screen.getByText('Taxa de Qualificação')).toBeInTheDocument();
    expect(screen.getByText('Taxa de Fechamento')).toBeInTheDocument();
    expect(screen.getByText('80,0%')).toBeInTheDocument();
    expect(screen.getByText('37,5%')).toBeInTheDocument();
    expect(screen.getByText('-31,6% vs mês passado')).toBeInTheDocument();
    expect(state.query).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), '', expect.anything(), '', 'monthly');
    fireEvent.click(screen.getByRole('button', { name: 'PDF' }));
    expect(state.pdf).toHaveBeenCalledWith(state.data, expect.objectContaining({ mode: 'monthly' }));
  });
  it('mantém entradas e reaberturas detalháveis junto das etapas, sem avisos no cabeçalho', () => {
    const deal = lead('reopened', { title: 'Lead reaberto' });
    const lifecycleEvents = [lifecycle(deal, 'entered_board', deal.createdAt), lifecycle(deal, 'reopened', '2026-08-10')];
    state.data = { ...calculatePerformance([deal], [], fixtureBoard, august, '', undefined, snapshot, { mode: 'monthly', lifecycleEvents }), deals: [deal] };
    state.data.coverage.unknownQualificationCount = 3;
    state.data.coverage.legacySnapshotCount = 5;
    render(<ReportsPage />);
    expect(screen.queryByText('Histórico incompleto.')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Visão e base do relatório' })).not.toBeInTheDocument();
    const stages = screen.getByRole('region', { name: 'Progressão dos leads no funil' });
    fireEvent.click(within(stages).getByRole('button', { name: 'Entradas no funil: 1' }));
    expect(within(screen.getByRole('dialog')).getByRole('link', { name: /Lead reaberto/ })).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Fechar/i }));
    fireEvent.click(within(stages).getByRole('button', { name: 'Reaberturas: 1' }));
    expect(within(screen.getByRole('dialog')).getByRole('link', { name: /Lead reaberto/ })).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Fechar/i }));
    fireEvent.click(screen.getByRole('button', { name: /^Filtros/ }));
    expect(within(screen.getByRole('dialog')).getByText('Período')).toBeInTheDocument();
  });

  it('o gráfico preserva a base de entradas e detalha saltos sem adicionar leads antigos', () => {
    const entrant = lead('entry', { title: 'Entrou neste período' });
    const old = lead('old', { title: 'Entrada anterior', createdAt: '2026-07-01' });
    const lifecycleEvents = [lifecycle(entrant, 'entered_board', entrant.createdAt), lifecycle(old, 'entered_board', old.createdAt)];
    const history = [movement(entrant.id, 'signed', '2026-08-10', 'new'), movement(old.id, 'q', '2026-08-11', 'new')];
    state.data = { ...calculatePerformance([entrant, old], history, fixtureBoard, august, '', undefined, snapshot, { mode: 'monthly', lifecycleEvents }), deals: [entrant, old] };
    render(<ReportsPage />);
    const chart = screen.getByRole('region', { name: 'Progressão dos leads no funil' });
    expect(within(chart).getByRole('button', { name: 'Entradas no funil: 1' })).toBeVisible();
    fireEvent.click(within(chart).getByRole('button', { name: 'Ver 1 leads em Proposta enviada' }));
    const modal = screen.getByRole('dialog', { name: 'Proposta enviada · 1 leads' });
    expect(within(modal).getAllByRole('link')).toHaveLength(1);
    expect(within(modal).getByRole('link', { name: /Entrou neste período/ })).toBeVisible();
    expect(within(modal).queryByRole('link', { name: /Entrada anterior/ })).not.toBeInTheDocument();
    expect(within(modal).getByRole('columnheader', { name: 'Registro que explica a inclusão' })).toBeVisible();
    expect(within(modal).queryByRole('columnheader', { name: 'Encerramento' })).not.toBeInTheDocument();
    expect(within(modal).getAllByText(/Avanço|Assinado|qualifica/i).length).toBeGreaterThan(0);
  });

  it('abre os leads de perdas e motivos, permite buscar e conserva o link do cartão', () => {
    const board = { id: 'board', name: 'Teste', stages: [{ id: 'q', label: 'Qualificado' }] } as Board;
    const deals = ['Contato repetido', 'Sem interesse'].map((reason, i) => ({ id: `lost-${i}`, title: `Lead ${i}`, boardId: 'board', status: 'q', owner: { name: 'Ana' }, items: [],
      createdAt: '2026-08-01', isLost: true, isWon: false, closedAt: '2026-08-05', lossCategory: 'disqualified', lossReason: reason, value: 0 } as Deal));
    state.data = { ...calculatePerformance(deals, deals.map(deal => ({ dealId: deal.id, stageId: 'q', boardId: 'board', date: deal.createdAt })), board, { start: new Date('2026-08-01'), end: new Date('2026-08-31') }, '', undefined, snapshot, { mode: 'monthly' }), deals };
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

  it('mostra ganhos antigos no total mensal sem ampliar a base de entradas nem as taxas', () => {
    const winner = lead('winner', { title: 'Cliente deste período', isWon: true, status: 'signed', closedAt: '2026-08-05' });
    const open = lead('open', { title: 'Entrada ainda aberta' });
    const old = lead('old-winner', { title: 'Cliente captado antes', createdAt: '2026-07-01', isWon: true, status: 'signed', closedAt: '2026-08-05' });
    const deals = [winner, open, old];
    const lifecycleEvents = deals.map(deal => lifecycle(deal, 'entered_board', deal.createdAt));
    const events = [winner, old].flatMap(deal => [movement(deal.id, 'q', '2026-08-03', 'new'), movement(deal.id, 'signed', '2026-08-05', 'q')]);
    state.data = { ...calculatePerformance(deals, events, fixtureBoard, august, '', undefined, snapshot, { mode: 'monthly', lifecycleEvents }), deals };
    render(<ReportsPage />);
    expect(screen.getByRole('button', { name: 'Taxa de Qualificação 50,0% 1 qualificados de 2 leads' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Taxa de Fechamento 100,0% 1 ganhos dos 1 qualificados da base' })).toBeVisible();
    expect(screen.getByText('Conversão da base: 50,0%')).toBeVisible();
    expect(screen.getByText('1 da base · 1 fora da base')).toBeVisible();
    expect(screen.getByRole('group', { name: 'Distribuição de 2 leads por origem' })).toBeVisible();
    expect(screen.queryByRole('button', { name: /Leads no período/ })).not.toBeInTheDocument();
    const links = () => within(screen.getByRole('dialog')).getAllByRole('link').map(link => link.getAttribute('href'));
    const close = () => fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Fechar modal' }));
    fireEvent.click(screen.getByRole('button', { name: /^Taxa de Qualificação/ }));
    expect(links()).toEqual(['/boards?deal=winner']);
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Entradas (2)' })).toBeVisible();
    close();
    fireEvent.click(screen.getByRole('button', { name: 'Ver 1 leads em Proposta enviada' }));
    expect(links()).toEqual(['/boards?deal=winner']);
    close();
    fireEvent.click(screen.getByRole('button', { name: /^Taxa de Fechamento/ }));
    expect(links()).toEqual(['/boards?deal=winner']);
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Qualificados (1)' })).toBeVisible();
    close();
    fireEvent.click(screen.getByRole('button', { name: /^Fechamentos no período/ }));
    expect(links().sort()).toEqual(['/boards?deal=old-winner', '/boards?deal=winner']);
    close();
    fireEvent.click(screen.getByRole('button', { name: 'Ver 2 leads em Assinado' }));
    expect(links().sort()).toEqual(['/boards?deal=old-winner', '/boards?deal=winner']);
    expect(within(screen.getByRole('dialog')).getAllByText(/Ganho registrado/).length).toBeGreaterThan(0);
  });

  it('mantém um ganho sem MQL no total e explicita a base menor da taxa', () => {
    const deal = lead('unqualified-winner', { title: 'Ganho a conferir', value: 500, isWon: true, closedAt: '2026-08-05T12:00:00Z' });
    const lifecycleEvents = [lifecycle(deal, 'entered_board', deal.createdAt),
      lifecycle(deal, 'won', '2026-08-05T12:00:00Z', { stageId: undefined, value: 500, isWon: true })];
    state.data = { ...calculatePerformance([deal], [], fixtureBoard, august, '', undefined, snapshot, { mode: 'monthly', lifecycleEvents }), deals: [deal] };
    render(<ReportsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Conferir 1 registro fora da conversão comprovada' }));
    const modal = screen.getByRole('dialog');
    expect(within(modal).getByRole('link', { name: /Ganho a conferir/ })).toHaveAttribute('href', '/boards?deal=unqualified-winner');
    expect(within(modal).getByRole('columnheader', { name: 'Conferência do histórico' })).toBeVisible();
    expect(within(modal).getByRole('cell', { name: /^Ganho da base sem qualificação comprovada antes do ganho registrado/ })).toBeVisible();
    expect(within(modal).getByRole('cell', { name: /500,00/ })).toBeVisible();
    expect(within(modal).getByRole('cell', { name: '05/08/2026' })).toBeVisible();
    expect(state.data.wonDeals).toHaveLength(1);
    expect(state.data.cohortWonDeals).toHaveLength(0);
  });

  it('detalha qualificações e propaga o filtro de produto para consulta e PDF do período', () => {
    const board = { id: 'board', name: 'Teste', stages: [{ id: 'q', label: 'Qualificado' }] } as Board;
    const deals = [{ id: 'q1', title: 'Lead qualificado', owner: { name: 'Ana' }, boardId: 'board', status: 'q', items: [], createdAt: '2026-08-01', qualifiedAt: '2026-08-03', qualificationDateSource: 'history', isLost: false, isWon: false } as Deal];
    state.data = { ...calculatePerformance(deals, deals.map(deal => ({ dealId: deal.id, stageId: 'q', boardId: 'board', date: deal.createdAt })), board, { start: new Date('2026-08-01'), end: new Date('2026-08-31') }, '', undefined, snapshot, { mode: 'monthly' }), deals, productOptions: [{ id: 'product', name: 'Produto Teste' }] };
    render(<ReportsPage />);
    fireEvent.click(screen.getByRole('button', { name: /Taxa de Qualificação/ }));
    const modal = screen.getByRole('dialog');
    expect(within(modal).getByRole('link', { name: /Lead qualificado/ })).toBeInTheDocument();
    expect(within(modal).getByRole('button', { name: 'Entradas (1)' })).toBeInTheDocument();
    fireEvent.click(within(modal).getByRole('button', { name: /Fechar/i }));
    expect(screen.getByRole('combobox', { name: 'Selecionar Pipeline' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Filtrar por Produto' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Filtros/ }));
    expect(within(screen.getByRole('dialog')).queryByRole('combobox', { name: 'Selecionar Pipeline' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('combobox', { name: 'Filtrar por Produto' }));
    fireEvent.click(screen.getByRole('option', { name: 'Produto Teste' }));
    expect(state.query).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), '', expect.anything(), '', 'monthly');
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar filtros' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(state.query).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), '', expect.anything(), 'product', 'monthly');
    fireEvent.click(screen.getByRole('combobox', { name: 'Selecionar Pipeline' }));
    fireEvent.click(screen.getByRole('option', { name: 'Outra pipeline' }));
    expect(state.query).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'other' }), expect.anything(), '', expect.anything(), 'product', 'monthly');
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
