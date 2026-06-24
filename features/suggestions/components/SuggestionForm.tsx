'use client';

import { useState } from 'react';
import { Send } from 'lucide-react';
import { useCreateSuggestion } from '@/lib/query/hooks';
import { useToast } from '@/context/ToastContext';

const MAX = 2000;

export function SuggestionForm() {
  const [content, setContent] = useState('');
  const { addToast } = useToast();
  const create = useCreateSuggestion();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = content.trim();
    if (!text || create.isPending) return;
    try {
      await create.mutateAsync(text);
      setContent('');
      addToast('Sugestão enviada! Obrigado 🙌', 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Erro ao enviar sugestão', 'error');
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-white/5"
    >
      <textarea
        value={content}
        onChange={e => setContent(e.target.value.slice(0, MAX))}
        rows={3}
        placeholder="Sua sugestão de melhoria para o sistema..."
        className="w-full resize-none rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-white/10 dark:bg-black/20 dark:text-white"
      />
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-400">{content.length}/{MAX}</span>
        <button
          type="submit"
          disabled={!content.trim() || create.isPending}
          className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Send className="h-4 w-4" />
          {create.isPending ? 'Enviando...' : 'Enviar sugestão'}
        </button>
      </div>
    </form>
  );
}
