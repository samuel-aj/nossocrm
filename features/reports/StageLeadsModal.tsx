import React from 'react';
import { ExternalLink } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import type { PerformanceMetrics, PerformanceMode } from './performanceMetrics';

const formatDate = (value?: string) => {
  if (!value || !Number.isFinite(Date.parse(value))) return '';
  return new Date(value).toLocaleDateString('pt-BR');
};

interface StageLeadsModalProps {
  stage: PerformanceMetrics['stageData'][number] | PerformanceMetrics['entryFunnel']['stages'][number];
  qualificationDates: Map<string, string>;
  estimatedQualificationIds?: Set<string>;
  mode?: PerformanceMode;
  onClose: () => void;
}

export function StageLeadsModal({ stage, qualificationDates, estimatedQualificationIds, mode, onClose }: StageLeadsModalProps) {
  const leads = [...stage.deals].sort((a, b) => a.title.localeCompare(b.title, 'pt-BR'));
  const evidence = 'evidenceByDeal' in stage ? stage.evidenceByDeal : undefined;
  const milestone = 'milestone' in stage ? stage.milestone : undefined;
  const monthly = mode === 'monthly';
  const currentPostSale = monthly && 'role' in stage && stage.role === 'postcustomer';
  const suffix = evidence && !milestone && !monthly ? ' ou além' : '';
  return (
    <Modal isOpen onClose={onClose} title={stage.name + suffix + (monthly && milestone === 'customer' ? ' · Ganhos do período' : '') + ' · ' + leads.length + ' leads'}
      className="max-w-4xl" bodyClassName="p-0 overflow-auto">
      <p className="px-5 py-3 text-sm text-slate-500">{stage.populationLabel}{stage.comparisonBase && ` ${stage.comparisonBase}`}</p>
      {evidence && <p className="px-5 pb-3 text-xs text-slate-500">{currentPostSale ? 'Pós-venda atual: posição atual dos ganhos mantidos do período, inclusive os fora da base de entradas. O negócio pode ter sido movimentado após o período selecionado. A etapa atual não comprova a data da chegada nem uma visita anterior.' : monthly ? milestone === 'customer' ? 'Ganhos do período: os mesmos contratos de Fechamentos e faturamento, inclusive os fora da base de entradas. Esses ganhos de fora não aumentam a base de leads ou origens. A taxa de fechamento usa somente os ganhos entre qualificados da base de entradas. A data do ganho registrado não comprova a data da assinatura.' : 'Somente leads da base de entradas do período. A prova abaixo explica a inclusão, sem inventar a data da primeira qualificação ou visitas a etapas puladas.' : milestone ? 'Os leads deste marco são os mesmos usados no indicador e na taxa correspondente.' : 'Avanços por etapas posteriores não criam visitas nas etapas puladas. Qualificação e ganho exigem seus próprios registros.'}</p>}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-slate-50 dark:bg-slate-900 text-slate-500 dark:text-slate-400">
            <tr>
              {['Nome do lead', ...(evidence ? ['Registro que explica a inclusão'] : []), 'Criação', 'Qualificação', ...(!evidence ? ['Encerramento'] : [])].map(label => (
                <th key={label} scope="col" className="px-5 py-3 font-medium whitespace-nowrap">{label}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {leads.map(lead => (
              <tr key={lead.id} className="text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                <td className="px-5 py-3 font-medium min-w-48">
                  <a href={'/boards?deal=' + encodeURIComponent(lead.id)} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 text-primary-600 dark:text-primary-400 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 rounded-sm">
                    <span>{lead.title}</span>
                    <ExternalLink size={14} className="shrink-0" aria-hidden="true" />
                    <span className="sr-only"> (abrir lead em nova aba)</span>
                  </a>
                </td>
                {evidence && <td className="px-5 py-3 min-w-48">
                  <span>{evidence.get(lead.id)?.stageName || '—'}</span>
                  <span className="block text-xs text-slate-500">{evidence.get(lead.id)?.kind === 'current-stage' ? 'Etapa atual · chegada sem data registrada' : <>{evidence.get(lead.id)?.kind === 'qualification' ? 'Qualificação registrada' : evidence.get(lead.id)?.kind === 'customer' ? 'Promoção a Cliente registrada' : evidence.get(lead.id)?.kind === 'win' ? 'Ganho registrado' : evidence.get(lead.id)?.observedAtStage ? 'Passagem registrada' : 'Incluído por etapa posterior'}{formatDate(evidence.get(lead.id)?.date) && ` · ${formatDate(evidence.get(lead.id)?.date)}`}</>}</span>
                </td>}
                <td className="px-5 py-3 whitespace-nowrap">{formatDate(lead.createdAt)}</td>
                <td className="px-5 py-3 whitespace-nowrap">{formatDate(qualificationDates.get(lead.id)) || (monthly ? 'Sem data registrada' : '')}
                  {estimatedQualificationIds?.has(lead.id) && <span className="block text-xs text-amber-600 dark:text-amber-400" title="Data estimada pelo primeiro registro disponível; a primeira qualificação não tem data comprovada.">Estimada</span>}
                </td>
                {!evidence && <td className="px-5 py-3 whitespace-nowrap">{formatDate(lead.isWon || lead.isLost ? lead.closedAt : undefined)}</td>}
              </tr>
            ))}
            {!leads.length && <tr><td colSpan={4} className="px-5 py-10 text-center text-slate-500">Nenhum lead {evidence && !monthly && !milestone ? 'nesta etapa ou além' : 'nesta etapa'} no período selecionado.</td></tr>}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
