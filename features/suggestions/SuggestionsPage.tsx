'use client';

import { Lightbulb } from 'lucide-react';
import { useSuggestions } from '@/lib/query/hooks';
import { SuggestionForm } from './components/SuggestionForm';
import { SuggestionList } from './components/SuggestionList';

/**
 * Pagina de Sugestoes/Feedback (beta): qualquer usuario logado posta uma
 * sugestao e vota nas dos colegas da mesma organizacao.
 */
export function SuggestionsPage() {
  const { data: suggestions = [], isLoading } = useSuggestions();

  return (
    <div className="space-y-6 p-6 sm:p-8 max-w-3xl mx-auto">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900 dark:text-white">
          <Lightbulb className="h-6 w-6 text-primary-600" />
          Sugestões
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          O sistema está em beta. Mande suas ideias e melhorias — e vote nas que você
          quer ver primeiro.
        </p>
      </header>

      <SuggestionForm />

      <SuggestionList suggestions={suggestions} isLoading={isLoading} />
    </div>
  );
}
