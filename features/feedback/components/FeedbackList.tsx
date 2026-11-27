'use client';

import type { FeedbackRow } from '@/lib/query/hooks';
import { FEEDBACK_STATUS_LABEL } from '@/lib/feedback/constants';

export function FeedbackList({ rows, isLoading, isError, selectedId, onSelect, showOrigin }: {
  rows: FeedbackRow[]; isLoading: boolean; isError?: boolean; selectedId: string | null; onSelect: (id: string) => void; showOrigin?: boolean;
}) {
  if (isLoading) return <p className="text-sm text-slate-500">Carregando…</p>;
  if (isError && !rows.length) return <p role="alert" className="rounded-xl border border-dashed border-red-200 py-8 text-center text-sm text-red-600 dark:border-red-500/30">Não foi possível carregar os pedidos.</p>;
  if (!rows.length) return <p className="rounded-xl border border-dashed border-slate-200 py-8 text-center text-sm text-slate-500 dark:border-white/10">Nenhum pedido ainda.</p>;
  return (
    <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 dark:divide-white/5 dark:border-white/10">
      {rows.map(r => (
        <li key={r.id}>
          <button type="button" onClick={() => onSelect(r.id)}
            className={`flex w-full items-start justify-between gap-3 px-4 py-3 text-left text-sm ${selectedId === r.id ? 'bg-slate-50 dark:bg-white/5' : ''}`}>
            <span className="min-w-0">
              <span className="block truncate">{r.body || r.transcript || 'Pedido com anexos'}</span>
              <span className="text-xs text-slate-500">
                {new Date(r.created_at).toLocaleDateString('pt-BR')}
                {showOrigin && ` · ${r.organization_name ?? ''} · ${r.author_name ?? ''}`}
              </span>
            </span>
            <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs dark:bg-white/10">{FEEDBACK_STATUS_LABEL[r.status]}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
