'use client';

import React from 'react';
import { useOrgPreferences, type DealStatusFilter } from '@/lib/query/hooks';
import { useToast } from '@/context/ToastContext';
import { SettingsRow } from './SettingsUi';

/**
 * Filtro de status com que o QUADRO ABRE (antes era sempre "Em aberto").
 * Vale para a organização inteira; quem trocar o filtro no cabeçalho do quadro
 * continua mandando na própria sessão, e um link com ?status= também tem
 * prioridade sobre esta escolha.
 */
const OPCOES: Array<{ value: DealStatusFilter; label: string; hint: string }> = [
  { value: 'open', label: 'Em aberto', hint: 'Só os negócios em andamento (padrão do sistema).' },
  { value: 'won', label: 'Ganhos', hint: 'Abre mostrando os negócios ganhos.' },
  { value: 'lost', label: 'Perdidos', hint: 'Abre mostrando os negócios perdidos.' },
  { value: 'all', label: 'Todos', hint: 'Abre com tudo: em aberto, ganhos e perdidos.' },
];

export function DefaultStatusFilterSettings() {
  const { defaultDealStatusFilter, isLoading, setDefaultDealStatusFilter } = useOrgPreferences();
  const { addToast } = useToast();
  const atual = defaultDealStatusFilter ?? 'open';

  const handleChange = (value: DealStatusFilter) => {
    setDefaultDealStatusFilter.mutate(value, {
      onSuccess: () =>
        addToast(`O quadro passa a abrir em "${OPCOES.find((o) => o.value === value)?.label}".`, 'success'),
      onError: (e) => addToast((e as Error).message, 'error'),
    });
  };

  return (
    <SettingsRow
      title="Filtro com que o quadro abre"
      description={OPCOES.find((o) => o.value === atual)?.hint}
      control={
        <select
          value={atual}
          disabled={isLoading || setDefaultDealStatusFilter.isPending}
          onChange={(e) => handleChange(e.target.value as DealStatusFilter)}
          aria-label="Filtro com que o quadro abre"
          className="px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500 outline-none disabled:opacity-50"
        >
          {OPCOES.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      }
    />
  );
}

export default DefaultStatusFilterSettings;
