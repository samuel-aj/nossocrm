'use client';

import { Lightbulb } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useSuggestions } from '@/lib/query/hooks';
import { SuggestionForm } from './components/SuggestionForm';
import { SuggestionList } from './components/SuggestionList';

/**
 * Pagina de Sugestoes/Feedback (beta): qualquer usuario logado posta uma
 * sugestao e vota nas dos colegas da mesma organizacao.
 */
export function SuggestionsPage() {
  const { profile, loading } = useAuth();
  const isAdmin = profile?.role === 'admin' || profile?.role === 'super_admin';
  const { data: suggestions = [], isLoading } = useSuggestions();

  if (!loading && profile && !isAdmin) {
    return (
      <div className="space-y-6 p-6 sm:p-8 max-w-3xl mx-auto">
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center dark:border-white/10 dark:bg-white/5">
          <Lightbulb className="mx-auto h-8 w-8 text-slate-300" />
          <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
            Esta área é exclusiva para administradores.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6 sm:p-8 max-w-3xl mx-auto">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900 dark:text-white">
          <Lightbulb className="h-6 w-6 text-primary-600" />
          Sugestões
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Mande suas ideias e melhorias.
        </p>
      </header>

      <SuggestionForm />

      <SuggestionList suggestions={suggestions} isLoading={isLoading} />
    </div>
  );
}
