import React, { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useSettingsController } from './hooks/useSettingsController';
import { TagsManager } from './components/TagsManager';
import { InactiveLeadsSettings } from './components/InactiveLeadsSettings';
import { LossReasonsSettings } from './components/LossReasonsSettings';
import { CustomFieldsManager } from './components/CustomFieldsManager';
import { ApiKeysSection } from './components/ApiKeysSection';
import { WebhooksSection } from './components/WebhooksSection';
import { McpSection } from './components/McpSection';
import { DataStorageSettings } from './components/DataStorageSettings';
import AppearanceSettings from './components/AppearanceSettings';
import { ProductsCatalogManager } from './components/ProductsCatalogManager';
import { UserRole } from '@/types/constants';
import { AICenterSettings } from './AICenterSettings';

import { UsersPage } from './UsersPage';
import { LeadDistributionSettings } from './LeadDistributionSettings';
import { useAuth } from '@/context/AuthContext';
import { WaAgentsSettings } from '@/features/wa-agents/WaAgentsSettings';
import { useRouter } from 'next/navigation';
import { Settings as SettingsIcon, Users, Database, Sparkles, Plug, Package, Shuffle, Bot, Palette, UserRound, ChevronRight } from 'lucide-react';

type SettingsTab = 'general' | 'appearance' | 'profile' | 'products' | 'integrations' | 'ai' | 'data' | 'users' | 'distribution' | 'agents';

interface GeneralSettingsProps {
  hash?: string;
  isAdmin: boolean;
}

const GeneralSettings: React.FC<GeneralSettingsProps> = ({ hash, isAdmin }) => {
  const controller = useSettingsController();
  const { profile } = useAuth();
  const organizationName = profile?.organization_name || 'Não definido';

  // Scroll to hash element (e.g., #ai-config)
  useEffect(() => {
    if (hash) {
      const elementId = hash.slice(1); // Remove #
      setTimeout(() => {
        const element = document.getElementById(elementId);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 100);
    }
  }, [hash]);


  return (
    <div className="pb-10">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900 dark:text-white font-display tracking-tight">Geral</h1>
        <p className="text-slate-500 dark:text-slate-400 mt-2 text-lg">Escritório, preferências de início e cadastros do funil.</p>
      </div>
      {/* Office Name (read-only, managed by agency) */}
      <div className="mb-8">
        <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl p-6">
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">Nome do Escritório</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
            Definido pela agência. Aparece na sidebar e na identidade do sistema.
          </p>
          <div className="px-4 py-2.5 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-xl w-fit min-w-[200px]">
            <span className="text-slate-900 dark:text-white font-medium">{organizationName}</span>
          </div>
        </div>
      </div>

      {/* General Settings */}
      <div className="mb-12">
        <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl p-6">
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">Página Inicial</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
            Escolha qual tela deve abrir quando você iniciar o CRM.
          </p>
          <select
            aria-label="Selecionar página inicial"
            value={controller.defaultRoute}
            onChange={(e) => controller.setDefaultRoute(e.target.value)}
            className="w-full max-w-xs px-4 py-2.5 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 text-slate-900 dark:text-white transition-all"
          >
            <option value="/dashboard">Dashboard</option>
            <option value="/inbox-list">Inbox (Lista)</option>
            <option value="/inbox-focus">Inbox (Foco)</option>
            <option value="/boards">Boards (Kanban)</option>
            <option value="/contacts">Contatos</option>
            <option value="/activities">Atividades</option>
            <option value="/reports">Relatórios</option>
          </select>
        </div>
      </div>

      {isAdmin && (
        <>
          <div className="mb-4 mt-2">
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Leads e funil</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              Regras e cadastros que valem para todos os quadros da organização.
            </p>
          </div>
          <InactiveLeadsSettings />

          <LossReasonsSettings />

          <TagsManager
            availableTags={controller.availableTags}
            newTagName={controller.newTagName}
            setNewTagName={controller.setNewTagName}
            onAddTag={controller.handleAddTag}
            onRemoveTag={controller.removeTag}
          />

          <CustomFieldsManager
            customFieldDefinitions={controller.customFieldDefinitions}
            newFieldLabel={controller.newFieldLabel}
            setNewFieldLabel={controller.setNewFieldLabel}
            newFieldType={controller.newFieldType}
            setNewFieldType={controller.setNewFieldType}
            newFieldOptions={controller.newFieldOptions}
            setNewFieldOptions={controller.setNewFieldOptions}
            newFieldGroup={controller.newFieldGroup}
            setNewFieldGroup={controller.setNewFieldGroup}
            existingFieldGroups={controller.existingFieldGroups}
            editingId={controller.editingId}
            onStartEditing={controller.startEditingField}
            onCancelEditing={controller.cancelEditingField}
            onSaveField={controller.handleSaveField}
            onRemoveField={controller.removeCustomField}
            onCreateGroup={controller.handleCreateGroup}
            onRemoveGroup={controller.handleRemoveGroup}
            onMoveFieldToGroup={controller.handleMoveFieldToGroup}
          />
        </>
      )}

    </div>
  );
};

const ProductsSettings: React.FC = () => {
  return (
    <div className="pb-10">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900 dark:text-white font-display tracking-tight">Produtos e serviços</h1>
        <p className="text-slate-500 dark:text-slate-400 mt-2 text-lg">O catálogo que entra nos leads e nas ações dos agentes.</p>
      </div>
      <ProductsCatalogManager />
    </div>
  );
};

const IntegrationsSettings: React.FC = () => {
  // A conexão do WhatsApp saiu daqui: agora é a página Conexão, no grupo
  // WhatsApp do menu lateral (junto de Chats e Modelos).
  type IntegrationsSubTab = 'api' | 'webhooks' | 'mcp';
  const [subTab, setSubTab] = useState<IntegrationsSubTab>('api');

  useEffect(() => {
    const syncFromHash = () => {
    const h = typeof window !== 'undefined' ? (window.location.hash || '').replace('#', '') : '';
    if (h === 'webhooks' || h === 'api' || h === 'mcp') setSubTab(h as IntegrationsSubTab);
    };

    syncFromHash();

    if (typeof window !== 'undefined') {
      window.addEventListener('hashchange', syncFromHash);
      return () => window.removeEventListener('hashchange', syncFromHash);
    }
  }, []);

  const setSubTabAndHash = (t: IntegrationsSubTab) => {
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
        <h1 className="text-3xl font-bold text-slate-900 dark:text-white font-display tracking-tight">Integrações</h1>
        <p className="text-slate-500 dark:text-slate-400 mt-2 text-lg">Chaves de API, webhooks e MCP para ligar o CRM a outros sistemas.</p>
      </div>
      <div className="flex items-center gap-2 mb-6">
        {([
          { id: 'api' as const, label: 'API' },
          { id: 'webhooks' as const, label: 'Webhooks' },
          { id: 'mcp' as const, label: 'MCP' },
        ] as const).map((t) => {
          const active = subTab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setSubTabAndHash(t.id)}
              className={`px-3 py-2 rounded-xl text-sm font-semibold border transition-colors ${
                active
                  ? 'border-primary-500/50 bg-primary-500/10 text-primary-700 dark:text-primary-300'
                  : 'border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10'
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {subTab === 'api' && <ApiKeysSection />}
      {subTab === 'webhooks' && <WebhooksSection />}
      {subTab === 'mcp' && <McpSection />}
    </div>
  );
};

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

  // Get hash from URL for scrolling
  const hash = typeof window !== 'undefined' ? window.location.hash : '';

  // Determine tab from pathname if available
  useEffect(() => {
    if (pathname?.includes('/settings/agentes')) {
      setActiveTab('agents');
    } else if (pathname?.includes('/settings/ai')) {
      setActiveTab('ai');
    } else if (pathname?.includes('/settings/products')) {
      setActiveTab('products');
    } else if (pathname?.includes('/settings/integracoes')) {
      setActiveTab('integrations');
    } else if (pathname?.includes('/settings/data')) {
      setActiveTab('data');
    } else if (pathname?.includes('/settings/aparencia')) {
      setActiveTab('appearance');
    } else if (pathname?.includes('/settings/users')) {
      setActiveTab('users');
    } else if (pathname?.includes('/settings/distribuicao')) {
      setActiveTab('distribution');
    } else {
      setActiveTab('general');
    }
  }, [pathname]);

  const isAdminOrSuper = profile?.role === UserRole.ADMIN || profile?.role === UserRole.SUPER_ADMIN;
  const router = useRouter();

  type NavItem = { id: SettingsTab; name: string; icon: React.ElementType; hint?: string; href?: string };
  type NavGroup = { label: string; items: NavItem[] };

  // Grupos por afinidade: pessoal, organização, IA, conexões e sistema.
  // As funções não mudaram; só a ordem e o agrupamento.
  const groups: NavGroup[] = [
    {
      label: 'Pessoal',
      items: [
        { id: 'appearance', name: 'Aparência', icon: Palette, hint: 'Modo e tema' },
        { id: 'profile', name: 'Perfil', icon: UserRound, hint: 'Seus dados', href: '/profile' },
      ],
    },
    {
      label: 'Organização',
      items: [
        { id: 'general', name: 'Geral', icon: SettingsIcon, hint: 'Escritório e funil' },
        ...(isAdminOrSuper ? [{ id: 'users' as SettingsTab, name: 'Equipe', icon: Users, hint: 'Membros e permissões' }] : []),
        ...(isAdminOrSuper ? [{ id: 'distribution' as SettingsTab, name: 'Distribuição de leads', icon: Shuffle, hint: 'Quem recebe cada lead' }] : []),
        ...(isAdminOrSuper ? [{ id: 'products' as SettingsTab, name: 'Produtos e serviços', icon: Package, hint: 'Catálogo' }] : []),
      ],
    },
    {
      label: 'Inteligência artificial',
      items: [
        { id: 'ai', name: 'Central de I.A', icon: Sparkles, hint: 'Provedor, modelo e prompts' },
        // Automações (robôs + agente de IA) vale para qualquer admin: o robô é
        // liberado pra todos e o agente aparece bloqueado até o super admin soltar.
        ...(isAdminOrSuper ? [{ id: 'agents' as SettingsTab, name: 'Automações', icon: Bot, hint: 'Agentes e robôs' }] : []),
      ],
    },
    ...(isAdminOrSuper
      ? [
          {
            label: 'Conexões',
            items: [{ id: 'integrations' as SettingsTab, name: 'Integrações', icon: Plug, hint: 'API, webhooks e MCP' }],
          },
        ]
      : []),
    {
      label: 'Sistema',
      items: [{ id: 'data', name: 'Dados', icon: Database, hint: 'Armazenamento e exportação' }],
    },
  ];
  const allItems = groups.flatMap((g) => g.items);

  const go = (item: NavItem) => {
    if (item.href) {
      router.push(item.href);
      return;
    }
    setActiveTab(item.id);
  };

  const renderContent = () => {
    switch (activeTab) {
      case 'agents':
        return <WaAgentsSettings />;
      case 'appearance':
        return <AppearanceSettings />;
      case 'products':
        return <ProductsSettings />;
      case 'integrations':
        return <IntegrationsSettings />;
      case 'ai':
        return <AICenterSettings />;
      case 'data':
        return <DataStorageSettings />;
      case 'users':
        return <UsersPage />;
      case 'distribution':
        return <LeadDistributionSettings />;
      default:
        return <GeneralSettings hash={hash} isAdmin={isAdminOrSuper} />;
    }
  };

  const itemClass = (active: boolean) =>
    `group relative w-full flex items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors focus-visible-ring ${
      active
        ? 'bg-primary-500/10 text-primary-700 dark:text-primary-300 font-medium'
        : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 hover:text-slate-900 dark:hover:text-white'
    }`;

  return (
    <div className="max-w-6xl mx-auto">
      {/* Celular: fileira rolável, uma linha, na ordem dos grupos */}
      <div
        className="md:hidden flex items-center gap-1 mb-6 border-b border-slate-200 dark:border-white/10 overflow-x-auto scrollbar-none"
        role="tablist"
        aria-label="Seções das configurações"
      >
        {allItems.map((item) => {
          const isActive = !item.href && activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => go(item)}
              className={`relative flex items-center gap-2 px-3 py-3 text-sm font-medium transition-colors shrink-0 whitespace-nowrap ${
                isActive ? 'text-primary-600 dark:text-primary-400' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
              }`}
            >
              <item.icon className="h-4 w-4" aria-hidden="true" />
              {item.name}
              {isActive && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary-600 dark:bg-primary-400 rounded-full" />}
            </button>
          );
        })}
      </div>

      <div className="md:grid md:grid-cols-[15rem_minmax(0,1fr)] md:gap-10">
        {/* Desktop: navegação lateral em grupos */}
        <nav className="hidden md:block md:sticky md:top-4 self-start space-y-6" aria-label="Seções das configurações">
          {groups.map((g) => (
            <div key={g.label}>
              <p className="px-3 mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">{g.label}</p>
              <ul className="space-y-0.5">
                {g.items.map((item) => {
                  const isActive = !item.href && activeTab === item.id;
                  return (
                    <li key={item.id}>
                      <button type="button" aria-current={isActive ? 'page' : undefined} onClick={() => go(item)} className={itemClass(isActive)}>
                        <span
                          className={`absolute left-0 top-1/2 -translate-y-1/2 h-5 w-0.5 rounded-full bg-primary-600 dark:bg-primary-400 transition-opacity ${
                            isActive ? 'opacity-100' : 'opacity-0'
                          }`}
                          aria-hidden="true"
                        />
                        <item.icon className={`h-4 w-4 shrink-0 ${isActive ? 'text-primary-600 dark:text-primary-400' : 'text-slate-400 dark:text-slate-500 group-hover:text-slate-600 dark:group-hover:text-slate-300'}`} aria-hidden="true" />
                        <span className="flex-1 min-w-0">
                          <span className="block truncate">{item.name}</span>
                          {item.hint ? <span className="block text-[11px] font-normal text-slate-400 dark:text-slate-500 truncate">{item.hint}</span> : null}
                        </span>
                        {item.href ? <ChevronRight className="h-3.5 w-3.5 text-slate-300 dark:text-slate-600" aria-hidden="true" /> : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        {/* Conteúdo */}
        <div className="min-w-0">{renderContent()}</div>
      </div>
    </div>
  );
};

export default SettingsPage;

