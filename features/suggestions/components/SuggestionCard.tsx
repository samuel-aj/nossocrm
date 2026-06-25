'use client';

import { Check, X, Trash2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { useDeleteSuggestion, useSetSuggestionStatus } from '@/lib/query/hooks';
import type { Suggestion, SuggestionStatus } from '../types';

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return '';
  }
}

export function SuggestionCard({ suggestion }: { suggestion: Suggestion }) {
  const { profile } = useAuth();
  const { addToast } = useToast();
  const del = useDeleteSuggestion();
  const setStatus = useSetSuggestionStatus();

  const isSuperAdmin = profile?.role === 'super_admin';
  const status = suggestion.status;
  const marked = status !== 'pending';

  // Clicar no status atual desmarca (volta pra pendente).
  const mark = async (next: SuggestionStatus) => {
    if (setStatus.isPending) return;
    const target: SuggestionStatus = status === next ? 'pending' : next;
    try {
      await setStatus.mutateAsync({ id: suggestion.id, status: target });
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Erro ao atualizar', 'error');
    }
  };

  const handleDelete = async () => {
    if (del.isPending) return;
    if (!window.confirm('Apagar esta sugestão?')) return;
    try {
      await del.mutateAsync(suggestion.id);
      addToast('Sugestão removida', 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Erro ao remover', 'error');
    }
  };

  const cardTone =
    status === 'done'
      ? 'border-emerald-200 bg-emerald-50/40 dark:border-emerald-900/40 dark:bg-emerald-500/5'
      : status === 'discarded'
        ? 'border-slate-200 bg-slate-50 dark:border-white/10 dark:bg-white/5'
        : 'border-slate-200 bg-white dark:border-white/10 dark:bg-white/5';

  return (
    <div className={`flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-start sm:justify-between ${cardTone}`}>
      <div className={`min-w-0 flex-1 ${marked ? 'opacity-70' : ''}`}>
        <p className="whitespace-pre-wrap break-words text-sm text-slate-800 dark:text-slate-100">
          {suggestion.content}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-400">
          <span className="font-medium text-slate-500 dark:text-slate-300">
            {suggestion.author_name}
          </span>
          {suggestion.organization_name && (
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-white/10 dark:text-slate-300">
              {suggestion.organization_name}
            </span>
          )}
          <span>·</span>
          <span>{formatDate(suggestion.created_at)}</span>
          {status === 'done' && (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
              FEITO
            </span>
          )}
          {status === 'discarded' && (
            <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-600 dark:bg-white/15 dark:text-slate-300">
              DESCARTADO
            </span>
          )}
        </div>
      </div>

      {isSuperAdmin && (
        <div className="flex shrink-0 items-center gap-1.5 self-start">
          <button
            type="button"
            onClick={() => mark('done')}
            disabled={setStatus.isPending}
            title={status === 'done' ? 'Desmarcar' : 'Marcar como feito'}
            className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
              status === 'done'
                ? 'border-emerald-500 bg-emerald-500 text-white'
                : 'border-slate-200 text-slate-500 hover:border-emerald-400 hover:text-emerald-600 dark:border-white/10 dark:text-slate-300'
            }`}
          >
            <Check className="h-3.5 w-3.5" />
            Feito
          </button>
          <button
            type="button"
            onClick={() => mark('discarded')}
            disabled={setStatus.isPending}
            title={status === 'discarded' ? 'Desmarcar' : 'Descartar'}
            className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
              status === 'discarded'
                ? 'border-slate-500 bg-slate-500 text-white'
                : 'border-slate-200 text-slate-500 hover:border-slate-400 hover:text-slate-700 dark:border-white/10 dark:text-slate-300'
            }`}
          >
            <X className="h-3.5 w-3.5" />
            Descartar
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={del.isPending}
            title="Apagar sugestão"
            className="self-center text-slate-300 transition-colors hover:text-red-500 disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
