'use client';

/**
 * Aba "Agentes" das Configurações: sub-abas Agentes de IA | Robôs | Execuções.
 * A sub-aba fica sincronizada com o hash da URL (#agentes, #robos, #execucoes).
 */
import React, { useEffect, useState } from 'react';
import { Bot, Workflow, History } from 'lucide-react';
import { useWaAgentsBeta } from '@/hooks/useWaAgentsBeta';
import { WaAgentsBetaCard } from './WaAgentsBetaCard';
import { AgentList } from './AgentList';
import { BotList } from './BotList';
import { RunsList } from './RunsList';
import { Notice, Spinner } from './ui';

type SubTab = 'agentes' | 'robos' | 'execucoes';

const SUB_TABS: Array<{ id: SubTab; label: string; icon: React.ComponentType<{ size?: number; className?: string }> }> = [
  { id: 'agentes', label: 'Agentes de IA', icon: Bot },
  { id: 'robos', label: 'Robôs', icon: Workflow },
  { id: 'execucoes', label: 'Execuções', icon: History },
];

function isSubTab(value: string): value is SubTab {
  return value === 'agentes' || value === 'robos' || value === 'execucoes';
}

/**
 * Componente React `WaAgentsSettings`.
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export const WaAgentsSettings: React.FC = () => {
  const { enabled, isAdmin, isLoading } = useWaAgentsBeta();
  const [subTab, setSubTab] = useState<SubTab>('agentes');

  useEffect(() => {
    const syncFromHash = () => {
      const h = typeof window !== 'undefined' ? (window.location.hash || '').replace('#', '') : '';
      if (isSubTab(h)) setSubTab(h);
    };
    syncFromHash();
    if (typeof window !== 'undefined') {
      window.addEventListener('hashchange', syncFromHash);
      return () => window.removeEventListener('hashchange', syncFromHash);
    }
  }, []);

  const setSubTabAndHash = (t: SubTab) => {
    setSubTab(t);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.hash = `#${t}`;
      window.history.replaceState({}, '', url.toString());
    }
  };

  return (
    <div className="pb-10">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900 dark:text-white font-display tracking-tight">
          Agentes de IA e Robôs
        </h1>
        <p className="text-slate-500 dark:text-slate-400 mt-2 text-lg">
          Atendimento automático no WhatsApp: agentes que conversam com o lead e robôs que enviam mensagens por etapa.
        </p>
      </div>

      {isLoading ? (
        <Spinner />
      ) : !enabled ? (
        <div className="space-y-4">
          <Notice tone="amber">
            A versão beta está desligada nesta organização. Ligue abaixo para configurar agentes e robôs.
          </Notice>
          <WaAgentsBetaCard />
        </div>
      ) : !isAdmin ? (
        <Notice tone="blue">Apenas administradores podem configurar agentes e robôs.</Notice>
      ) : (
        <>
          <div className="flex items-center gap-2 mb-6 flex-wrap" role="tablist" aria-label="Seções de Agentes">
            {SUB_TABS.map((t) => {
              const active = subTab === t.id;
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setSubTabAndHash(t.id)}
                  className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-semibold border transition-colors ${
                    active
                      ? 'border-primary-500/50 bg-primary-500/10 text-primary-700 dark:text-primary-300'
                      : 'border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10'
                  }`}
                >
                  <Icon size={16} aria-hidden="true" />
                  {t.label}
                </button>
              );
            })}
          </div>

          {subTab === 'agentes' && <AgentList />}
          {subTab === 'robos' && <BotList />}
          {subTab === 'execucoes' && <RunsList />}
        </>
      )}
    </div>
  );
};

export default WaAgentsSettings;
