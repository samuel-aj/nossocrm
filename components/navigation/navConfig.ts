import type { ComponentType } from 'react';
import {
  Inbox,
  KanbanSquare,
  Users,
  CheckSquare,
  MoreHorizontal,
  LayoutDashboard,
  BarChart3,
  Lightbulb,
  Settings,
  User,
  GraduationCap,
  MessageCircle,
  FileText,
  QrCode,
  Shield,
} from 'lucide-react';

export type PrimaryNavId = 'inbox' | 'boards' | 'contacts' | 'activities' | 'more';

export interface PrimaryNavItem {
  id: PrimaryNavId;
  label: string;
  /** Route to navigate. For "more", this is omitted because it opens a menu/sheet. */
  href?: string;
  icon: ComponentType<{ className?: string }>;
}

export const PRIMARY_NAV: PrimaryNavItem[] = [
  { id: 'inbox', label: 'Inbox', href: '/inbox', icon: Inbox },
  { id: 'boards', label: 'Boards', href: '/boards', icon: KanbanSquare },
  { id: 'contacts', label: 'Contatos', href: '/contacts', icon: Users },
  { id: 'activities', label: 'Atividades', href: '/activities', icon: CheckSquare },
  { id: 'more', label: 'Mais', icon: MoreHorizontal },
];

export type SecondaryNavId =
  | 'dashboard'
  | 'chats'
  | 'modelos'
  | 'conexao'
  | 'reports'
  | 'suggestions'
  | 'tutorial'
  | 'settings'
  | 'admin'
  | 'profile';

export interface SecondaryNavItem {
  id: SecondaryNavId;
  label: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
  /** Pequeno destaque (ex.: 'Novo') exibido ao lado do item. */
  badge?: string;
  /** Se true, o item só aparece para admin/super_admin. */
  adminOnly?: boolean;
  /** Se true, o item só aparece para super_admin. */
  superAdminOnly?: boolean;
  /** Cor própria do ícone (ex.: roxo do Super Admin). */
  iconClassName?: string;
}

/** Mirrors non-primary destinations available in the desktop sidebar/user menu. */
export const SECONDARY_NAV: SecondaryNavItem[] = [
  { id: 'dashboard', label: 'Visão Geral', href: '/dashboard', icon: LayoutDashboard },
  { id: 'chats', label: 'Chats', href: '/chats', icon: MessageCircle },
  { id: 'modelos', label: 'Modelos', href: '/modelos', icon: FileText, adminOnly: true },
  { id: 'conexao', label: 'Conexão WhatsApp', href: '/conexao-whatsapp', icon: QrCode, adminOnly: true },
  { id: 'reports', label: 'Relatórios', href: '/reports', icon: BarChart3 },
  { id: 'settings', label: 'Configurações', href: '/settings', icon: Settings },
  { id: 'suggestions', label: 'Sugestões', href: '/suggestions', icon: Lightbulb },
  { id: 'tutorial', label: 'Tutorial', href: '/tutorial', icon: GraduationCap },
  // Fim do menu, nesta ordem: Perfil, Super Admin (roxo) e o Sair (renderizado
  // pelos componentes logo depois da lista)
  { id: 'profile', label: 'Perfil', href: '/profile', icon: User },
  { id: 'admin', label: 'Super Admin', href: '/admin', icon: Shield, superAdminOnly: true, iconClassName: 'text-purple-500' },
];
