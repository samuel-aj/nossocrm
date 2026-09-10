import React from 'react';
import { ExternalLink } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import type { PerformanceMetrics } from './performanceMetrics';

const formatDate = (value?: string) => {
  if (!value || !Number.isFinite(Date.parse(value))) return '';
  return new Date(value).toLocaleDateString('pt-BR');
};

interface StageLeadsModalProps {
  stage: PerformanceMetrics['stageData'][number];
  qualificationDates: Map<string, string>;
  onClose: () => void;
}

export function StageLeadsModal({ stage, qualificationDates, onClose }: StageLeadsModalProps) {
  const leads = [...stage.deals].sort((a, b) => a.title.localeCompare(b.title, 'pt-BR'));
  return (
    <Modal isOpen onClose={onClose} title={stage.name + ' · ' + leads.length + ' leads'}
      className="max-w-4xl" bodyClassName="p-0 overflow-auto">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-slate-50 dark:bg-slate-900 text-slate-500 dark:text-slate-400">
            <tr>
              {['Nome do lead', 'Criação', 'Qualificação', 'Encerramento'].map(label => (
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
                <td className="px-5 py-3 whitespace-nowrap">{formatDate(lead.createdAt)}</td>
                <td className="px-5 py-3 whitespace-nowrap">{formatDate(qualificationDates.get(lead.id))}</td>
                <td className="px-5 py-3 whitespace-nowrap">{formatDate(lead.closedAt)}</td>
              </tr>
            ))}
            {!leads.length && <tr><td colSpan={4} className="px-5 py-10 text-center text-slate-500">Nenhum lead nesta etapa no período selecionado.</td></tr>}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
