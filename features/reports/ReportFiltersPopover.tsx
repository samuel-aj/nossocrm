import React, { useState } from 'react';
import { FilterSelect } from '@/components/filters/FilterSelect';
import { PeriodFilterSelect } from '@/components/filters/PeriodFilterSelect';
import { PopoverContent } from '@/components/ui/popover';
import type { PeriodFilter } from '@/features/dashboard/hooks/useDashboardMetrics';
import { NO_PRODUCT } from './reportDrilldown';

interface ReportFilters {
  period: PeriodFilter;
  ownerId: string;
  productId: string;
}

interface ReportFiltersPopoverProps {
  filters: ReportFilters;
  owners: { id: string; name: string }[];
  products: { value: string; label: string }[];
  onApply: (filters: ReportFilters) => void;
  onClose: () => void;
}

// Mounted only while open: each opening starts with the currently applied filters.
export function ReportFiltersPopover({ filters, owners, products, onApply, onClose }: ReportFiltersPopoverProps) {
  const [draft, setDraft] = useState(filters);

  return (
    <PopoverContent align="end" sideOffset={8} collisionPadding={12} aria-label="Filtros do relatório"
      className="z-[10001] w-[380px] max-w-[calc(100vw-24px)] max-h-[var(--radix-popover-content-available-height)] overflow-y-auto rounded-xl border-slate-200 p-3 shadow-xl dark:border-white/15 dark:bg-dark-card">
      <form onSubmit={event => { event.preventDefault(); onApply(draft); }}>
        <div className="grid grid-cols-[76px_minmax(0,1fr)] items-center gap-3 border-b border-slate-200/70 py-2 dark:border-white/10">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Período</p>
          <PeriodFilterSelect className="min-w-0" value={draft.period} onChange={period => setDraft(current => ({ ...current, period }))} />
        </div>
        <div className="grid grid-cols-[76px_minmax(0,1fr)] items-center gap-3 border-b border-slate-200/70 py-2 dark:border-white/10">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Vendedor</p>
          <FilterSelect label="Filtrar por Vendedor" value={draft.ownerId}
            onChange={ownerId => setDraft(current => ({ ...current, ownerId }))}
            options={[{ value: '', label: 'Todos os vendedores' }, ...owners.map(owner => ({ value: owner.id, label: owner.name }))]} />
        </div>
        <div className="grid grid-cols-[76px_minmax(0,1fr)] items-center gap-3 border-b border-slate-200/70 py-2 dark:border-white/10">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Produto</p>
          <FilterSelect label="Filtrar por Produto" value={draft.productId}
            onChange={productId => setDraft(current => ({ ...current, productId }))}
            options={[{ value: '', label: 'Todos os produtos' }, { value: NO_PRODUCT, label: 'Sem produto' }, ...products]} />
        </div>
        <div className="flex justify-end gap-2 pt-3">
          <button type="button" onClick={onClose} className="min-h-11 rounded-xl px-4 text-sm font-medium text-slate-600 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-slate-300 dark:hover:bg-white/5">Cancelar</button>
          <button type="submit" className="min-h-11 rounded-xl bg-primary-600 px-5 text-sm font-semibold text-white hover:bg-primary-700 focus-visible:ring-2 focus-visible:ring-primary-500">Aplicar filtros</button>
        </div>
      </form>
    </PopoverContent>
  );
}
