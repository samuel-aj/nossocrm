import React, { useState } from 'react';
import type { Deal } from '@/types';
import { groupLossReasons } from '@/lib/utils/lossDetails';

export function LossReasonsCard({ deals, barClass, onSelect }: {
  deals: Deal[];
  barClass: string;
  onSelect: (reasonKey: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const groups = groupLossReasons(deals).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'pt-BR'));
  const shown = expanded ? groups : groups.slice(0, 5);
  const otherCount = groups.slice(5).reduce((sum, group) => sum + group.count, 0);
  if (!groups.length) return <p className="py-6 text-center text-sm text-slate-500">Nenhuma perda nesta categoria.</p>;
  return <div className="space-y-3">
    <p className="text-xs text-slate-500">{deals.length} perdas · participação dentro desta categoria</p>
    {shown.map(group => {
      const percentage = group.count / deals.length * 100;
      return <button key={group.key} type="button" onClick={() => onSelect(group.key)}
        aria-label={`${group.label}: ver ${group.count} leads`}
        className="block w-full rounded-lg p-1 text-left hover:bg-slate-50 dark:hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-primary-500">
        <span className="mb-1 flex items-start justify-between gap-3 text-sm">
          <span className="text-slate-700 dark:text-slate-300 break-words">{group.label}</span>
          <span className="shrink-0 text-slate-600 dark:text-slate-300 tabular-nums"><strong>{group.count}</strong> · {percentage.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%</span>
        </span>
        <span aria-hidden="true" className="block h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-white/5">
          <span className={`block h-full rounded-full ${barClass}`} style={{ width: `${percentage}%` }} />
        </span>
      </button>;
    })}
    {!expanded && otherCount > 0 && <p className="flex justify-between px-1 text-sm text-slate-500"><span>Outros motivos</span><span>{otherCount}</span></p>}
    {groups.length > 5 && <button type="button" onClick={() => setExpanded(value => !value)} aria-expanded={expanded}
      className="rounded px-1 py-2 text-sm font-medium text-primary-600 hover:underline focus-visible:ring-2 focus-visible:ring-primary-500">
      {expanded ? 'Mostrar os 5 principais' : `Ver todos os ${groups.length} motivos`}
    </button>}
  </div>;
}
