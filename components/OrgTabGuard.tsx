'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import {
  announceOrgSwitch,
  ORG_PRESENCE_CHANNEL,
  ORG_SWITCH_RECORD_TTL_MS,
  pinTabOrg,
  readOrgSwitchRecord,
  readTabOrg,
  type TabOrg,
} from '@/lib/tabOrg';

interface OrgConflict {
  pinned: TabOrg;
  current: TabOrg;
}

const PRESENCE_WAIT_MS = 400;

/**
 * Guarda de organização POR ABA.
 *
 * A org ativa mora no servidor (profiles.organization_id), então trocar de
 * org numa aba afeta TODAS as abas da mesma sessão. Este componente fixa em
 * sessionStorage (que é por aba) a org com que a aba está trabalhando e
 * detecta quando a sessão muda por baixo dela.
 *
 * O aviso bloqueante SÓ aparece quando há evidência de outra aba envolvida:
 * push 'org-switched' recebido na hora da troca, pong de alguma aba já
 * trabalhando na org nova, ou registro de troca recente feita por outra aba
 * deste navegador. Sem essa evidência (ex.: troca vinda de outro dispositivo
 * com esta aba única), a aba adota a org nova em silêncio (re-marca e
 * recarrega pra descartar caches da org anterior).
 *
 * Numa página recém-carregada nunca há aviso: o load já renderiza a org
 * atual inteira, então divergência da marcação significa troca feita pela
 * própria aba (todos os fluxos de troca fazem full reload) — só re-marca.
 */
export function OrgTabGuard() {
  const { user, profile, organizationId } = useAuth();
  const [conflict, setConflict] = useState<OrgConflict | null>(null);
  const [busy, setBusy] = useState(false);
  const [backError, setBackError] = useState<string | null>(null);

  const channelRef = useRef<BroadcastChannel | null>(null);
  const tabIdRef = useRef<string>('');
  const pongOrgIdsRef = useRef<Set<string>>(new Set());
  const initDoneRef = useRef(false);
  const checkingRef = useRef(false);

  const currentName = profile?.organization_name || 'outra organização';

  // Canal entre abas: responde pings (com a org desta aba), coleta pongs e
  // recebe o push imediato de "troquei de org" vindo de outra aba.
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    if (!tabIdRef.current) {
      tabIdRef.current =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : Math.random().toString(36).slice(2);
    }
    const ch = new BroadcastChannel(ORG_PRESENCE_CHANNEL);
    channelRef.current = ch;
    ch.onmessage = (e: MessageEvent) => {
      const msg = e.data as { type?: string; from?: string; to?: string; orgId?: string; orgName?: string } | null;
      if (!msg) return;
      if (msg.type === 'ping' && msg.from !== tabIdRef.current) {
        ch.postMessage({ type: 'pong', from: tabIdRef.current, to: msg.from, orgId: readTabOrg()?.id ?? null });
      } else if (msg.type === 'pong' && msg.to === tabIdRef.current) {
        if (typeof msg.orgId === 'string' && msg.orgId) pongOrgIdsRef.current.add(msg.orgId);
      } else if (msg.type === 'org-switched') {
        // Outra aba (a própria mensagem prova a existência dela) trocou a
        // sessão agora. Durante o carregamento desta página o pin ainda é o
        // do documento anterior: ignora (o load já renderiza a org nova e o
        // init re-pina em silêncio; o check no próximo foco cobre o resto).
        if (!initDoneRef.current) return;
        const pinned = readTabOrg();
        if (!pinned || !msg.orgId) return;
        if (msg.orgId === pinned.id) {
          // A sessão voltou a bater com esta aba: dispensa diálogo obsoleto.
          setConflict(null);
          setBackError(null);
          return;
        }
        setConflict({ pinned, current: { id: msg.orgId, name: msg.orgName || 'outra organização' } });
      }
    };
    return () => {
      ch.close();
      channelRef.current = null;
    };
  }, []);

  // true se alguma outra aba do CRM está trabalhando na org alvo (respondeu
  // ao ping com ela) ou registrou uma troca pra ela há pouco (aba que pode
  // estar no meio do próprio reload e por isso não respondeu o ping).
  const otherTabInOrg = useCallback(async (targetOrgId: string): Promise<boolean> => {
    const record = readOrgSwitchRecord();
    if (
      record &&
      record.orgId === targetOrgId &&
      record.byTab !== tabIdRef.current &&
      Date.now() - record.ts < ORG_SWITCH_RECORD_TTL_MS
    ) {
      return true;
    }
    const ch = channelRef.current;
    if (!ch) return false;
    pongOrgIdsRef.current = new Set();
    try {
      ch.postMessage({ type: 'ping', from: tabIdRef.current });
    } catch {
      return false;
    }
    await new Promise((r) => setTimeout(r, PRESENCE_WAIT_MS));
    return pongOrgIdsRef.current.has(targetOrgId);
  }, []);

  // Marcação inicial da aba: fixa (ou re-fixa em silêncio) a org atual.
  useEffect(() => {
    if (!organizationId || initDoneRef.current) return;
    initDoneRef.current = true;
    const pinned = readTabOrg();
    if (!pinned || pinned.id !== organizationId) {
      pinTabOrg(organizationId, currentName);
    }
  }, [organizationId, currentName]);

  // Confere no servidor se a sessão trocou de org por baixo desta aba.
  const check = useCallback(async () => {
    if (!user?.id || !initDoneRef.current || checkingRef.current) return;
    checkingRef.current = true;
    try {
      const pinned = readTabOrg();
      if (!pinned) return;
      const { data } = await supabase
        .from('profiles')
        .select('organization_id, organizations(name)')
        .eq('id', user.id)
        .single();
      if (!data?.organization_id) return;
      if (data.organization_id === pinned.id) {
        // Divergência se resolveu (ex.: outra aba voltou pra org desta):
        // dispensa um diálogo que tenha ficado obsoleto.
        setConflict(null);
        setBackError(null);
        return;
      }

      const orgJoin = data.organizations as { name?: string } | Array<{ name?: string }> | null;
      const freshName = Array.isArray(orgJoin) ? orgJoin[0]?.name : orgJoin?.name;
      const current: TabOrg = {
        id: data.organization_id,
        name: freshName || 'outra organização',
      };

      if (await otherTabInOrg(current.id)) {
        // Há outra aba trabalhando na org nova: são duas abas disputando
        // orgs diferentes — pergunta.
        setConflict({ pinned, current });
      } else {
        // Sem evidência de outra aba (ex.: troca veio de outro dispositivo
        // ou navegador). Adota a org nova sem incomodar.
        pinTabOrg(current.id, current.name);
        window.location.reload();
      }
    } catch {
      // falha de rede: tenta de novo no próximo foco
    } finally {
      checkingRef.current = false;
    }
  }, [user?.id, otherTabInOrg]);

  // Gatilhos do check: voltar a ficar visível, ganhar foco (duas janelas
  // lado a lado nunca disparam visibilitychange) e a org do contexto mudar
  // sem reload (ex.: refetch do perfil após TOKEN_REFRESHED).
  useEffect(() => {
    if (!user?.id) return;
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void check();
    };
    const onFocus = () => void check();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onFocus);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onFocus);
    };
  }, [user?.id, check]);

  useEffect(() => {
    if (!organizationId || !initDoneRef.current) return;
    const pinned = readTabOrg();
    if (pinned && pinned.id !== organizationId) void check();
  }, [organizationId, check]);

  const continueHere = useCallback(() => {
    if (!conflict) return;
    pinTabOrg(conflict.current.id, conflict.current.name);
    window.location.reload();
  }, [conflict]);

  const goBackToPinned = useCallback(async () => {
    if (!conflict || busy) return;
    setBusy(true);
    setBackError(null);
    try {
      const res = await fetch('/api/switch-org', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ organizationId: conflict.pinned.id }),
      });
      if (res.status === 403 || res.status === 404) {
        // Perdeu o acesso à org da aba (removido/org excluída): só resta
        // seguir na atual.
        continueHere();
        return;
      }
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error((json as { error?: string }).error || 'Falha ao voltar pra organização');
      }
      // Avisa as outras abas (ex.: a que estava na org nova) da volta.
      announceOrgSwitch(conflict.pinned.id, conflict.pinned.name, tabIdRef.current);
      window.location.reload();
    } catch {
      // Falha transitória (rede/servidor): mantém o diálogo e deixa tentar
      // de novo, em vez de adotar a org errada contra a escolha do usuário.
      setBusy(false);
      setBackError('Não deu pra voltar agora. Verifique a conexão e tente de novo.');
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
          Esta aba estava em <span className="font-bold">{conflict.pinned.name}</span>, mas outra
          aba trocou a sessão para <span className="font-bold">{conflict.current.name}</span>. Pra
          evitar mexer nos dados da organização errada, escolha como seguir:
        </p>
        {backError && (
          <p className="text-xs text-red-600 dark:text-red-400 mb-3" role="alert">
            {backError}
          </p>
        )}
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
