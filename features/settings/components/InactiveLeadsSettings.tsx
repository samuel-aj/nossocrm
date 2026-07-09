'use client';

import React from 'react';
import { Archive } from 'lucide-react';
import { useOrgPreferences } from '@/lib/query/hooks';
import { useToast } from '@/context/ToastContext';

/**
 * Configuração da etapa "Inativos" (opcional por organização).
 * Ligada: o Kanban ganha a coluna INATIVOS pra guardar leads sem resposta;
 * cada lead é devolvido automaticamente ao funil após 30 dias (com notificação).
 */
export function InactiveLeadsSettings() {
  const { inactiveLeadsEnabled, isLoading, setInactiveLeadsEnabled } = useOrgPreferences();
  const { addToast } = useToast();

  const handleToggle = (enabled: boolean) => {
    setInactiveLeadsEnabled.mutate(enabled, {
      onSuccess: () =>
        addToast(enabled ? 'Etapa Inativos habilitada!' : 'Etapa Inativos desabilitada.', 'success'),
      onError: (e) => addToast((e as Error).message, 'error'),
    });
  };

  return (
    <div className="mb-12">
      <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-1 flex items-center gap-2">
              <Archive size={18} className="text-slate-400" /> Etapa Inativos
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Adiciona a coluna <span className="font-semibold">Inativos</span> no Kanban para guardar
              leads que não respondem. Cada lead é <span className="font-semibold">devolvido
              automaticamente ao funil após 30 dias</span>, com notificação avisando a devolução.
            </p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer shrink-0 mt-1">
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
        </div>
      </div>
    </div>
  );
}

export default InactiveLeadsSettings;
