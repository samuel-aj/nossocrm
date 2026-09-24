'use client';

import { useQuery } from '@tanstack/react-query';
import { House, Loader2 } from 'lucide-react';

type Organization = { id: string; name: string };

export function MainOrganizationShortcut({ enabled, currentOrgId, collapsed, busy, onSelect }: {
  enabled: boolean;
  currentOrgId: string | null;
  collapsed: boolean;
  busy: boolean;
  onSelect: (organization: Organization) => void;
}) {
  const query = useQuery<Organization | null>({
    queryKey: ['mainOrganizationShortcut'],
    enabled,
    staleTime: 60_000,
    queryFn: async () => {
      const response = await fetch('/api/superadmin/main-organization', { credentials: 'include' });
      if (!response.ok) throw new Error('Falha ao consultar a conta principal');
      return (await response.json()).organization;
    },
  });
  const organization = query.data;
  if (!enabled || !organization || organization.id === currentOrgId) return null;
  const label = `Voltar para ${organization.name}`;
  return (
    <button type="button" onClick={() => onSelect(organization)} disabled={busy} title={label} aria-label={label}
      className={`mt-2 flex items-center gap-2 rounded-lg text-xs font-medium text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-white/5 disabled:opacity-50 focus-visible-ring ${collapsed ? 'p-2' : 'w-full px-2 py-1.5'}`}>
      {busy ? <Loader2 size={14} className="shrink-0 animate-spin" /> : <House size={14} className="shrink-0" />}
      {!collapsed && <span className="truncate">Voltar para {organization.name}</span>}
    </button>
  );
}
