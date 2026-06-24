'use client';

import { ThumbsUp } from 'lucide-react';
import { useVoteSuggestion } from '@/lib/query/hooks';
import type { Suggestion } from '../types';

export function VoteButton({ suggestion }: { suggestion: Suggestion }) {
  const vote = useVoteSuggestion();

  return (
    <button
      type="button"
      onClick={() => vote.mutate({ id: suggestion.id, voted: suggestion.voted_by_me })}
      disabled={vote.isPending}
      aria-pressed={suggestion.voted_by_me}
      title={suggestion.voted_by_me ? 'Remover voto' : 'Votar'}
      className={`flex h-14 w-12 shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg border text-sm font-semibold transition-colors disabled:opacity-50 ${
        suggestion.voted_by_me
          ? 'border-primary-500 bg-primary-50 text-primary-700 dark:bg-primary-500/15 dark:text-primary-300'
          : 'border-slate-200 text-slate-500 hover:border-primary-400 hover:text-primary-600 dark:border-white/10 dark:text-slate-300'
      }`}
    >
      <ThumbsUp className="h-4 w-4" />
      {suggestion.votes_count}
    </button>
  );
}
