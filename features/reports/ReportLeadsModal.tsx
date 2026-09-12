import React, { useMemo, useState } from 'react';
import { ExternalLink, Search } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import type { Board } from '@/types';
import { lossCategoryLabel, lossReasonLabel, reportDrilldown, salesCycleDays } from './reportDrilldown';

const money = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const date = (value?: string) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleDateString('pt-BR') : '—';

interface Props {
  detail: ReturnType<typeof reportDrilldown>;
  board: Board;
  filtersLabel: string;
  qualificationDates: Map<string, string>;
  estimatedQualificationIds: Set<string>;
  onClose: () => void;
}
export function ReportLeadsModal({ detail, board, filtersLabel, qualificationDates, estimatedQualificationIds, onClose }: Props) {
  const [groupId, setGroupId] = useState(detail.groups[0].id);
  const [search, setSearch] = useState('');
  const group = detail.groups.find(item => item.id === groupId) || detail.groups[0];
  const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
  const leads = useMemo(() => group.deals.filter(deal => normalize(`${deal.title} ${deal.owner?.name || ''}`).includes(normalize(search)))
    .sort((a, b) => a.title.localeCompare(b.title, 'pt-BR')), [group.deals, search]);
  const stages = new Map(board.stages.map(stage => [stage.id, stage.label]));
  const showLoss = detail.showLoss || group.id === 'qualified-lost';
  return (
    <Modal isOpen onClose={onClose} title={detail.title} className="max-w-6xl" bodyClassName="p-0 overflow-auto">
      <div className="px-5 py-4 space-y-3 border-b border-slate-200 dark:border-white/10">
        <p className="text-xs text-slate-500 dark:text-slate-400">{filtersLabel}</p>
        {detail.formula && <p className="text-sm text-slate-700 dark:text-slate-200">{detail.formula}. As duas bases podem conter leads diferentes.</p>}
        {detail.groups.length > 1 && <div className="flex flex-wrap gap-2" role="group" aria-label="Base do indicador">
          {detail.groups.map(item => <button key={item.id} type="button" aria-pressed={item.id === group.id}
            onClick={() => { setGroupId(item.id); setSearch(''); }}
            className={`px-3 py-2 rounded-lg text-sm font-medium focus-visible:ring-2 focus-visible:ring-primary-500 ${item.id === group.id ? 'bg-primary-600 text-white' : 'bg-slate-100 dark:bg-white/5 text-slate-700 dark:text-slate-300'}`}>
            {item.label} ({item.deals.length})
          </button>)}
        </div>}
        <p className="text-sm text-slate-500 dark:text-slate-400">{group.description}</p>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 dark:border-white/15">
            <Search size={16} aria-hidden="true" className="text-slate-500" />
            <input aria-label="Buscar lead ou responsável" value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar lead ou responsável…"
              className="min-w-0 w-full sm:w-64 bg-transparent text-sm text-slate-900 dark:text-white outline-none" />
          </label>
          <p aria-live="polite" className="text-sm text-slate-600 dark:text-slate-300">{leads.length} de {group.deals.length} leads
            {detail.showRevenue && <span className="ml-3 font-semibold">Total: {money(group.deals.reduce((sum, deal) => sum + deal.value, 0))}</span>}
          </p>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="bg-slate-50 dark:bg-slate-900 text-slate-500 dark:text-slate-400"><tr>
            {['Lead / Responsável', 'Etapa atual', 'Produto', ...(detail.showRevenue ? ['Valor'] : []), ...(showLoss ? ['Classificação', 'Motivo'] : []), 'Criação', 'Qualificação', 'Encerramento', ...(detail.showCycle ? ['Duração'] : [])].map(label => <th key={label} scope="col" className="px-4 py-3 font-medium whitespace-nowrap">{label}</th>)}
          </tr></thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {leads.map(lead => <tr key={lead.id} className="text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/5">
              <td className="px-4 py-3 min-w-48"><a href={'/boards?deal=' + encodeURIComponent(lead.id)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 font-medium text-primary-600 dark:text-primary-400 hover:underline focus-visible:ring-2 focus-visible:ring-primary-500 rounded-sm">{lead.title}<ExternalLink size={14} aria-hidden="true" /><span className="sr-only"> (abrir lead em nova aba)</span></a><span className="block text-xs text-slate-500 dark:text-slate-400 mt-1">{lead.owner?.name || 'Sem responsável'}</span></td>
              <td className="px-4 py-3">{stages.get(lead.status) || 'Etapa indisponível'}</td>
              <td className="px-4 py-3 min-w-36">{[...new Set(lead.items.map(item => item.name))].join(', ') || 'Sem produto'}</td>
              {detail.showRevenue && <td className="px-4 py-3 whitespace-nowrap">{money(lead.value)}</td>}
              {showLoss && <><td className="px-4 py-3">{lossCategoryLabel(lead.lossCategory)}</td><td className="px-4 py-3 min-w-44 whitespace-pre-wrap break-words">{lossReasonLabel(lead.lossReason)}</td></>}
              <td className="px-4 py-3 whitespace-nowrap">{date(lead.createdAt)}</td>
              <td className="px-4 py-3 whitespace-nowrap">{date(qualificationDates.get(lead.id))}{estimatedQualificationIds.has(lead.id) && <span className="block text-xs text-amber-600 dark:text-amber-400">Estimada</span>}</td>
              <td className="px-4 py-3 whitespace-nowrap">{date(lead.isWon || lead.isLost ? lead.closedAt : undefined)}</td>
              {detail.showCycle && <td className="px-4 py-3 whitespace-nowrap">{salesCycleDays(lead)?.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} dias</td>}
            </tr>)}
          </tbody>
        </table>
        {!leads.length && <p className="px-5 py-10 text-center text-sm text-slate-500">Nenhum lead encontrado para esta seleção.</p>}
      </div>
    </Modal>
  );
}
