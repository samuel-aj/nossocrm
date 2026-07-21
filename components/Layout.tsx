/**
 * @fileoverview Layout Principal da Aplicação
 *
 * Componente de layout que fornece estrutura base para todas as páginas,
 * incluindo sidebar de navegação, header e área de conteúdo.
 *
 * @module components/Layout
 *
 * Recursos de Acessibilidade:
 * - Skip link para navegação por teclado
 * - Navegação com aria-current para página ativa
 * - Ícones decorativos com aria-hidden
 * - Suporte a prefetch em hover/focus
 *
 * @example
 * ```tsx
 * function App() {
 *   return (
 *     <Layout>
 *       <PageContent />
 *     </Layout>
```
 * }
 * ```
 */

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  KanbanSquare,
  Users,
  Settings,
  Sun,
  Moon,
  BarChart3,
  Lightbulb,
  GraduationCap,
  Inbox,
  Sparkles,
  LogOut,
  User,
  Bug,
  CheckSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Shield,
  MessageCircle,
  ChevronDown,
  FileText,
  QrCode,
  HelpCircle,
} from 'lucide-react';
import { useCRM } from '../context/CRMContext';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { prefetchRoute, RouteName } from '@/lib/prefetch';
import { UserRole } from '@/types/constants';

import { isDebugMode, enableDebugMode, disableDebugMode } from '@/lib/debug';
import { usePersistedState } from '@/hooks/usePersistedState';
import { SkipLink } from '@/lib/a11y';
import { useResponsiveMode } from '@/hooks/useResponsiveMode';
import { BottomNav, MoreMenuSheet, NavigationRail } from '@/components/navigation';

// Lazy load AI Assistant (deprecated - using UIChat now)
// const AIAssistant = lazy(() => import('./AIAssistant'));
import { UIChat } from './ai/UIChat';

import { NotificationPopover } from './notifications/NotificationPopover';

/**
 * Props do componente Layout
 * @interface LayoutProps
 * @property {React.ReactNode} children - Conteúdo da página
 */
interface LayoutProps {
  children: React.ReactNode;
}

/**
 * Item de navegação da sidebar
 *
 * @param props - Props do item de navegação
 * @param props.to - Rota de destino
 * @param props.icon - Componente de ícone Lucide
 * @param props.label - Label exibido
 * @param props.prefetch - Nome da rota para prefetch
 * @param props.clickedPath - Path que foi clicado (para manter highlight durante transição)
 * @param props.onItemClick - Callback quando o item é clicado
 */
const NavItem = ({
  to,
  icon: Icon,
  label,
  prefetch,
  clickedPath,
  onItemClick,
  badge,
  collapsed = false,
}: {
  to: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  prefetch?: RouteName;
  clickedPath?: string;
  onItemClick?: (path: string) => void;
  badge?: string;
  /** Menu recolhido: o MESMO markup anima o texto pra fora (sem troca de JSX). */
  collapsed?: boolean;
}) => {
  const pathname = usePathname();
  const isActive = pathname === to || (to === '/boards' && pathname === '/pipeline');
  const wasJustClicked = clickedPath === to;

  // If user clicked on a DIFFERENT item, immediately deactivate this one
  // This prevents the delay showing both items as active
  const anotherItemWasClicked = clickedPath && clickedPath !== to;
  const isActuallyActive = anotherItemWasClicked ? false : (isActive || wasJustClicked);

  return (
    <Link
      href={to}
      onMouseEnter={prefetch ? () => prefetchRoute(prefetch) : undefined}
      onFocus={prefetch ? () => prefetchRoute(prefetch) : undefined}
      onClick={() => onItemClick?.(to)}
      title={collapsed ? label : undefined}
      className={`relative flex items-center py-3 rounded-lg text-sm font-medium focus-visible-ring overflow-hidden
    transition-[padding,gap,background-color,color,border-color] duration-300 ease-in-out
    ${collapsed ? 'px-[13px] gap-0' : 'px-4 gap-3'}
    ${isActuallyActive
          ? 'bg-primary-500/10 text-primary-600 dark:text-primary-400 border border-primary-200 dark:border-primary-900/50'
          : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 hover:text-slate-900 dark:hover:text-white'
        }`}
    >
      <Icon size={20} className={`shrink-0 ${isActuallyActive ? 'text-primary-500' : ''}`} aria-hidden="true" />
      <span
        className={`font-display tracking-wide whitespace-nowrap overflow-hidden transition-[max-width,opacity,transform] duration-300 ease-in-out ${
          collapsed ? 'max-w-0 opacity-0 -translate-x-2' : 'max-w-[9rem] opacity-100 translate-x-0'
        }`}
      >
        {label}
      </span>
      {badge && (
        <span
          className={`ml-auto rounded-full bg-primary-500/15 text-[10px] font-bold uppercase tracking-wide text-primary-600 dark:text-primary-400 whitespace-nowrap overflow-hidden transition-[max-width,opacity,padding] duration-300 ease-in-out ${
            collapsed ? 'max-w-0 opacity-0 px-0 py-0' : 'max-w-[4rem] opacity-100 px-2 py-0.5'
          }`}
        >
          {badge}
        </span>
      )}
      {/* no modo recolhido, o badge vira uma bolinha (crossfade) */}
      {badge && (
        <span
          className={`absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-primary-500 transition-opacity duration-300 ${
            collapsed ? 'opacity-100' : 'opacity-0'
          }`}
          aria-hidden="true"
        />
      )}
    </Link>
  );
};

/**
 * Grupo recolhível do menu lateral (ex.: WhatsApp, Ajuda). No menu compacto
 * os itens aparecem direto (só ícones), sem o cabeçalho do grupo. Abre e
 * fecha com animação de altura (grid-rows 0fr↔1fr) + fade em 300ms.
 */
const NavGroup = ({
  label,
  icon: Icon,
  open,
  onToggle,
  childActive,
  collapsed,
  children,
}: {
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  open: boolean;
  onToggle: () => void;
  /** Alguma rota do grupo está ativa (tinge o cabeçalho quando fechado). */
  childActive: boolean;
  collapsed: boolean;
  children: React.ReactNode;
}) => {
  if (collapsed) return <>{children}</>;
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={`w-full flex items-center px-4 py-3 gap-3 rounded-lg text-sm font-medium transition-colors focus-visible-ring ${
          childActive && !open
            ? 'text-primary-600 dark:text-primary-400'
            : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 hover:text-slate-900 dark:hover:text-white'
        }`}
      >
        <Icon size={20} className={`shrink-0 ${childActive ? 'text-primary-500' : ''}`} aria-hidden="true" />
        <span className="font-display tracking-wide flex-1 text-left">{label}</span>
        <ChevronDown
          size={15}
          className={`shrink-0 transition-transform duration-300 ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>
      <div
        className={`grid transition-[grid-template-rows,opacity] duration-300 ease-in-out ${
          open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
        }`}
        inert={!open}
      >
        <div className="overflow-hidden min-h-0">
          <div className="mt-1 ml-4 pl-2 border-l border-slate-200 dark:border-white/10 space-y-1">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
};


/**
 * Layout principal da aplicação
 *
 * Fornece estrutura com sidebar fixa, header responsivo e área de conteúdo.
 * Inclui navegação, controles de tema e acesso ao assistente de IA.
 *
 * @param {LayoutProps} props - Props do componente
 * @returns {JSX.Element} Estrutura de layout completa
 */
const Layout: React.FC<LayoutProps> = ({ children }) => {
  const { darkMode, toggleDarkMode } = useTheme();
  const { isGlobalAIOpen, setIsGlobalAIOpen, sidebarCollapsed, setSidebarCollapsed } = useCRM();
  const { user, loading, profile, signOut } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const { mode } = useResponsiveMode();
  const isMobile = mode === 'mobile';
  const isTablet = mode === 'tablet';
  const isDesktop = mode === 'desktop';
  const officeName = profile?.organization_name || 'NossoCRM';
  const officeInitials = officeName.split(' ').slice(0, 2).map((w: string) => w[0]).join('').toUpperCase() || 'AJ';
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  // Grupo WhatsApp do menu (Chats/Modelos/Conexão): FECHADO por padrão;
  // aberto/fechado persiste. Chave nova (_v2) pra descartar o valor gravado
  // quando o padrão era aberto.
  const [waGroupOpen, setWaGroupOpen] = usePersistedState<boolean>('nav_group_whatsapp_v2', false);
  // Grupo Ajuda do menu (Sugestões/Tutorial): também fechado por padrão
  const [helpGroupOpen, setHelpGroupOpen] = usePersistedState<boolean>('nav_group_ajuda', false);
  const isAdminRole = profile?.role === UserRole.ADMIN || profile?.role === UserRole.SUPER_ADMIN;
  // Hydration safety: `isDebugMode()` reads localStorage. On SSR it is always false.
  // Initialize deterministically and sync on mount to avoid hydration mismatch warnings.
  const [debugEnabled, setDebugEnabled] = useState(false);

  useEffect(() => {
    setDebugEnabled(isDebugMode());
  }, []);

  // If the user signed out (or session expired), leave protected shell ASAP.
  // This prevents rendering fallbacks like "Usuário" while unauthenticated.
  useEffect(() => {
    if (loading) return;
    if (!user) router.replace('/login');
  }, [loading, user, router]);

  // Expose sidebar width as a global CSS var so modals/overlays can "shrink" on desktop
  // instead of covering the navigation sidebar (works even for portals).
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const width =
      isDesktop ? (sidebarCollapsed ? '5rem' : '16rem')
        : isTablet ? '5rem'
          : '0px';
    document.documentElement.style.setProperty('--app-sidebar-width', width);
  }, [isDesktop, isTablet, sidebarCollapsed]);

  // Cleanup on unmount (e.g. leaving the app shell).
  useEffect(() => {
    return () => {
      if (typeof document === 'undefined') return;
      document.documentElement.style.setProperty('--app-sidebar-width', '0px');
    };
  }, []);

  // Expose bottom nav height so the content can pad itself and avoid being covered.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.style.setProperty('--app-bottom-nav-height', isMobile ? '56px' : '0px');
  }, [isMobile]);

  // Close "More" menu when route changes.
  useEffect(() => {
    setIsMoreOpen(false);
  }, [pathname]);

  // Track the last clicked menu item to maintain highlight during Suspense transitions
  const [clickedPath, setClickedPath] = useState<string | undefined>(undefined);

  // Clear clickedPath only when the clicked route actually becomes active
  React.useEffect(() => {
    if (clickedPath) {
      // Check if the clicked path is now the active route (or its alias)
      const isNowActive = pathname === clickedPath ||
        (clickedPath === '/boards' && pathname === '/pipeline') ||
        (clickedPath === '/pipeline' && pathname === '/boards');

      if (isNowActive) {
        // Route is now active, safe to clear the "clicked" state
        setClickedPath(undefined);
      }
    }
  }, [pathname, clickedPath]);

  const toggleDebugMode = () => {
    if (debugEnabled) {
      disableDebugMode();
      setDebugEnabled(false);
    } else {
      enableDebugMode();
      setDebugEnabled(true);
    }
  };

  // Gera iniciais do email
  const userInitials = profile?.email?.substring(0, 2).toUpperCase() || 'U';

  if (!loading && !user) return null;

  return (
    <div className="flex h-screen overflow-hidden bg-surface-bg bg-dots">
      {/* Skip Link for keyboard users */}
      <SkipLink targetId="main-content" />

      {/* Tablet rail (shows full icon set; no "More" sheet needed) */}
      {isTablet ? <NavigationRail /> : null}

      {/* Sidebar - Collapsible */}
      {isDesktop ? (
      <aside
        className={`relative hidden md:flex flex-col z-20 glass border-r border-[var(--color-border-subtle)] transition-all duration-300 ease-in-out ${sidebarCollapsed ? 'w-20' : 'w-64'
          }`}
        aria-label="Menu principal"
      >
        <div className="h-16 flex items-center border-b border-[var(--color-border-subtle)] px-5">
          <div className={`flex items-center min-w-0 transition-[gap] duration-300 ease-in-out ${sidebarCollapsed ? 'gap-0' : 'gap-3'}`}>
            <div className="w-9 h-9 bg-gradient-to-br from-primary-500 to-primary-700 rounded-xl flex items-center justify-center text-white font-bold text-sm shadow-lg shadow-primary-500/20 shrink-0" aria-hidden="true">
              {officeInitials}
            </div>
            <span className={`text-sm font-bold font-display tracking-tight text-slate-900 dark:text-white truncate overflow-hidden transition-[max-width,opacity,transform] duration-300 ease-in-out ${sidebarCollapsed ? 'max-w-0 opacity-0 -translate-x-2' : 'max-w-[9rem] flex-1 min-w-0 opacity-100 translate-x-0'}`}>
              {officeName}
            </span>
          </div>
        </div>

        <nav className="flex-1 p-4 space-y-2 flex flex-col overflow-y-auto" aria-label="Navegação do sistema">
          <NavItem
            to="/inbox"
            icon={Inbox}
            label="Inbox"
            prefetch="inbox"
            clickedPath={clickedPath}
            onItemClick={setClickedPath}
            collapsed={sidebarCollapsed}
          />

          {/* GRUPO WhatsApp (recolhível): Chats + Modelos + Conexão */}
          {(() => {
            const waChildren = [
              { to: '/chats', icon: MessageCircle, label: 'Chats', prefetch: 'chats' as RouteName },
              ...(isAdminRole
                ? [
                    { to: '/modelos', icon: FileText, label: 'Modelos', prefetch: 'modelos' as RouteName },
                    { to: '/conexao-whatsapp', icon: QrCode, label: 'Conexão', prefetch: 'conexao' as RouteName },
                  ]
                : []),
            ];
            return (
              <NavGroup
                label="WhatsApp"
                icon={MessageCircle}
                open={waGroupOpen}
                onToggle={() => setWaGroupOpen(!waGroupOpen)}
                childActive={waChildren.some(c => pathname === c.to)}
                collapsed={sidebarCollapsed}
              >
                {waChildren.map(c => (
                  <NavItem
                    key={c.to}
                    to={c.to}
                    icon={c.icon}
                    label={c.label}
                    prefetch={c.prefetch}
                    clickedPath={clickedPath}
                    onItemClick={setClickedPath}
                    collapsed={sidebarCollapsed}
                  />
                ))}
              </NavGroup>
            );
          })()}

          {[
            { to: '/dashboard', icon: LayoutDashboard, label: 'Visão Geral', prefetch: 'dashboard' as const },
            { to: '/boards', icon: KanbanSquare, label: 'Boards', prefetch: 'boards' as const },
            { to: '/contacts', icon: Users, label: 'Contatos', prefetch: 'contacts' as const },
            { to: '/activities', icon: CheckSquare, label: 'Atividades', prefetch: 'activities' as const },
            { to: '/reports', icon: BarChart3, label: 'Relatórios', prefetch: 'reports' as const },
            { to: '/settings', icon: Settings, label: 'Configurações', prefetch: 'settings' as const },
          ].map((item) => (
            <NavItem
              key={item.to}
              to={item.to}
              icon={item.icon}
              label={item.label}
              prefetch={item.prefetch}
              clickedPath={clickedPath}
              onItemClick={setClickedPath}
              collapsed={sidebarCollapsed}
            />
          ))}

          {/* GRUPO Ajuda (recolhível): Sugestões + Tutorial */}
          {(() => {
            const helpChildren = [
              { to: '/suggestions', icon: Lightbulb, label: 'Sugestões', prefetch: 'suggestions' as RouteName },
              { to: '/tutorial', icon: GraduationCap, label: 'Tutorial', prefetch: 'tutorial' as RouteName },
            ];
            return (
              <NavGroup
                label="Ajuda"
                icon={HelpCircle}
                open={helpGroupOpen}
                onToggle={() => setHelpGroupOpen(!helpGroupOpen)}
                childActive={helpChildren.some(c => pathname === c.to)}
                collapsed={sidebarCollapsed}
              >
                {helpChildren.map(c => (
                  <NavItem
                    key={c.to}
                    to={c.to}
                    icon={c.icon}
                    label={c.label}
                    prefetch={c.prefetch}
                    clickedPath={clickedPath}
                    onItemClick={setClickedPath}
                    collapsed={sidebarCollapsed}
                  />
                ))}
              </NavGroup>
            );
          })()}
        </nav>

        {/* Alternar menu: item no FLUXO, embaixo (acima do cartão do usuário) —
            nunca invade outro elemento e anima igual aos itens de navegação */}
        <div className="px-4 pb-1">
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className={`flex items-center w-full py-2.5 rounded-lg text-sm font-medium text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 hover:text-slate-700 dark:hover:text-white overflow-hidden transition-[padding,gap,background-color,color] duration-300 ease-in-out focus-visible-ring ${
              sidebarCollapsed ? 'px-[13px] gap-0' : 'px-4 gap-3'
            }`}
            title={sidebarCollapsed ? 'Expandir menu' : 'Recolher menu'}
            aria-label={sidebarCollapsed ? 'Expandir menu' : 'Recolher menu'}
          >
            <span className="relative block h-5 w-5 shrink-0" aria-hidden="true">
              <PanelLeftClose
                size={20}
                className={`absolute inset-0 transition-all duration-300 ease-in-out ${
                  sidebarCollapsed ? 'opacity-0 scale-75' : 'opacity-100 scale-100'
                }`}
              />
              <PanelLeftOpen
                size={20}
                className={`absolute inset-0 transition-all duration-300 ease-in-out ${
                  sidebarCollapsed ? 'opacity-100 scale-100' : 'opacity-0 scale-75'
                }`}
              />
            </span>
            <span
              className={`font-display tracking-wide whitespace-nowrap overflow-hidden transition-[max-width,opacity,transform] duration-300 ease-in-out ${
                sidebarCollapsed ? 'max-w-0 opacity-0 -translate-x-2' : 'max-w-[9rem] opacity-100 translate-x-0'
              }`}
            >
              Recolher menu
            </span>
          </button>
        </div>

        <div className="p-4 border-t border-[var(--color-border-subtle)]">
          <div className="relative">

            {/* User Card - Clickable */}
            <button
              onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
              className={`flex items-center rounded-xl bg-slate-50/50 dark:bg-white/5 border border-slate-100 dark:border-white/5 hover:bg-slate-100 dark:hover:bg-white/10 transition-all duration-300 ease-in-out group focus-visible-ring ${sidebarCollapsed ? 'gap-0 p-0 w-10 h-10 justify-center mx-auto' : 'gap-3 w-full p-3'
                }`}
            >
              {profile?.avatar_url ? (
                <Image
                  src={profile.avatar_url}
                  alt=""
                  width={40}
                  height={40}
                  className="w-10 h-10 rounded-full object-cover ring-2 ring-white dark:ring-slate-800 shadow-lg"
                  unoptimized
                />
              ) : (
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary-500 to-primary-600 flex items-center justify-center text-white font-bold text-sm ring-2 ring-white dark:ring-slate-800 shadow-lg shrink-0" aria-hidden="true">
                  {profile?.first_name && profile?.last_name
                    ? `${profile.first_name[0]}${profile.last_name[0]}`.toUpperCase()
                    : profile?.nickname?.substring(0, 2).toUpperCase() || userInitials}
                </div>
              )}

              <div
                className={`flex-1 min-w-0 text-left overflow-hidden transition-[max-width,opacity,transform] duration-300 ease-in-out ${
                  sidebarCollapsed ? 'max-w-0 opacity-0 -translate-x-2' : 'max-w-[10rem] opacity-100 translate-x-0'
                }`}
              >
                <p className="text-sm font-semibold text-slate-900 dark:text-white truncate whitespace-nowrap">
                  {profile?.nickname || profile?.first_name || profile?.email?.split('@')[0] || 'Usuário'}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 truncate whitespace-nowrap">
                  {profile?.email || ''}
                </p>
              </div>
              <svg
                className={`h-4 text-slate-400 transition-all duration-300 ease-in-out ${isUserMenuOpen ? 'rotate-180' : ''} ${
                  sidebarCollapsed ? 'w-0 opacity-0' : 'w-4 opacity-100'
                }`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
              </svg>
            </button>

            {/* Dropdown Menu */}
            {isUserMenuOpen && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setIsUserMenuOpen(false)}
                  aria-hidden="true"
                />
                <div
                  className={`absolute bottom-full mb-2 z-50 bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700 overflow-hidden animate-in slide-in-from-bottom-2 fade-in duration-150 ${sidebarCollapsed ? 'left-0 w-48' : 'left-0 right-0'}`}
                >
                  <div className="p-1">
                    <Link
                      href="/profile"
                      onClick={() => setIsUserMenuOpen(false)}
                      className="flex items-center gap-3 px-3 py-2.5 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/50 rounded-lg transition-colors focus-visible-ring"
                    >
                      <User className="w-4 h-4 text-slate-400" />
                      Editar Perfil
                    </Link>
                    {profile?.role === UserRole.SUPER_ADMIN && (
                      <Link
                        href="/admin"
                        onClick={() => setIsUserMenuOpen(false)}
                        className="flex items-center gap-3 px-3 py-2.5 text-sm text-primary-700 dark:text-primary-300 hover:bg-primary-50 dark:hover:bg-primary-900/20 rounded-lg transition-colors focus-visible-ring"
                      >
                        <Shield className="w-4 h-4 text-primary-500" />
                        Super Admin
                      </Link>
                    )}
                    <button
                      onClick={() => {
                        setIsUserMenuOpen(false);
                        signOut();
                      }}
                      className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors focus-visible-ring"
                    >
                      <LogOut className="w-4 h-4" />
                      Sair da conta
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Desenvolvido por Anúncio Jurídico (colapsa animado junto com o menu) */}
          <div
            className={`flex flex-col items-center gap-1 overflow-hidden transition-all duration-300 ease-in-out ${
              sidebarCollapsed
                ? 'max-h-0 opacity-0 mt-0 pt-0 border-t border-transparent'
                : 'max-h-28 opacity-100 mt-3 pt-3 border-t border-[var(--color-border-subtle)]'
            }`}
            aria-hidden={sidebarCollapsed}
          >
            <span className="text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-widest whitespace-nowrap">
              Desenvolvido por
            </span>
            <Image
              src="/logo-aj-white.png"
              alt="Anúncio Jurídico"
              width={160}
              height={64}
              // logo branca: no modo claro vira silhueta preta (brightness-0)
              className="object-contain opacity-50 hover:opacity-80 transition-opacity brightness-0 dark:brightness-100"
            />
          </div>
        </div>
      </aside>
      ) : null}

      {/* Main Content Wrapper */}
      <div className="flex-1 flex min-w-0 overflow-hidden relative">
        {/* Middle Content (Header + Page) */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
          {/* Ambient background glow */}
          <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none" aria-hidden="true">
            <div className="absolute -top-[20%] -left-[10%] w-[50%] h-[50%] bg-primary-500/10 rounded-full blur-[100px]"></div>
            <div className="absolute top-[40%] right-[0%] w-[40%] h-[40%] bg-purple-500/10 rounded-full blur-[100px]"></div>
          </div>

          {/* Header */}
          <header className="h-16 glass border-b border-[var(--color-border-subtle)] flex items-center justify-end px-6 z-40 shrink-0" role="banner">
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => setIsGlobalAIOpen(!isGlobalAIOpen)}
                className={`p-2 rounded-full transition-all active:scale-95 focus-visible-ring ${isGlobalAIOpen
                  ? 'text-primary-600 bg-primary-50 dark:text-primary-400 dark:bg-primary-900/20'
                  : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10'
                  }`}
              >
                <Sparkles size={20} aria-hidden="true" />
              </button>

              <button
                type="button"
                onClick={toggleDebugMode}
                className={`p-2 rounded-full transition-all active:scale-95 focus-visible-ring ${debugEnabled
                  ? 'text-purple-600 bg-purple-100 dark:text-purple-400 dark:bg-purple-900/30 ring-2 ring-purple-400/50'
                  : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10'
                  }`}
              >
                <Bug size={20} aria-hidden="true" />
              </button>

              <NotificationPopover />
              <button
                type="button"
                onClick={toggleDarkMode}
                className="p-2 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 rounded-full transition-all active:scale-95 focus-visible-ring"
              >
                {darkMode ? <Sun size={20} aria-hidden="true" /> : <Moon size={20} aria-hidden="true" />}
              </button>
            </div>
          </header>

          <main
            id="main-content"
            // scrollbar-gutter stable: o ESPAÇO da barra fica reservado sempre
            // (conteúdo nunca desloca ao trocar de aba/página), mas a barra em
            // si só aparece quando a tela realmente rola
            className="flex-1 overflow-auto [scrollbar-gutter:stable] p-6 pb-[calc(1.5rem+var(--app-bottom-nav-height,0px)+var(--app-safe-area-bottom,0px))] relative scroll-smooth"
            tabIndex={-1}
          >
            {children}
          </main>
        </div>

        {/* Right Sidebar (AI Assistant) */}
        <aside
          aria-label="Assistente de IA"
          aria-hidden={!isGlobalAIOpen}
          className={`border-l border-[var(--color-border)] bg-surface transition-all duration-300 ease-in-out overflow-hidden flex flex-col ${isGlobalAIOpen ? 'w-96 opacity-100' : 'w-0 opacity-0'}`}
        >
          <div className="w-96 h-full">
            {isGlobalAIOpen && (
              <UIChat />
            )}
          </div>
        </aside>
      </div>

      {/* Mobile app shell */}
      <BottomNav onOpenMore={() => setIsMoreOpen(true)} />
      <MoreMenuSheet isOpen={isMoreOpen} onClose={() => setIsMoreOpen(false)} />
    </div>
  );
};

export default Layout;
