import React, { useMemo, useState } from 'react';
import { Loader2, Tag as TagIcon, X } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';

/**
 * Adicionar/remover TAGS em massa nos contatos selecionados da lista.
 * O próprio modal é a confirmação: mostra o que vai acontecer e em quantos
 * contatos antes do botão de aplicar. Tags separadas por vírgula.
 */
export const BulkTagsModal: React.FC<{
  mode: 'add' | 'remove';
  count: number;
  busy: boolean;
  onClose: () => void;
  onConfirm: (tags: string[]) => void;
}> = ({ mode, count, busy, onClose, onConfirm }) => {
  const [texto, setTexto] = useState('');

  // "quente, proposta enviada" -> ["quente", "proposta enviada"] sem repetidas
  const tags = useMemo(() => {
    const vistas = new Set<string>();
    const lista: string[] = [];
    for (const parte of texto.split(',')) {
      const t = parte.trim();
      const chave = t.toLowerCase();
      if (t && !vistas.has(chave)) {
        vistas.add(chave);
        lista.push(t);
      }
    }
    return lista;
  }, [texto]);

  const titulo = mode === 'add' ? 'Adicionar tags' : 'Remover tags';

  return (
    <Modal isOpen onClose={onClose} title={titulo} size="md">
      <div className="space-y-4">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {mode === 'add' ? (
            <>As tags serão adicionadas a <span className="font-bold">{count}</span> contato(s) selecionado(s). Quem já tiver a tag não a recebe de novo.</>
          ) : (
            <>As tags serão removidas de <span className="font-bold">{count}</span> contato(s) selecionado(s). Quem não tiver a tag não é alterado.</>
          )}
        </p>

        <div>
          <label htmlFor="bulk-tags-input" className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
            Tags (separe várias por vírgula)
          </label>
          <input
            id="bulk-tags-input"
            autoFocus
            value={texto}
            onChange={e => setTexto(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && tags.length > 0 && !busy) onConfirm(tags);
            }}
            placeholder="Ex.: quente, proposta enviada"
            className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500 outline-none"
          />
        </div>

        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5" aria-label="Tags a aplicar">
            {tags.map(t => (
              <span
                key={t.toLowerCase()}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs bg-primary-50 text-primary-700 ring-1 ring-inset ring-primary-100 dark:bg-primary-500/10 dark:text-primary-300 dark:ring-primary-400/20"
              >
                <TagIcon size={11} aria-hidden="true" /> {t}
              </span>
            ))}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-white/5">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="px-4 py-2 rounded-lg text-sm font-medium text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-white/10 disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            <X size={14} aria-hidden="true" /> Cancelar
          </button>
          <button
            type="button"
            onClick={() => onConfirm(tags)}
            disabled={busy || tags.length === 0}
            className={`px-4 py-2 rounded-lg text-sm font-bold text-white disabled:opacity-50 inline-flex items-center gap-2 ${
              mode === 'add' ? 'bg-primary-600 hover:bg-primary-500' : 'bg-red-600 hover:bg-red-500'
            }`}
          >
            {busy && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
            {mode === 'add' ? `Adicionar em ${count} contato(s)` : `Remover de ${count} contato(s)`}
          </button>
        </div>
      </div>
    </Modal>
  );
};
