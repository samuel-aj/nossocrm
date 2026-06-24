'use client';

import type { Suggestion } from '../types';
import { SuggestionCard } from './SuggestionCard';

export function SuggestionList({
  suggestions,
  isLoading,
}: {
  suggestions: Suggestion[];
  isLoading?: boolean;
}) {
  if (isLoading) {
    return (
      <div className="py-10 text-center text-sm text-slate-400">Carregando sugestões...</div>
    );
  }

  if (!suggestions.length) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 py-10 text-center text-sm text-slate-400 dark:border-white/10">
        Nenhuma sugestão recebida ainda.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {suggestions.map(s => (
        <SuggestionCard key={s.id} suggestion={s} />
      ))}
    </div>
  );
}
