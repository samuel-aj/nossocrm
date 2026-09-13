import React, { useState } from 'react';
import { FilterSelect } from '@/components/filters/FilterSelect';
import { PeriodFilterSelect } from '@/components/filters/PeriodFilterSelect';
import { Modal } from '@/components/ui/Modal';
import type { PeriodFilter } from '@/features/dashboard/hooks/useDashboardMetrics';
import { NO_PRODUCT } from './reportDrilldown';

interface ReportFilters {
  period: PeriodFilter;
  ownerId: string;
  productId: string;
}

interface ReportFiltersDrawerProps {
  filters: ReportFilters;
  owners: { id: string; name: string }[];
  products: { value: string; label: string }[];
  onApply: (filters: ReportFilters) => void;
  onClose: () => void;
}

// Mounted only while open: each opening starts with the currently applied filters.
export function ReportFiltersDrawer({ filters, owners, products, onApply, onClose }: ReportFiltersDrawerProps) {
  const [draft, setDraft] = useState(filters);

  return (
    <Modal isOpen onClose={onClose} title="Filtros do relatório" size="md"
      className="fixed inset-y-0 right-0 h-dvh max-h-none sm:max-h-none rounded-none sm:rounded-none animate-none"
      bodyClassName="flex flex-1 flex-col">
      <form className="flex flex-1 flex-col gap-6" onSubmit={event => { event.preventDefault(); onApply(draft); }}>
        <p className="text-sm text-slate-500 dark:text-slate-400">Escolha os filtros e aplique para atualizar o relatório.</p>
        <div className="space-y-2">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Período</p>
          <PeriodFilterSelect value={draft.period} onChange={period => setDraft(current => ({ ...current, period }))} />
        </div>
        <div className="space-y-2">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Vendedor</p>
          <FilterSelect label="Filtrar por Vendedor" value={draft.ownerId}
            onChange={ownerId => setDraft(current => ({ ...current, ownerId }))}
            options={[{ value: '', label: 'Todos os vendedores' }, ...owners.map(owner => ({ value: owner.id, label: owner.name }))]} />
        </div>
        <div className="space-y-2">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Produto</p>
          <FilterSelect label="Filtrar por Produto" value={draft.productId}
            onChange={productId => setDraft(current => ({ ...current, productId }))}
            options={[{ value: '', label: 'Todos os produtos' }, { value: NO_PRODUCT, label: 'Sem produto' }, ...products]} />
        </div>
        <div className="mt-auto flex justify-end gap-3 border-t border-slate-200 pt-5 pb-[env(safe-area-inset-bottom)] dark:border-white/10">
          <button type="button" onClick={onClose} className="min-h-11 rounded-xl px-4 text-sm font-medium text-slate-600 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-slate-300 dark:hover:bg-white/5">Cancelar</button>
          <button type="submit" className="min-h-11 rounded-xl bg-primary-600 px-5 text-sm font-semibold text-white hover:bg-primary-700 focus-visible:ring-2 focus-visible:ring-primary-500">Aplicar filtros</button>
        </div>
      </form>
    </Modal>
  );
}
