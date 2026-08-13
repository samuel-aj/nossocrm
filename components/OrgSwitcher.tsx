'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronsUpDown, Search, Loader2 } from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import { pinTabOrg } from '@/lib/tabOrg';
import { supabase } from '@/lib/supabase/client';

interface OrgSummary {
  id: string;
  name: string;
  userCount?: number;
}

interface OrgSwitcherProps {
  /** Sidebar recolhida (só iniciais). */
  collapsed: boolean;
  officeName: string;
  officeInitials: string;
  /** Super admin vê TODAS as orgs no dropdown; usuário comum com mais de uma
   *  org (user_organizations) vê as DELE; quem só tem uma vê o card estático. */
  isSuperAdmin: boolean;
  currentOrgId: string | null;
}

/**
 * Card da organização no topo do menu. Para super admin (todas as orgs) e
 * para membros de várias organizações (as orgs deles) vira um seletor:
 * clica, busca e troca de organização sem sair da tela.
 * A troca é de SESSÃO (organization_id do perfil no servidor) e recarrega o
 * app pra zerar os caches da organização anterior.
 */
export function OrgSwitcher({
  collapsed,
  officeName,
  officeInitials,
  isSuperAdmin,
  currentOrgId,
}: OrgSwitcherProps) {
  const { addToast } = useToast();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const orgsQ = useQuery<{ organizations: OrgSummary[] }>({
    queryKey: ['superadminOrgsSwitcher'],
    queryFn: async () => {
      const res = await fetch('/api/superadmin/organizations', {
        credentials: 'include',
        headers: { accept: 'application/json' },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((json as { error?: string }).error || 'Falha ao listar organizações');
      return json as { organizations: OrgSummary[] };
    },
    enabled: isSuperAdmin && open,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  // Orgs do PRÓPRIO usuário (multi-org): a RLS de user_organizations deixa
  // cada um ver só os próprios vínculos — mesma consulta da tela /select-org.
  // Carrega já na montagem: é ela que decide se o card vira dropdown.
  const myOrgsQ = useQuery<OrgSummary[]>({
    queryKey: ['myOrgsSwitcher'],
    queryFn: async () => {
      if (!supabase) return [];
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return [];
      const { data } = await supabase
        .from('user_organizations')
        .select('organization_id, organizations(name)')
        .eq('user_id', user.id);
      return (data ?? [])
        .map((r) => ({
          id: r.organization_id as string,
          name: (r.organizations as unknown as { name: string } | null)?.name || 'Organização',
        }))
        .filter((o) => !!o.id);
    },
    enabled: !isSuperAdmin,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const isMultiOrg = !isSuperAdmin && (myOrgsQ.data?.length ?? 0) > 1;
  const canSwitch = isSuperAdmin || isMultiOrg;

  const filteredOrgs = useMemo(() => {
    const orgs = isSuperAdmin ? orgsQ.data?.organizations ?? [] : myOrgsQ.data ?? [];
    const term = search.trim().toLowerCase();
    const list = term ? orgs.filter((o) => o.name.toLowerCase().includes(term)) : orgs;
    // Ordena por nome pra facilitar achar
    return [...list].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }, [isSuperAdmin, orgsQ.data, myOrgsQ.data, search]);

  const handleSwitch = async (org: OrgSummary) => {
    if (org.id === currentOrgId || switchingId) return;
    setSwitchingId(org.id);
    try {
      // Super admin usa a rota dele (com auditoria); membro comum usa a rota
      // que valida o vínculo em user_organizations.
      const res = await fetch(isSuperAdmin ? '/api/superadmin/switch-org' : '/api/switch-org', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ organizationId: org.id }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((json as { error?: string }).error || 'Falha ao trocar de organização');
      // Marca SÓ ESTA aba como pertencendo à nova org — as outras abas
      // continuam nas orgs delas (org por aba). O POST acima só muda a org
      // PADRÃO de abas novas (profiles.organization_id).
      pinTabOrg(org.id, org.name);
      // Recarga completa: limpa todos os caches (boards, deals...) da org anterior
      window.location.assign('/dashboard');
    } catch (e) {
      setSwitchingId(null);
      addToast((e as Error).message, 'error');
    }
  };

  const card = (
    <div className={`flex items-center min-w-0 transition-[gap] duration-300 ease-in-out ${collapsed ? 'gap-0' : 'gap-3'}`}>
      <div
        className="w-9 h-9 bg-gradient-to-br from-primary-500 to-primary-700 rounded-xl flex items-center justify-center text-white font-bold text-sm shadow-lg shadow-primary-500/20 shrink-0"
        aria-hidden="true"
      >
        {officeInitials}
      </div>
      <span
        className={`text-sm font-bold font-display tracking-tight text-slate-900 dark:text-white truncate overflow-hidden transition-[max-width,opacity,transform] duration-300 ease-in-out ${
          collapsed ? 'max-w-0 opacity-0 -translate-x-2' : 'max-w-[8rem] flex-1 min-w-0 opacity-100 translate-x-0'
        }`}
      >
        {officeName}
      </span>
      {canSwitch && !collapsed && (
        <ChevronsUpDown size={14} className="shrink-0 text-slate-400" aria-hidden="true" />
      )}
    </div>
  );

  if (!canSwitch) return card;

  return (
    <div ref={rootRef} className="relative min-w-0 flex-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label="Trocar organização"
        title="Trocar organização"
        className="w-full text-left rounded-lg hover:bg-slate-100 dark:hover:bg-white/5 transition-colors p-1 -m-1 focus-visible-ring"
      >
        {card}
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-2 z-[80] w-64 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-xl overflow-hidden">
          <div className="p-2 border-b border-slate-100 dark:border-white/10">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input
                autoFocus
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar organização..."
                aria-label="Buscar organização"
                className="w-full pl-8 pr-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-white/5 text-sm outline-none focus:ring-2 focus:ring-primary-500 dark:text-white"
              />
            </div>
          </div>
          <div className="max-h-72 overflow-y-auto scrollbar-custom py-1">
            {(isSuperAdmin ? orgsQ.isLoading : myOrgsQ.isLoading) && (
              <div className="px-3 py-4 text-sm text-slate-500 flex items-center gap-2">
                <Loader2 size={14} className="animate-spin" /> Carregando organizações...
              </div>
            )}
            {isSuperAdmin && orgsQ.isError && (
              <div className="px-3 py-4 text-sm text-red-500">
                {(orgsQ.error as Error).message}
              </div>
            )}
            {!(isSuperAdmin ? orgsQ.isLoading : myOrgsQ.isLoading) && filteredOrgs.length === 0 && !orgsQ.isError && (
              <div className="px-3 py-4 text-sm text-slate-500 italic">Nenhuma organização encontrada.</div>
            )}
            {filteredOrgs.map((org) => {
              const isCurrent = org.id === currentOrgId;
              return (
                <button
                  key={org.id}
                  type="button"
                  onClick={() => handleSwitch(org)}
                  disabled={!!switchingId}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors disabled:opacity-60 ${
                    isCurrent
                      ? 'font-bold text-primary-600 dark:text-primary-400'
                      : 'text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/5'
                  }`}
                >
                  <span
                    className="shrink-0 w-6 h-6 rounded-md bg-slate-100 dark:bg-white/10 flex items-center justify-center text-[10px] font-bold uppercase text-slate-500 dark:text-slate-300"
                    aria-hidden="true"
                  >
                    {(org.name || '?').charAt(0)}
                  </span>
                  <span className="flex-1 min-w-0 truncate">{org.name}</span>
                  {switchingId === org.id ? (
                    <Loader2 size={14} className="shrink-0 animate-spin text-slate-400" />
                  ) : isCurrent ? (
                    <Check size={14} className="shrink-0" aria-hidden="true" />
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
