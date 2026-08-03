import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { PRIMARY_NAV, SECONDARY_NAV } from './navConfig';
import { useAuth } from '@/context/AuthContext';

export interface NavigationRailProps {
  /** Optional: used only if we want to keep "More" as a sheet trigger (mobile-like). */
  onOpenMore?: () => void;
}

export function NavigationRail({ onOpenMore }: NavigationRailProps) {
  const pathname = usePathname();
  const { profile, signOut } = useAuth();
  const isAdmin = profile?.role === 'admin' || profile?.role === 'super_admin';
  const isSuperAdmin = profile?.role === 'super_admin';
  const officeName = profile?.organization_name || 'NossoCRM';
  const officeInitials = officeName.split(' ').slice(0, 2).map((w: string) => w[0]).join('').toUpperCase() || 'AJ';

  const isHrefActive = (href: string) =>
    pathname === href ||
    (href === '/boards' && pathname === '/pipeline') ||
    (href === '/pipeline' && pathname === '/boards');

  return (
    <nav
      aria-label="Navegação principal (tablet)"
      className={cn(
        'flex',
        'flex-col justify-between',
        'w-20 shrink-0',
        'glass border-r border-[var(--color-border-subtle)]'
      )}
    >
      <div className="flex flex-col items-center gap-2 py-4">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center overflow-hidden">
          <img src="/logo-aj-v2.png" alt={officeName} className="w-full h-full object-contain" />
        </div>
      </div>

      <div className="flex-1 px-3 py-2 overflow-y-auto scrollbar-custom">
        <div className="space-y-2">
          {PRIMARY_NAV.filter((i) => i.id !== 'more').map((item) => {
            const Icon = item.icon;
            const isActive = item.href ? isHrefActive(item.href) : false;

            return (
              <Link
                key={item.id}
                href={item.href!}
                className={cn(
                  'w-full h-12 rounded-xl flex items-center justify-center transition-colors focus-visible-ring',
                  isActive
                    ? 'bg-primary-500/10 text-primary-600 dark:text-primary-400 border border-primary-200 dark:border-primary-900/50'
                    : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 hover:text-slate-900 dark:hover:text-white'
                )}
                aria-current={isActive ? 'page' : undefined}
                title={item.label}
                aria-label={item.label}
              >
                <Icon className={cn('h-5 w-5', isActive ? 'text-primary-500' : '')} aria-hidden="true" />
              </Link>
            );
          })}
        </div>

        <div className="my-3 h-px bg-slate-200/60 dark:bg-white/10" />

        <div className="space-y-2">
          {SECONDARY_NAV.filter(
            (item) => (!item.adminOnly || isAdmin) && (!item.superAdminOnly || isSuperAdmin)
          ).map((item) => {
            const Icon = item.icon;
            const isActive = isHrefActive(item.href);
            return (
              <Link
                key={item.id}
                href={item.href}
                className={cn(
                  'relative w-full h-12 rounded-xl flex items-center justify-center transition-colors focus-visible-ring',
                  isActive
                    ? 'bg-primary-500/10 text-primary-600 dark:text-primary-400 border border-primary-200 dark:border-primary-900/50'
                    : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 hover:text-slate-900 dark:hover:text-white'
                )}
                aria-current={isActive ? 'page' : undefined}
                title={item.label}
                aria-label={item.label}
              >
                <Icon className={cn('h-5 w-5', isActive ? 'text-primary-500' : '')} aria-hidden="true" />
                {item.badge && (
                  <span className="absolute right-2.5 top-2 h-2 w-2 rounded-full bg-primary-500" aria-hidden="true" />
                )}
              </Link>
            );
          })}
        </div>
      </div>

      {/* Sair da conta: a portinha vermelha, sempre no pé do rail */}
      <div className="px-3 pb-4">
        <button
          type="button"
          onClick={() => signOut()}
          className="w-full h-12 rounded-xl flex items-center justify-center text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors focus-visible-ring"
          title="Sair da conta"
          aria-label="Sair da conta"
        >
          <LogOut className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
    </nav>
  );
}

