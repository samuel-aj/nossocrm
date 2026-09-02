'use client';

import React from 'react';
import { Sparkles } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useCRM } from '@/context/CRMContext';
import { UserRole } from '@/types/constants';
import { AIConfigSection } from './components/AIConfigSection';
import { AIFeaturesSection } from './components/AIFeaturesSection';
import { SettingsCard, SettingsHeader, SettingsRow } from './components/SettingsUi';

/**
 * Central de IA, por finalidade: ativação na organização, provedor e modelo
 * (chaves, modelo, opções do modelo) e recursos de IA (o que cada função usa).
 * `embedded`: renderizada dentro de "IA e Automações" (sem o cabeçalho próprio).
 */
export const AICenterSettings: React.FC<{ embedded?: boolean }> = ({ embedded = false }) => {
  const { profile } = useAuth();
  const { aiOrgEnabled, setAiOrgEnabled } = useCRM();
  const isAdmin = profile?.role === UserRole.ADMIN || profile?.role === UserRole.SUPER_ADMIN;

  return (
    <div className={embedded ? 'space-y-8' : 'pb-10 space-y-8'}>
      {!embedded ? (
        <SettingsHeader title="Central de I.A" description="Provedor, modelo e os recursos de IA usados no sistema." />
      ) : null}

      <SettingsCard
        title="IA na organização"
        description="Desligada, nenhum recurso de IA fica disponível para a equipe."
        icon={Sparkles}
      >
        <SettingsRow
          title={aiOrgEnabled ? 'Ativa' : 'Desligada'}
          description={!isAdmin ? 'Apenas administradores podem alterar.' : undefined}
          control={
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={aiOrgEnabled}
                onChange={(e) => setAiOrgEnabled(e.target.checked)}
                disabled={!isAdmin}
                className="sr-only peer"
                aria-label="Ativar IA na organização"
              />
              <div className="w-11 h-6 bg-slate-200 dark:bg-slate-700 rounded-full peer peer-checked:bg-green-500 dark:peer-checked:bg-green-600 peer-disabled:opacity-50 transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-transform peer-checked:after:translate-x-5" />
            </label>
          }
        />
      </SettingsCard>

      <section aria-labelledby="ai-provider-title">
        <div className="mb-3">
          <h2 id="ai-provider-title" className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Provedor e modelo
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Chaves, modelo padrão e opções do provedor.</p>
        </div>
        <AIConfigSection />
      </section>

      <section aria-labelledby="ai-features-title">
        <div className="mb-3">
          <h2 id="ai-features-title" className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Recursos de IA
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">O que cada função do CRM pode fazer com a IA.</p>
        </div>
        <AIFeaturesSection />
      </section>
    </div>
  );
};
