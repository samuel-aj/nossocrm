'use client';

import { Lightbulb } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useSuggestions } from '@/lib/query/hooks';
import { SuggestionForm } from './components/SuggestionForm';
import { SuggestionList } from './components/SuggestionList';

/**
 * Página de Sugestões/Feedback (beta): QUALQUER usuário logado pode enviar uma
 * sugestão. A LISTA global (de todas as organizações) só aparece para super_admin.
 */
export function SuggestionsPage() {
  const { profile } = useAuth();
  const isSuperAdmin = profile?.role === 'super_admin';
  const { data: suggestions = [], isLoading } = useSuggestions();

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

      {isSuperAdmin ? (
        <SuggestionList suggestions={suggestions} isLoading={isLoading} />
      ) : (
        <p className="rounded-xl border border-dashed border-slate-200 py-8 text-center text-sm text-slate-400 dark:border-white/10">
          Obrigado! Sua sugestão vai direto para a equipe. 💜
        </p>
      )}
    </div>
  );
}
