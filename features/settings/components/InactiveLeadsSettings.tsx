'use client';

import React from 'react';
import { useOrgPreferences } from '@/lib/query/hooks';
import { useToast } from '@/context/ToastContext';
import { SettingsRow } from './SettingsUi';

/**
 * Configuração da etapa "Inativos" (opcional por organização).
 * Ligada: o Kanban ganha a coluna INATIVOS pra guardar leads sem resposta;
 * cada lead é devolvido automaticamente ao funil após 30 dias (com notificação).
 * Renderizada como uma linha (dentro de "Configurações avançadas" do CRM).
 */
export function InactiveLeadsSettings() {
  const { inactiveLeadsEnabled, isLoading, setInactiveLeadsEnabled } = useOrgPreferences();
  const { addToast } = useToast();

  const handleToggle = (enabled: boolean) => {
    setInactiveLeadsEnabled.mutate(enabled, {
      onSuccess: () => addToast(enabled ? 'Etapa Inativos habilitada!' : 'Etapa Inativos desabilitada.', 'success'),
      onError: (e) => addToast((e as Error).message, 'error'),
    });
  };

  return (
    <SettingsRow
      title="Etapa Inativos no Kanban"
      description="Coluna para leads sem resposta. Cada lead volta ao funil sozinho após 30 dias, com notificação."
      control={
        <label className="relative inline-flex items-center cursor-pointer shrink-0">
          <input
            type="checkbox"
            checked={inactiveLeadsEnabled}
            disabled={isLoading || setInactiveLeadsEnabled.isPending}
            onChange={(e) => handleToggle(e.target.checked)}
            className="sr-only peer"
            aria-label="Habilitar etapa Inativos"
          />
          <div className="w-11 h-6 bg-slate-200 dark:bg-slate-700 rounded-full peer peer-checked:bg-primary-600 peer-disabled:opacity-50 transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-transform peer-checked:after:translate-x-5" />
        </label>
      }
    />
  );
}

export default InactiveLeadsSettings;
