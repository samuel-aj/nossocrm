'use client';

import { Trash2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { useDeleteSuggestion } from '@/lib/query/hooks';
import type { Suggestion } from '../types';
import { VoteButton } from './VoteButton';

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

  const canDelete =
    !!profile && (profile.role === 'super_admin' || profile.id === suggestion.author_id);

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

  return (
    <div className="flex gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-white/5">
      <VoteButton suggestion={suggestion} />

      <div className="min-w-0 flex-1">
        <p className="whitespace-pre-wrap break-words text-sm text-slate-800 dark:text-slate-100">
          {suggestion.content}
        </p>
        <div className="mt-2 flex items-center gap-2 text-xs text-slate-400">
          <span className="font-medium text-slate-500 dark:text-slate-300">
            {suggestion.author_name}
          </span>
          <span>·</span>
          <span>{formatDate(suggestion.created_at)}</span>
        </div>
      </div>

      {canDelete && (
        <button
          type="button"
          onClick={handleDelete}
          disabled={del.isPending}
          title="Apagar sugestão"
          className="self-start text-slate-300 transition-colors hover:text-red-500 disabled:opacity-50"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
