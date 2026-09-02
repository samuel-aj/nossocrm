'use client';

/**
 * Configurações do CRM. As categorias ficam no TOPO (sem sidebar interna):
 * Geral (com Aparência) | CRM | Produtos/Serviços | IA e Automações |
 * Integrações | Equipe | Distribuição | Dados. Cada categoria só reorganiza o que
 * já existia; as rotas antigas (/settings/ai, /settings/agentes,
 * /settings/integracoes, /settings/products) e os hashes continuam valendo.
 */
import React, { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useSettingsController } from './hooks/useSettingsController';
import { ApiKeysSection } from './components/ApiKeysSection';
import { WebhooksSection } from './components/WebhooksSection';
import { McpSection } from './components/McpSection';
import { DataStorageSettings } from './components/DataStorageSettings';
import AppearanceSettings from './components/AppearanceSettings';
import { ProductsCatalogManager } from './components/ProductsCatalogManager';
import { UserRole } from '@/types/constants';
import { UsersPage } from './UsersPage';
import { LeadDistributionSettings } from './LeadDistributionSettings';
import { CrmSettings } from './CrmSettings';
import { AiAutomationsSettings, type AiSubTab } from './AiAutomationsSettings';
import { useAuth } from '@/context/AuthContext';
import { SETTINGS_INPUT_CLASS, SettingsCard, SettingsHeader, SettingsRow, SubTabs } from './components/SettingsUi';
import {
  Settings as SettingsIcon,
  Users,
  Database,
  Sparkles,
  Plug,
  Package,
  Shuffle,
  KanbanSquare,
  Webhook,
  KeyRound,
  Cable,
  Building2,
  Compass,
} from 'lucide-react';

type SettingsTab = 'general' | 'crm' | 'distribution' | 'users' | 'products' | 'ai' | 'integrations' | 'data';

// ---------------------------------------------------------------- Geral

const GeneralSettings: React.FC = () => {
  const controller = useSettingsController();
  const { profile } = useAuth();
  const organizationName = profile?.organization_name || 'Não definido';

  return (
    <div className="pb-10 space-y-6">
      <SettingsHeader title="Geral" description="O básico da organização, a sua navegação e a aparência do CRM para você." />
      <SettingsCard title="Escritório" icon={Building2}>
        <SettingsRow
          title="Nome do escritório"
          description="Definido pela agência. Aparece na sidebar e na identidade do sistema."
          control={
            <span className="inline-flex items-center rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/20 px-3 py-1.5 text-sm font-medium text-slate-900 dark:text-white">
              {organizationName}
            </span>
          }
        />
      </SettingsCard>
      <SettingsCard title="Navegação" icon={Compass}>
        <SettingsRow
          title="Página inicial"
          description="A tela que abre quando você entra no CRM."
          control={
            <select
              aria-label="Selecionar página inicial"
              value={controller.defaultRoute}
              onChange={(e) => controller.setDefaultRoute(e.target.value)}
              className={`${SETTINGS_INPUT_CLASS} w-56`}
            >
              <option value="/dashboard">Dashboard</option>
              <option value="/inbox-list">Inbox (Lista)</option>
              <option value="/inbox-focus">Inbox (Foco)</option>
              <option value="/boards">Boards (Kanban)</option>
              <option value="/contacts">Contatos</option>
              <option value="/activities">Atividades</option>
              <option value="/reports">Relatórios</option>
            </select>
          }
        />
      </SettingsCard>
      <AppearanceSettings embedded />
    </div>
  );
};

// ---------------------------------------------------------------- Produtos

const ProductsSettings: React.FC = () => (
  <div className="pb-10">
    <SettingsHeader title="Produtos e serviços" description="O catálogo que entra nos leads e nas ações dos agentes." />
    <ProductsCatalogManager />
  </div>
);

// ---------------------------------------------------------------- Integrações

type IntegrationsSubTab = 'webhooks' | 'api' | 'mcp';

const IntegrationsSettings: React.FC = () => {
  const [subTab, setSubTab] = useState<IntegrationsSubTab>('webhooks');

  useEffect(() => {
    const syncFromHash = () => {
      const h = (window.location.hash || '').replace('#', '');
      if (h === 'webhooks' || h === 'api' || h === 'mcp') setSubTab(h);
    };
    syncFromHash();
    window.addEventListener('hashchange', syncFromHash);
    return () => window.removeEventListener('hashchange', syncFromHash);
  }, []);

  const go = (t: IntegrationsSubTab) => {
    setSubTab(t);
    const url = new URL(window.location.href);
    url.hash = `#${t}`;
    window.history.replaceState({}, '', url.toString());
  };

  return (
    <div className="pb-10">
      <SettingsHeader title="Integrações" description="Webhooks, chaves da API e MCP para ligar o CRM a outros sistemas." />
      <SubTabs
        ariaLabel="Seções de Integrações"
        value={subTab}
        onChange={go}
        tabs={[
          { id: 'webhooks', label: 'Webhooks', icon: Webhook },
          { id: 'api', label: 'API e chaves', icon: KeyRound },
          { id: 'mcp', label: 'MCP', icon: Cable },
        ]}
      />
      {subTab === 'webhooks' && <WebhooksSection />}
      {subTab === 'api' && <ApiKeysSection />}
      {subTab === 'mcp' && <McpSection />}
    </div>
  );
};

// ---------------------------------------------------------------- Dados

const DataSettings: React.FC = () => (
  <div className="pb-10">
    <SettingsHeader title="Dados" description="Armazenamento, importação, exportação e limpeza." />
    <DataStorageSettings />
  </div>
);

// ---------------------------------------------------------------- Página

interface SettingsPageProps {
  tab?: SettingsTab;
}

/**
 * Componente React `SettingsPage`.
 *
 * @param {SettingsPageProps} { tab: initialTab } - Parâmetro `{ tab: initialTab }`.
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
const SettingsPage: React.FC<SettingsPageProps> = ({ tab: initialTab }) => {
  const { profile } = useAuth();
  const pathname = usePathname();
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab || 'general');
  const [aiSub, setAiSub] = useState<AiSubTab>('agentes');

  // Rotas antigas continuam levando à mesma tela
  useEffect(() => {
    if (pathname?.includes('/settings/agentes')) {
      setActiveTab('ai');
      setAiSub('agentes');
    } else if (pathname?.includes('/settings/ai')) {
      setActiveTab('ai');
      setAiSub('central');
    } else if (pathname?.includes('/settings/products')) {
      setActiveTab('products');
    } else if (pathname?.includes('/settings/integracoes')) {
      setActiveTab('integrations');
    } else if (pathname?.includes('/settings/data')) {
      setActiveTab('data');
    } else if (pathname?.includes('/settings/users')) {
      setActiveTab('users');
    } else if (pathname?.includes('/settings/distribuicao')) {
      setActiveTab('distribution');
    } else if (pathname?.includes('/settings/crm')) {
      setActiveTab('crm');
    } else {
      setActiveTab('general');
    }
  }, [pathname]);

  // Links com âncora (ex.: /settings/ai#ai-config) rolam até a seção depois de renderizar
  useEffect(() => {
    const hash = (window.location.hash || '').replace('#', '');
    if (!hash) return;
    const t = window.setTimeout(() => {
      const el = document.getElementById(hash);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 150);
    return () => window.clearTimeout(t);
  }, [activeTab]);

  const isAdminOrSuper = profile?.role === UserRole.ADMIN || profile?.role === UserRole.SUPER_ADMIN;

  const tabs: Array<{ id: SettingsTab; name: string; icon: typeof SettingsIcon }> = [
    { id: 'general', name: 'Geral', icon: SettingsIcon },
    ...(isAdminOrSuper ? [{ id: 'crm' as const, name: 'CRM', icon: KanbanSquare }] : []),
    ...(isAdminOrSuper ? [{ id: 'products' as const, name: 'Produtos/Serviços', icon: Package }] : []),
    { id: 'ai', name: 'IA e Automações', icon: Sparkles },
    ...(isAdminOrSuper ? [{ id: 'integrations' as const, name: 'Integrações', icon: Plug }] : []),
    ...(isAdminOrSuper ? [{ id: 'users' as const, name: 'Equipe', icon: Users }] : []),
    ...(isAdminOrSuper ? [{ id: 'distribution' as const, name: 'Distribuição', icon: Shuffle }] : []),
    { id: 'data', name: 'Dados', icon: Database },
  ];

  const renderContent = () => {
    switch (activeTab) {
      case 'crm':
        return <CrmSettings />;
      case 'distribution':
        return <LeadDistributionSettings />;
      case 'users':
        return <UsersPage />;
      case 'products':
        return <ProductsSettings />;
      case 'ai':
        return <AiAutomationsSettings initialSub={aiSub} />;
      case 'integrations':
        return <IntegrationsSettings />;
      case 'data':
        return <DataSettings />;
      default:
        return <GeneralSettings />;
    }
  };

  return (
    <div className="max-w-5xl mx-auto">
      {/* Categorias no topo: pílulas com ícone, rolagem horizontal no celular */}
      <nav
        aria-label="Categorias das configurações"
        className="mb-8 -mx-1 px-1 overflow-x-auto scrollbar-none border-b border-slate-200 dark:border-white/10"
      >
        <div role="tablist" className="flex items-center gap-1 pb-2 min-w-max">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setActiveTab(tab.id)}
                className={`relative inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors focus-visible-ring ${
                  isActive
                    ? 'bg-primary-500/10 text-primary-700 dark:text-primary-300'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Icon className={`h-4 w-4 ${isActive ? 'text-primary-600 dark:text-primary-400' : 'text-slate-400 dark:text-slate-500'}`} aria-hidden="true" />
                {tab.name}
                {isActive ? (
                  <span className="absolute -bottom-2 left-2 right-2 h-0.5 rounded-full bg-primary-600 dark:bg-primary-400" aria-hidden="true" />
                ) : null}
              </button>
            );
          })}
        </div>
      </nav>

      {renderContent()}
    </div>
  );
};

export default SettingsPage;
