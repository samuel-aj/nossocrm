import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Block, FlowNode } from '../canvas/types';
import { BotAnalyticsProvider, BotEdgeMetric, BotGroupMetric, canOverlayBotAnalytics, metricOutputId } from './BotAnalyticsContext';
import { BotAnalyticsPanel } from './BotAnalyticsPanel';
import { botAnalyticsParams } from './useBotAnalytics';
import type { BotAnalyticsResult } from './types';

afterEach(() => { cleanup(); vi.useRealTimers(); });

function result(): BotAnalyticsResult {
  return {
    botId: 'bot', botUpdatedAt: '2026-10-29T12:00:00Z', asOf: '2026-10-29T12:00:00Z', measurementStartedAt: '2026-10-29T00:00:00Z', legacyRuns: 0,
    selectedRevision: 'version-a', isCurrentRevision: true,
    revisions: [{ id: 'version-a', startedAt: '2026-10-29T00:00:00Z', runs: 10 }],
    summary: { runs: 10, uniqueSubjects: 8, running: 0, waiting: 2, done: 7, errored: 1, cancelled: 0 },
    steps: [{ id: 'template', label: 'Mensagem inicial', type: 'send_template', entered: 10, percent: 100, failed: 0, skipped: 0, waiting: 2,
      outputs: [
        { id: 'button:0', label: 'Vamos agendar', targetStepId: 'end', count: 6, percent: 60 },
        { id: 'button:1', label: 'Não quero', targetStepId: 'end', count: 2, percent: 20 },
      ] }],
    groups: [{ id: 'g', label: 'Balão', entered: 10, percent: 100 }],
    variants: [{ stepId: 'split', branchId: 'a', label: 'A', subjects: 5, converted: null, rate: null }],
    goalStepId: null, goalOptions: [{ id: 'end', label: 'Agendamento' }],
  };
}

const templateBlock: Block = { id: 'template', type: 'send_template', data: {
  template_id: '', template_name: '', template_body: '', buttons: ['Vamos agendar', 'Não quero'],
  typing_seconds: 0, timeout: '1', timeoutUnit: 'd',
} } as Block;
const nodes: FlowNode[] = [{ id: 'g', type: 'bubble', position: { x: 0, y: 0 }, data: { name: 'Balão', blocks: [templateBlock] } }];

describe('analytics overlays', () => {
  it('keeps different exits to the same destination separate', () => {
    render(<BotAnalyticsProvider data={result()} enabled loadedBotUpdatedAt={result().botUpdatedAt} nodes={nodes}>
      <BotGroupMetric groupId="g" /><BotEdgeMetric sourceNodeId="g" sourceHandle="btn:0" /><BotEdgeMetric sourceNodeId="g" sourceHandle="btn:1" />
    </BotAnalyticsProvider>);
    expect(screen.getByText('10 chegaram · 100% do robô')).toBeInTheDocument();
    expect(screen.getByText('6 · 60%')).toBeInTheDocument();
    expect(screen.getByText('2 · 20%')).toBeInTheDocument();
  });

  it('does not attach historical or unsaved statistics to the current graph', () => {
    const data = result();
    expect(canOverlayBotAnalytics(data, true, true, data.botUpdatedAt)).toBe(false);
    expect(canOverlayBotAnalytics(data, false)).toBe(false);
    render(<BotAnalyticsProvider data={{ ...data, isCurrentRevision: false }} enabled loadedBotUpdatedAt={data.botUpdatedAt} nodes={nodes}><BotGroupMetric groupId="g" /></BotAnalyticsProvider>);
    expect(screen.queryByText(/chegaram/)).not.toBeInTheDocument();
  });

  it('hides metrics from a concurrent update even when they match the latest database revision', () => {
    const loadedAt = result().botUpdatedAt;
    const { rerender } = render(<BotAnalyticsProvider data={result()} enabled loadedBotUpdatedAt={loadedAt} nodes={nodes}><BotGroupMetric groupId="g" /></BotAnalyticsProvider>);
    expect(screen.getByText(/10 chegaram/)).toBeInTheDocument();
    const updated = { ...result(), botUpdatedAt: '2026-10-29T13:00:00Z', selectedRevision: 'version-b', isCurrentRevision: true };
    rerender(<BotAnalyticsProvider data={updated} enabled loadedBotUpdatedAt={loadedAt} nodes={nodes}><BotGroupMetric groupId="g" /></BotAnalyticsProvider>);
    expect(screen.queryByText(/chegaram/)).not.toBeInTheDocument();
    expect(canOverlayBotAnalytics(updated, true, false, updated.botUpdatedAt)).toBe(true);
    expect(canOverlayBotAnalytics(updated, true)).toBe(false);
  });

  it('maps persisted rule indexes and preserves stable split branch identifiers', () => {
    const condition = { id: 'c', type: 'condition', data: { rules: [{ id: 'first' }, { id: 'second' }] } } as Block;
    expect(metricOutputId(condition, 'rule:second')).toBe('rule:1');
    expect(metricOutputId(condition, 'rule:removed')).toBeNull();
    const split = { id: 's', type: 'split', data: { mode: 'round_robin', branches: [] } } as Block;
    expect(metricOutputId(split, 'branch:unchanged-id')).toBe('branch:unchanged-id');
  });
});

describe('analytics details', () => {
  it('requires an explicit target and reports the chosen target without starting a bot', () => {
    const onGoal = vi.fn();
    render(<BotAnalyticsPanel data={result()} loading={false} error={null} dirty={false} goalStepId="" onGoal={onGoal} onRetry={vi.fn()} />);
    expect(screen.getByText('Selecione um objetivo para calcular a taxa de cada caminho.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Bloco objetivo da comparação'), { target: { value: 'end' } });
    expect(onGoal).toHaveBeenCalledWith('end');
    expect(screen.queryByRole('button', { name: /Iniciar robô/ })).not.toBeInTheDocument();
  });

  it('keeps failures and waiting visible alongside each output denominator', () => {
    const data = result();
    data.steps[0].failed = 1;
    render(<BotAnalyticsPanel data={data} loading={false} error={null} dirty={false} goalStepId="" onGoal={vi.fn()} onRetry={vi.fn()} />);
    expect(screen.getByText('6 / 10 · 60%')).toBeInTheDocument();
    expect(screen.getByText('2 / 10 · 20%')).toBeInTheDocument();
    expect(screen.getByText('Aguardando: 2 · Falhas: 1 · Pulados: 0')).toBeInTheDocument();
  });

  it('distinguishes missing historical measurement from zero conversion', () => {
    const data = result();
    data.measurementStartedAt = null; data.legacyRuns = 42;
    render(<BotAnalyticsPanel data={data} loading={false} error={null} dirty goalStepId="" onGoal={vi.fn()} onRetry={vi.fn()} />);
    expect(screen.getByText(/42 execuções antigas preservadas/)).toBeInTheDocument();
    expect(screen.getByText(/Nenhum acionamento medido ainda/)).toBeInTheDocument();
    expect(screen.getByText(/Há alterações não salvas/)).toBeInTheDocument();
  });

  it('shows retry instead of stale metrics when an API call fails', () => {
    const onRetry = vi.fn();
    render(<BotAnalyticsPanel data={result()} loading={false} error="Estatísticas indisponíveis" dirty={false} goalStepId="" onGoal={vi.fn()} onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(screen.queryByText('Comparar caminhos')).not.toBeInTheDocument();
  });

  it('explains that a concurrently updated graph needs to be reopened', () => {
    render(<BotAnalyticsPanel data={result()} loading={false} error={null} dirty={false} staleGraph goalStepId="" onGoal={vi.fn()} onRetry={vi.fn()} />);
    expect(screen.getByText(/Feche e abra o editor novamente/)).toBeInTheDocument();
  });

  it('lets the user clear a target removed by a concurrent flow edit', () => {
    const onGoal = vi.fn();
    render(<BotAnalyticsPanel data={undefined} loading={false} error="Versão ou objetivo não encontrado neste robô." dirty={false} goalStepId="removed-goal" onGoal={onGoal} onRetry={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Limpar objetivo' }));
    expect(onGoal).toHaveBeenCalledWith('');
  });
});

describe('analytics filters', () => {
  it('uses the same Monday–Sunday weeks as reports and safely encodes the selected goal', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 29, 12));
    const params = botAnalyticsParams('last_week', 'old-revision', 'goal&1');
    expect(params.get('start')).toBe(new Date(2026, 9, 19).toISOString());
    expect(params.get('end')).toBe(new Date(2026, 9, 25, 23, 59, 59, 999).toISOString());
    expect(params.get('revision')).toBe('old-revision');
    expect(params.get('goalStepId')).toBe('goal&1');
    expect(params.toString()).toContain('goal%261');
  });

  it('keeps the query range stable across renders within the same local day', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 29, 9));
    const before = botAnalyticsParams('this_month', '', '').toString();
    vi.setSystemTime(new Date(2026, 9, 29, 18, 42, 51, 201));
    expect(botAnalyticsParams('this_month', '', '').toString()).toBe(before);
  });
});
