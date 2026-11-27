'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Wrench } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useAllFeedback, useMyFeedback } from '@/lib/query/hooks';
import { FEEDBACK_STATUSES, FEEDBACK_STATUS_LABEL } from '@/lib/feedback/constants';
import { FeedbackComposer } from './components/FeedbackComposer';
import { FeedbackList } from './components/FeedbackList';
import { FeedbackDetail } from './components/FeedbackDetail';

/** Ajustes: qualquer usuário manda e acompanha os próprios pedidos; o super_admin vê todos. */
export function FeedbackPage() {
  const { profile } = useAuth();
  const isSuper = profile?.role === 'super_admin';
  const params = useSearchParams();
  const [selected, setSelected] = useState<string | null>(params.get('pedido'));
  const [view, setView] = useState<'meus' | 'todos'>('meus');
  const [status, setStatus] = useState('');
  const mine = useMyFeedback();
  const [org, setOrg] = useState('');
  const all = useAllFeedback({ status: status || undefined });
  const orgs = [...new Map((all.data ?? []).map(r => [r.organization_id, r.organization_name ?? 'Sem nome'])).entries()];
  const source = view === 'todos' && isSuper ? all : mine;
  const rows = (source.data ?? []).filter(r => view !== 'todos' || !org || r.organization_id === org);

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6 sm:p-8">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900 dark:text-white"><Wrench className="h-6 w-6 text-primary-600" />Ajustes</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Achou um erro ou quer uma melhoria? Escreva, cole um print ou grave um áudio.</p>
      </header>
      <FeedbackComposer screenPath="/suggestions" />
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{view === 'todos' ? 'Todos os pedidos' : 'Meus pedidos'}</h2>
        {isSuper && (
          <div className="ml-auto flex gap-2 text-sm">
            <button type="button" onClick={() => setView(view === 'meus' ? 'todos' : 'meus')} className="rounded-lg border px-3 py-1 dark:border-white/10">
              {view === 'meus' ? 'Ver todos' : 'Ver só os meus'}
            </button>
            {view === 'todos' && (
              <select aria-label="Filtrar por escritório" value={org} onChange={e => setOrg(e.target.value)} className="rounded-lg border px-2 py-1 dark:border-white/10 dark:bg-dark-card">
                <option value="">Todos os escritórios</option>
                {orgs.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            )}
            {view === 'todos' && (
              <select aria-label="Filtrar por status" value={status} onChange={e => setStatus(e.target.value)} className="rounded-lg border px-2 py-1 dark:border-white/10 dark:bg-dark-card">
                <option value="">Todos os status</option>
                {FEEDBACK_STATUSES.map(s => <option key={s} value={s}>{FEEDBACK_STATUS_LABEL[s]}</option>)}
              </select>
            )}
          </div>
        )}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <FeedbackList rows={rows} isLoading={source.isLoading} selectedId={selected} onSelect={setSelected} showOrigin={view === 'todos'} />
        {selected && <div className="rounded-xl border border-slate-200 dark:border-white/10"><FeedbackDetail id={selected} /></div>}
      </div>
    </div>
  );
}
