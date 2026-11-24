'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Loader2, RefreshCw, ShieldAlert } from 'lucide-react';
import { NativeSelect } from '@/components/ui/NativeSelect';
import { detailLines, eventLabel, severityLabel } from './eventLabels';

/**
 * Registro de segurança (só super admin): eventos críticos gravados pelo
 * servidor e pelo banco, lidos por /api/security/events. A aba "Acessos" traz
 * o que o próprio Supabase Auth registra (login, saída, senha).
 */

type SecurityEventRow = {
  id: string;
  created_at: string;
  action: string;
  severity: string;
  actor: { id: string | null; name: string | null; email: string | null } | null;
  organization: { id: string; name: string | null } | null;
  resource_type: string;
  details: Record<string, unknown>;
  ip: string | null;
  user_agent: string | null;
};

type Source = 'events' | 'auth';

const SEVERITY_STYLE: Record<string, string> = {
  critical: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
  warning: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  info: 'bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300',
};

const dateFormat = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

export function SecurityEventsPanel({ organizations }: { organizations: Array<{ id: string; name: string }> }) {
  const [source, setSource] = useState<Source>('events');
  const [period, setPeriod] = useState('7d');
  const [severity, setSeverity] = useState('all');
  const [org, setOrg] = useState('all');
  const [events, setEvents] = useState<SecurityEventRow[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  // Só a resposta do pedido mais recente vale (troca rápida de filtro).
  const requestRef = useRef(0);

  const load = useCallback(
    async (before?: string) => {
      const params = new URLSearchParams({ period });
      if (source === 'auth') params.set('source', 'auth');
      else {
        if (severity !== 'all') params.set('severity', severity);
        if (org !== 'all') params.set('org', org);
        if (before) params.set('before', before);
      }
      const request = ++requestRef.current;
      if (before) setLoadingMore(true);
      else setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/security/events?${params}`, { credentials: 'include' });
        const body = (await res.json().catch(() => null)) as
          | { events?: SecurityEventRow[]; hasMore?: boolean; error?: string }
          | null;
        if (request !== requestRef.current) return;
        if (!res.ok) throw new Error(body?.error || 'Não foi possível carregar o registro.');
        const rows = body?.events ?? [];
        setEvents(prev => (before ? [...prev, ...rows] : rows));
        setHasMore(!!body?.hasMore);
      } catch (e) {
        if (request !== requestRef.current) return;
        setError(e instanceof Error ? e.message : 'Não foi possível carregar o registro.');
        if (!before) setEvents([]);
      } finally {
        if (request === requestRef.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [period, severity, org, source],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const tabClass = (active: boolean) =>
    `px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
      active
        ? 'bg-primary-600 text-white'
        : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/10'
    }`;

  return (
    <section className="bg-white dark:bg-dark-card border border-slate-200 dark:border-white/10 rounded-xl p-5 mt-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
        <div className="flex items-center gap-2">
          <ShieldAlert size={18} className="text-primary-500" aria-hidden="true" />
          <h3 className="font-bold text-slate-900 dark:text-white">Registro de segurança</h3>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-primary-600 disabled:opacity-50"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} aria-hidden="true" />
          Atualizar
        </button>
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
        Ações críticas de todas as organizações: equipe, chaves, integrações, exportações e tentativas recusadas.
        Os registros ficam guardados por 180 dias e não podem ser alterados nem apagados pelo CRM.
      </p>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="flex items-center gap-1" role="tablist" aria-label="Tipo de registro">
          <button type="button" role="tab" aria-selected={source === 'events'} className={tabClass(source === 'events')} onClick={() => setSource('events')}>
            Eventos
          </button>
          <button type="button" role="tab" aria-selected={source === 'auth'} className={tabClass(source === 'auth')} onClick={() => setSource('auth')}>
            Acessos
          </button>
        </div>
        <NativeSelect aria-label="Período" value={period} onChange={e => setPeriod(e.target.value)} className="w-auto text-sm">
          <option value="24h">Últimas 24 horas</option>
          <option value="7d">Últimos 7 dias</option>
          <option value="30d">Últimos 30 dias</option>
          <option value="90d">Últimos 90 dias</option>
        </NativeSelect>
        {source === 'events' && (
          <>
            <NativeSelect aria-label="Gravidade" value={severity} onChange={e => setSeverity(e.target.value)} className="w-auto text-sm">
              <option value="all">Toda gravidade</option>
              <option value="critical">Crítico</option>
              <option value="warning">Atenção</option>
              <option value="info">Informativo</option>
            </NativeSelect>
            <NativeSelect aria-label="Organização" value={org} onChange={e => setOrg(e.target.value)} className="w-auto text-sm max-w-[16rem]">
              <option value="all">Todas as organizações</option>
              {organizations.map(o => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </NativeSelect>
          </>
        )}
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400 mb-3">
          {error}
        </p>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-slate-500 py-6">
          <Loader2 size={16} className="animate-spin" aria-hidden="true" /> Carregando...
        </div>
      ) : events.length === 0 && !error ? (
        <p className="text-sm text-slate-500 dark:text-slate-400 py-6">
          {source === 'auth'
            ? 'Nenhum acesso registrado pelo Supabase neste período. Os logs completos de login ficam no painel do Supabase, em Logs > Auth.'
            : 'Nenhum evento neste período.'}
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-white/5">
          {events.map(ev => {
            const open = expanded === ev.id;
            const lines = detailLines(ev.details);
            const who = ev.actor?.name || ev.actor?.email || (ev.actor?.id ? 'Usuário removido' : 'Sem usuário');
            return (
              <li key={ev.id}>
                <button
                  type="button"
                  onClick={() => setExpanded(open ? null : ev.id)}
                  aria-expanded={open}
                  className="w-full flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-white/5 rounded-lg px-2"
                >
                  {open ? <ChevronDown size={14} className="text-slate-400" aria-hidden="true" /> : <ChevronRight size={14} className="text-slate-400" aria-hidden="true" />}
                  <span className="text-xs tabular-nums text-slate-500 w-36 shrink-0">{dateFormat.format(new Date(ev.created_at))}</span>
                  <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${SEVERITY_STYLE[ev.severity] ?? SEVERITY_STYLE.info}`}>
                    {severityLabel(ev.severity)}
                  </span>
                  <span className="text-sm font-medium text-slate-900 dark:text-white">{eventLabel(ev.action)}</span>
                  <span className="text-sm text-slate-500 dark:text-slate-400 truncate">
                    {who}
                    {ev.organization?.name ? ` · ${ev.organization.name}` : ''}
                  </span>
                </button>
                {open && (
                  <dl className="ml-9 mb-3 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-300">
                    {ev.actor?.email && (
                      <>
                        <dt className="text-slate-400">e-mail de quem fez</dt>
                        <dd className="break-all">{ev.actor.email}</dd>
                      </>
                    )}
                    {ev.ip && (
                      <>
                        <dt className="text-slate-400">IP</dt>
                        <dd>{ev.ip}</dd>
                      </>
                    )}
                    {ev.user_agent && (
                      <>
                        <dt className="text-slate-400">navegador</dt>
                        <dd className="break-all">{ev.user_agent}</dd>
                      </>
                    )}
                    {lines.map(([k, v]) => (
                      <React.Fragment key={k}>
                        <dt className="text-slate-400">{k}</dt>
                        <dd className="break-all">{v}</dd>
                      </React.Fragment>
                    ))}
                    <dt className="text-slate-400">código do evento</dt>
                    <dd>{ev.action}</dd>
                  </dl>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {hasMore && !loading && (
        <button
          type="button"
          onClick={() => void load(events[events.length - 1]?.created_at)}
          disabled={loadingMore}
          className="mt-3 text-sm font-medium text-primary-600 hover:text-primary-500 disabled:opacity-50 inline-flex items-center gap-1.5"
        >
          {loadingMore && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
          Carregar mais
        </button>
      )}
    </section>
  );
}
