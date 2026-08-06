import React from 'react';
import { Tag, Plus, X } from 'lucide-react';
import { SettingsSection } from './SettingsSection';

interface TagsManagerProps {
  availableTags: string[];
  newTagName: string;
  setNewTagName: (name: string) => void;
  onAddTag: () => void;
  onRemoveTag: (tag: string) => void;
}

/**
 * Componente React `TagsManager`.
 *
 * @param {TagsManagerProps} {
  availableTags,
  newTagName,
  setNewTagName,
  onAddTag,
  onRemoveTag
} - Parâmetro `{
  availableTags,
  newTagName,
  setNewTagName,
  onAddTag,
  onRemoveTag
}`.
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export const TagsManager: React.FC<TagsManagerProps> = ({
  availableTags,
  newTagName,
  setNewTagName,
  onAddTag,
  onRemoveTag
}) => {
  return (
    <SettingsSection title="Gerenciamento de Tags" icon={Tag}>
      <p className="text-sm text-slate-600 dark:text-slate-300 mb-4 leading-relaxed">
        Crie tags para categorizar seus negócios. Elas aparecerão como opções ao criar ou editar negócios no Pipeline.
      </p>

      <div className="p-4 rounded-xl border bg-slate-50 dark:bg-black/20 border-slate-200 dark:border-white/5 mb-6">
        <div className="flex gap-3 items-end">
          <div className="flex-1">
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Nome da Tag</label>
            <input
              type="text"
              value={newTagName}
              onChange={(e) => setNewTagName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && onAddTag()}
              placeholder="Ex: VIP, Urgente, Q4..."
              className="w-full bg-white dark:bg-black/30 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary-500 dark:text-white"
            />
          </div>
          <button
            onClick={onAddTag}
            disabled={!newTagName.trim()}
            className="bg-primary-600 hover:bg-primary-500 shadow-primary-600/20 text-white px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-colors h-[38px] shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Plus size={16} /> Adicionar
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {availableTags.map(tag => (
          <div key={tag} className="flex items-center gap-2 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 group hover:border-red-300 dark:hover:border-red-500/50 transition-colors">
            <Tag size={14} className="text-slate-400" />
            <span className="text-sm font-medium text-slate-900 dark:text-white">{tag}</span>
            <button
              onClick={() => onRemoveTag(tag)}
              className="text-slate-400 hover:text-red-500 p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors opacity-0 group-hover:opacity-100 max-md:opacity-100"
              title="Remover tag"
            >
              <X size={14} />
            </button>
          </div>
        ))}
        {availableTags.length === 0 && (
          <p className="text-center text-slate-500 text-sm py-4 italic w-full">Nenhuma tag criada.</p>
        )}
      </div>
    </SettingsSection>
  );
};
