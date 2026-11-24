'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Building2, CalendarDays, ChevronDown, ChevronRight, Gauge, Loader2, RefreshCw, ShieldAlert } from 'lucide-react';
import { NativeSelect } from '@/components/ui/NativeSelect';
import { detailLines, eventLabel, severityLabel } from './eventLabels';
import { FilterField, FilterSelect, type FilterOption } from './FilterSelect';

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

const PERIODS: FilterOption[] = [
  { value: '24h', label: 'Últimas 24 horas' },
  { value: '7d', label: 'Últimos 7 dias' },
  { value: '30d', label: 'Últimos 30 dias' },
  { value: '90d', label: 'Últimos 90 dias' },
];
const SEVERITY_FILTERS: FilterOption[] = [
  { value: 'important', label: 'Importantes', description: 'Atenção e críticos', dot: 'bg-amber-500' },
  { value: 'critical', label: 'Só críticos', description: 'O que pede ação imediata', dot: 'bg-red-500' },
  { value: 'all', label: 'Tudo', description: 'Inclui os informativos', dot: 'bg-slate-400' },
];

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
  // Abre só no que importa (atenção + crítico); o informativo fica a um clique.
  const [severity, setSeverity] = useState('important');
  const [summary, setSummary] = useState<{ critical: number; warning: number } | null>(null);
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
          | { events?: SecurityEventRow[]; hasMore?: boolean; error?: string; summary?: { critical: number; warning: number } | null }
          | null;
        if (request !== requestRef.current) return;
        if (!res.ok) throw new Error(body?.error || 'Não foi possível carregar o registro.');
        const rows = body?.events ?? [];
        setEvents(prev => (before ? [...prev, ...rows] : rows));
        setHasMore(!!body?.hasMore);
        if (!before) setSummary(body?.summary ?? null);
      } catch (e) {
        if (request !== requestRef.current) return;
        setError(e instanceof Error ? e.message : 'Não foi possível carregar o registro.');
        if (!before) {
          setEvents([]);
          setSummary(null);
        }
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

  // Abas "Eventos" e "Acessos".
  const groupClass = 'inline-flex items-center gap-0.5 rounded-lg bg-slate-100 dark:bg-white/5 p-0.5';
  const pillClass = (active: boolean) =>
    `px-3 py-1 rounded-md text-sm font-medium whitespace-nowrap transition-colors ${
      active
        ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white'
        : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
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

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mb-3">
        <div className={groupClass} role="tablist" aria-label="Tipo de registro">
          <button type="button" role="tab" aria-selected={source === 'events'} className={pillClass(source === 'events')} onClick={() => setSource('events')}>
            Eventos
          </button>
          <button type="button" role="tab" aria-selected={source === 'auth'} className={pillClass(source === 'auth')} onClick={() => setSource('auth')}>
            Acessos
          </button>
        </div>
        <FilterSelect
          icon={<CalendarDays size={13} aria-hidden="true" />}
          label="Período"
          value={period}
          onChange={setPeriod}
          options={PERIODS}
          widthClass="w-44"
        />
        {source === 'events' && (
          <>
            <FilterSelect
              icon={<Gauge size={13} aria-hidden="true" />}
              label="Gravidade"
              value={severity}
              onChange={setSeverity}
              options={SEVERITY_FILTERS}
              widthClass="w-40"
            />
            <FilterField icon={<Building2 size={13} aria-hidden="true" />} label="Organização">
              <NativeSelect
                aria-label="Organização"
                value={org}
                onChange={e => setOrg(e.target.value)}
                className="w-60 rounded-l-none rounded-r-lg border-0 bg-transparent py-1.5 text-sm hover:border-0 focus-visible:ring-0 dark:border-0 dark:bg-transparent"
              >
                <option value="all">Todas</option>
                {organizations.map(o => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </NativeSelect>
            </FilterField>
          </>
        )}
      </div>

      {source === 'events' && summary && (
        <p className="text-sm text-slate-600 dark:text-slate-300 mb-3">
          No período: <strong className="text-red-600 dark:text-red-400">{summary.critical}</strong>{' '}
          {summary.critical === 1 ? 'crítico' : 'críticos'} e{' '}
          <strong className="text-amber-600 dark:text-amber-400">{summary.warning}</strong> de atenção.
        </p>
      )}

      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400 mb-3">
          {error}
        </p>
      )}

      {loading && events.length === 0 ? (
        <div className="flex items-center gap-2 text-sm text-slate-500 py-6">
          <Loader2 size={16} className="animate-spin" aria-hidden="true" /> Carregando...
        </div>
      ) : events.length === 0 && !error ? (
        <p className="text-sm text-slate-500 dark:text-slate-400 py-6">
          {source === 'auth'
            ? 'Nenhum acesso registrado pelo Supabase neste período. Os logs completos de login ficam no painel do Supabase, em Logs > Auth.'
            : severity === 'all'
              ? 'Nenhum evento neste período.'
              : 'Nenhum evento importante neste período. Para ver também os informativos, escolha "Tudo".'}
        </p>
      ) : (
        <ul
          aria-busy={loading}
          className={`max-h-[28rem] overflow-y-auto overscroll-contain rounded-lg border border-slate-100 dark:border-white/5 divide-y divide-slate-100 dark:divide-white/5 transition-opacity ${loading ? 'opacity-50' : ''}`}
        >
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

      {!loading && events.length > 0 && (
        <p className="mt-2 text-xs text-slate-400">
          {events.length} {events.length === 1 ? 'registro carregado' : 'registros carregados'}
          {hasMore ? '. Há mais registros antigos neste período.' : '.'}
        </p>
      )}

      {hasMore && !loading && (
        <button
          type="button"
          onClick={() => void load(events[events.length - 1]?.created_at)}
          disabled={loadingMore}
          className="mt-1 text-sm font-medium text-primary-600 hover:text-primary-500 disabled:opacity-50 inline-flex items-center gap-1.5"
        >
          {loadingMore && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
          Carregar mais
        </button>
      )}
    </section>
  );
}
