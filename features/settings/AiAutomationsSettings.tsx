'use client';

/**
 * Configurações → IA e Automações: um grupo só para o que envolve IA.
 * Sub-abas: Agentes de IA | Robôs | Execuções (WaAgentsSettings) e Central de IA
 * (provedor, modelo, prompts e recursos). O hash da URL guarda a sub-aba
 * (#agentes, #robos, #execucoes, #central) e as rotas antigas continuam valendo:
 * /settings/agentes abre em Agentes, /settings/ai abre na Central.
 */
import React, { useEffect, useState } from 'react';
import { Bot, History, Sparkles, Workflow, Lock } from 'lucide-react';
import { useWaAgentsAccess } from '@/hooks/useWaAgentsAccess';
import { Spinner } from '@/features/wa-agents/ui';
import { WaAgentsSettings } from '@/features/wa-agents/WaAgentsSettings';
import { AICenterSettings } from './AICenterSettings';
import { SettingsHeader, SubTabs } from './components/SettingsUi';

export type AiSubTab = 'agentes' | 'robos' | 'execucoes' | 'central';

function isAiSubTab(v: string): v is AiSubTab {
  return v === 'agentes' || v === 'robos' || v === 'execucoes' || v === 'central';
}

export const AiAutomationsSettings: React.FC<{ initialSub?: AiSubTab }> = ({ initialSub = 'agentes' }) => {
  const { agentsApproved, isAdmin, isLoading } = useWaAgentsAccess();
  const [sub, setSub] = useState<AiSubTab>(initialSub);

  useEffect(() => {
    const sync = () => {
      const h = (window.location.hash || '').replace('#', '');
      if (isAiSubTab(h)) setSub(h);
      // Links antigos para a configuração da IA (ex.: /settings/ai#ai-config)
      else if (h === 'ai-config') setSub('central');
    };
    sync();
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);

  useEffect(() => setSub(initialSub), [initialSub]);

  const go = (t: AiSubTab) => {
    setSub(t);
    const url = new URL(window.location.href);
    url.hash = `#${t}`;
    window.history.replaceState({}, '', url.toString());
  };

  const tabs: Array<{ id: AiSubTab; label: string; icon: typeof Bot; badge?: React.ReactNode }> = [
    ...(isAdmin
      ? [
          {
            id: 'agentes' as const,
            label: 'Agentes de IA',
            icon: Bot,
            badge: !agentsApproved ? <Lock size={13} aria-hidden="true" className="text-slate-400" /> : undefined,
          },
          { id: 'robos' as const, label: 'Robôs', icon: Workflow },
          { id: 'execucoes' as const, label: 'Execuções', icon: History },
        ]
      : []),
    { id: 'central' as const, label: 'Central de IA', icon: Sparkles },
  ];
  const effective: AiSubTab = tabs.some((t) => t.id === sub) ? sub : 'central';

  return (
    <div className="pb-10">
      <SettingsHeader
        title="IA e Automações"
        description="Agentes que conversam com o lead, robôs de mensagens e a configuração da inteligência artificial."
      />
      {/* Enquanto o acesso carrega não decidimos a sub-aba: senão a Central de IA
          aparecia por um instante antes de Agentes de IA (o padrão para admin). */}
      {isLoading ? (
        <div className="py-10">
          <Spinner />
        </div>
      ) : (
        <>
          <SubTabs tabs={tabs} value={effective} onChange={go} ariaLabel="Seções de IA e Automações" />
          {effective === 'central' ? <AICenterSettings embedded /> : <WaAgentsSettings embedded tab={effective} />}
        </>
      )}
    </div>
  );
};

export default AiAutomationsSettings;
