'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';

interface TabOrg {
  id: string;
  name: string;
}

interface OrgConflict {
  pinned: TabOrg;
  current: TabOrg;
}

const TAB_ORG_KEY = 'crm_tab_org';

/**
 * Guarda de organização POR ABA.
 *
 * A org ativa mora no servidor (profiles.organization_id), então trocar de
 * org numa aba afeta TODAS as abas da mesma sessão. Este componente fixa em
 * sessionStorage (que é por aba) a org com que a aba foi aberta e, ao voltar
 * o foco pra aba, confere no servidor se a sessão mudou. Se mudou, mostra um
 * aviso bloqueante com a escolha: seguir na org nova ou voltar pra org da
 * aba. Evita a troca silenciosa (e o risco de mexer em dados da org errada).
 */
export function OrgTabGuard() {
  const { user, profile, organizationId } = useAuth();
  const [conflict, setConflict] = useState<OrgConflict | null>(null);
  const [busy, setBusy] = useState(false);

  const currentName = profile?.organization_name || 'outra organização';

  // Fixa a org da aba na primeira carga (sessionStorage é por aba).
  useEffect(() => {
    if (!organizationId) return;
    try {
      const raw = sessionStorage.getItem(TAB_ORG_KEY);
      if (!raw) {
        sessionStorage.setItem(TAB_ORG_KEY, JSON.stringify({ id: organizationId, name: currentName }));
        return;
      }
      const pinned = JSON.parse(raw) as TabOrg;
      if (pinned.id !== organizationId) {
        setConflict({ pinned, current: { id: organizationId, name: currentName } });
      }
    } catch {
      // sessionStorage indisponível: sem guarda
    }
  }, [organizationId, currentName]);

  // Ao voltar o foco pra aba, confere no servidor se a sessão trocou de org
  // (o perfil em memória pode estar desatualizado).
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;

    const check = async () => {
      try {
        const raw = sessionStorage.getItem(TAB_ORG_KEY);
        if (!raw) return;
        const pinned = JSON.parse(raw) as TabOrg;
        const { data } = await supabase
          .from('profiles')
          .select('organization_id, organizations(name)')
          .eq('id', user.id)
          .single();
        if (cancelled || !data?.organization_id) return;
        if (data.organization_id !== pinned.id) {
          const orgJoin = data.organizations as { name?: string } | Array<{ name?: string }> | null;
          const freshName = Array.isArray(orgJoin) ? orgJoin[0]?.name : orgJoin?.name;
          setConflict({
            pinned,
            current: { id: data.organization_id, name: freshName || 'outra organização' },
          });
        }
      } catch {
        // falha de rede: tenta de novo no próximo foco
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') void check();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [user?.id]);

  const continueHere = useCallback(() => {
    if (!conflict) return;
    try {
      sessionStorage.setItem(TAB_ORG_KEY, JSON.stringify(conflict.current));
    } catch {
      // segue mesmo assim
    }
    window.location.reload();
  }, [conflict]);

  const goBackToPinned = useCallback(async () => {
    if (!conflict || busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/switch-org', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ organizationId: conflict.pinned.id }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error((json as { error?: string }).error || 'Falha ao voltar pra organização');
      }
      window.location.reload();
    } catch {
      setBusy(false);
      // Sem acesso de volta (ex.: org excluída): resta seguir na atual
      continueHere();
    }
  }, [conflict, busy, continueHere]);

  if (!conflict) return null;

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-900/70 backdrop-blur-sm p-4">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label="Sessão mudou de organização"
        className="bg-white dark:bg-dark-card border border-slate-200 dark:border-white/10 rounded-2xl shadow-2xl w-full max-w-md p-6"
      >
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center shrink-0" aria-hidden="true">
            <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
          </div>
          <h2 className="font-bold text-slate-900 dark:text-white font-display">
            Sua sessão mudou de organização
          </h2>
        </div>
        <p className="text-sm text-slate-600 dark:text-slate-300 mb-5">
          Esta aba estava em <span className="font-bold">{conflict.pinned.name}</span>, mas a
          sessão foi trocada para <span className="font-bold">{conflict.current.name}</span>{' '}
          (provavelmente por outra aba). Pra evitar mexer nos dados da organização errada, escolha
          como seguir:
        </p>
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={goBackToPinned}
            disabled={busy}
            className="w-full py-2.5 rounded-lg bg-primary-600 hover:bg-primary-500 text-white text-sm font-bold transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {busy && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
            Voltar para {conflict.pinned.name}
          </button>
          <button
            type="button"
            onClick={continueHere}
            disabled={busy}
            className="w-full py-2.5 rounded-lg border border-slate-200 dark:border-white/10 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors disabled:opacity-60"
          >
            Continuar em {conflict.current.name}
          </button>
        </div>
      </div>
    </div>
  );
}
