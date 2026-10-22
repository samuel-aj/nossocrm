import React from 'react';
import { expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { StageLeadsModal } from './StageLeadsModal';
import { calculatePerformance } from './performanceMetrics';
import type { Board, Deal } from '@/types';
import { monthlyPresentationFixture } from './monthlyPresentationTestFixture';
import type { EntryFunnelEvidence } from './entryFunnel';

const board = { id: 'b', stages: [{ id: 'q', label: 'Qualificado', color: '' }] } as Board;
const range = { start: new Date('2026-08-01'), end: new Date('2026-08-31T23:59:59Z') };
it('mensal mostra todos os ganhos mantidos sem transformar encerramento em assinatura ou inventar MQL', () => {
  const metrics = monthlyPresentationFixture();
  const stage = metrics.entryFunnel.stages.find(row => row.milestone === 'customer')!;
  render(<StageLeadsModal mode="monthly" stage={stage} qualificationDates={metrics.leadQualificationDates} onClose={() => {}} />);
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).getAllByRole('link')).toHaveLength(7);
  expect(within(dialog).queryByRole('link', { name: /Etapa Cliente sem contrato/ })).not.toBeInTheDocument();
  expect(within(dialog).getByText(/A taxa de fechamento usa somente os ganhos entre qualificados/)).toBeVisible();
  const unknown = screen.getByRole('link', { name: /Contrato 7/ }).closest('tr')!;
  expect(within(unknown).getByRole('cell', { name: 'Sem data registrada' })).toBeVisible();
  expect(within(unknown).getByText(/Ganho registrado ·/)).toBeVisible();
  expect(within(dialog).queryByText(/Promoção a Cliente registrada/)).not.toBeInTheDocument();
});
it('mensal mostra a chegada comprovada do pós-venda no período', () => {
  const metrics = monthlyPresentationFixture();
  const stage = metrics.entryFunnel.stages.find(row => row.role === 'postcustomer')!;
  render(<StageLeadsModal mode="monthly" stage={stage} qualificationDates={metrics.leadQualificationDates} onClose={() => {}} />);
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).getAllByRole('link')).toHaveLength(7);
  expect(within(dialog).getByText(/Pós-venda no período: chegadas ou cumprimentos registrados/)).toBeVisible();
  expect(within(dialog).getByText(/Inclui leads ganhos antes ou sem ganho registrado/)).toBeVisible();
  expect(within(dialog).getAllByText('Passagem registrada · 15/08/2026')).toHaveLength(7);
  expect(within(dialog).queryByText(/Etapa atual · chegada sem data registrada/)).not.toBeInTheDocument();
  const row = within(dialog).getByRole('link', { name: /Contrato 7/ }).closest('tr')!;
  expect(within(row).getByText('Passagem registrada · 15/08/2026')).toBeVisible();
  expect(within(row).queryByText(/Incluído por etapa posterior|Ganho registrado/)).not.toBeInTheDocument();
  expect(row.textContent).not.toContain('11/08/2026');
});
it('mensal preserva a data de qualificação comprovada da base de entradas', () => {
  const metrics = monthlyPresentationFixture();
  const stage = metrics.entryFunnel.stages.find(row => row.milestone === 'qualification')!;
  render(<StageLeadsModal mode="monthly" stage={stage} qualificationDates={metrics.leadQualificationDates} onClose={() => {}} />);
  const row = screen.getByRole('link', { name: /Qualificação registrada na entrada/ }).closest('tr')!;
  expect(within(row).getByRole('cell', { name: '03/08/2026' })).toBeVisible();
  expect(within(row).getByText(/Qualificação registrada · 03\/08\/2026/)).toBeVisible();
});

it('distingue cumprimento ao avançar de passagens e inclusões antigas, preservando cada data', () => {
  const metrics = monthlyPresentationFixture();
  const stage = metrics.entryFunnel.stages.find(row => row.role === 'postcustomer')!;
  const leads = stage.deals.slice(0, 3);
  const evidenceByDeal = new Map<string, EntryFunnelEvidence>([
    [leads[0].id, { stageName: stage.name, date: '2026-08-15T12:00:00Z', observedAtStage: false, kind: 'stage-completion' as const }],
    [leads[1].id, { stageName: stage.name, date: '2026-08-04T12:00:00Z', observedAtStage: true, kind: 'stage' as const }],
    [leads[2].id, { stageName: 'Etapa posterior', date: '2026-08-06T12:00:00Z', observedAtStage: false, kind: 'stage' as const }],
  ]);
  render(<StageLeadsModal mode="monthly" stage={{ ...stage, deals: leads, count: 3, evidenceByDeal }}
    qualificationDates={metrics.leadQualificationDates} onClose={() => {}} />);
  const completed = screen.getByRole('link', { name: new RegExp(leads[0].title) }).closest('tr')!;
  const direct = screen.getByRole('link', { name: new RegExp(leads[1].title) }).closest('tr')!;
  const legacy = screen.getByRole('link', { name: new RegExp(leads[2].title) }).closest('tr')!;
  expect(within(completed).getByText('Cumprimento registrado ao avançar · 15/08/2026')).toBeVisible();
  expect(within(direct).getByText('Passagem registrada · 04/08/2026')).toBeVisible();
  expect(within(legacy).getByText('Incluído por etapa posterior · 06/08/2026')).toBeVisible();
  expect(within(direct).queryByText(/Cumprimento registrado ao avançar/)).not.toBeInTheDocument();
  expect(within(legacy).queryByText(/Cumprimento registrado ao avançar/)).not.toBeInTheDocument();
});
it('mostra as quatro colunas, datas reais, vazios e permite fechar', () => {
  const leads = [
    { id: 'a', title: 'Ana', boardId: 'b', status: 'q', leadSource: 'Google Ads', createdAt: '2026-08-02T12:00:00Z', closedAt: '2026-08-20T12:00:00Z', isWon: true },
    { id: 'b', title: 'Bruno', boardId: 'b', status: 'q', leadSource: null, customFields: { origem: 'Origem antiga removida' }, createdAt: '2026-08-03T12:00:00Z' },
  ] as Deal[];
  const stage = { ...calculatePerformance([], [], board, range).stageData[0], deals: leads, count: leads.length };
  const onClose = vi.fn();
  render(<StageLeadsModal stage={stage} qualificationDates={new Map([['a', '2026-08-10T12:00:00Z']])} onClose={onClose} />);
  const dialog = screen.getByRole('dialog', { name: 'Qualificado · 2 leads' });
  expect(within(dialog).getAllByRole('columnheader').map(cell => cell.textContent)).toEqual(['Nome do lead', 'Criação', 'Qualificação', 'Encerramento']);
  expect(within(screen.getByText('Ana').closest('tr')!).getAllByRole('cell').map(cell => cell.textContent)).toEqual(['Ana (abrir lead em nova aba)Origem: Google Ads', '02/08/2026', '10/08/2026', '20/08/2026']);
  expect(within(screen.getByText('Bruno').closest('tr')!).getAllByRole('cell').map(cell => cell.textContent)).toEqual(['Bruno (abrir lead em nova aba)Origem: Não informado', '03/08/2026', '', '']);
  const link = screen.getByRole('link', { name: 'Ana (abrir lead em nova aba)' });
  expect(link).toHaveAttribute('href', '/boards?deal=a');
  expect(link).toHaveAttribute('target', '_blank');
  expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  fireEvent.click(screen.getByRole('button', { name: 'Fechar modal' }));
  expect(onClose).toHaveBeenCalledOnce();
});

it('identifica estimativa e oculta encerramento antigo de lead reaberto', () => {
  const leads=[{id:'a',title:'Reaberto',boardId:'b',status:'q',createdAt:'2026-08-02',closedAt:'2026-08-20',isWon:false,isLost:false}] as Deal[];
  const stage={ ...calculatePerformance([], [], board, range).stageData[0], deals: leads, count: leads.length };
  render(<StageLeadsModal stage={stage} qualificationDates={new Map([['a','2026-08-10T12:00:00Z']])} estimatedQualificationIds={new Set(['a'])} onClose={()=>{}} />);
  expect(screen.getByText('Estimada')).toBeInTheDocument();
  expect(within(screen.getByText('Reaberto').closest('tr')!).getAllByRole('cell')[3]).toHaveTextContent('');
});
