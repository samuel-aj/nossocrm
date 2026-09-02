'use client';

/**
 * Tags (Configurações → CRM): lista compacta com busca e criação inline.
 * Renomear não existe na API (a tag é referenciada pelo nome nos negócios).
 */
import React, { useMemo, useState } from 'react';
import { Plus, Search, Tag, X } from 'lucide-react';
import ConfirmModal from '@/components/ConfirmModal';
import { useSettings } from '@/context/settings/SettingsContext';
import { useToast } from '@/context/ToastContext';
import { SETTINGS_BTN_PRIMARY, SETTINGS_INPUT_CLASS, SettingsCard, SettingsEmpty } from './SettingsUi';

export const TagsManager: React.FC = () => {
  const { availableTags, addTag, removeTag } = useSettings();
  const { addToast } = useToast();
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState('');
  const [confirm, setConfirm] = useState<string | null>(null);

  const term = search.trim().toLowerCase();
  const visible = useMemo(
    () => [...availableTags].sort((a, b) => a.localeCompare(b, 'pt-BR')).filter((t) => !term || t.toLowerCase().includes(term)),
    [availableTags, term]
  );

  const create = async () => {
    const name = draft.trim();
    if (!name) return;
    if (availableTags.some((t) => t.toLowerCase() === name.toLowerCase())) {
      addToast('Essa tag já existe.', 'warning');
      return;
    }
    await addTag(name);
    setDraft('');
    addToast(`Tag "${name}" criada.`, 'success');
  };

  return (
    <SettingsCard
      title="Tags"
      description="Etiquetas para classificar os leads. Aparecem ao criar ou editar um negócio."
      icon={Tag}
      right={
        <span className="text-xs text-slate-400">
          {availableTags.length} {availableTags.length === 1 ? 'tag' : 'tags'}
        </span>
      }
    >
      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <div className="relative flex-1">
          <Plus size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void create()}
            placeholder="Nova tag (ex.: VIP, Urgente)"
            aria-label="Nova tag"
            maxLength={60}
            className={`${SETTINGS_INPUT_CLASS} pl-9`}
          />
        </div>
        <button type="button" className={SETTINGS_BTN_PRIMARY} onClick={() => void create()} disabled={!draft.trim()}>
          Criar tag
        </button>
        {availableTags.length > 8 ? (
          <div className="relative sm:w-56">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar"
              aria-label="Buscar tags"
              className={`${SETTINGS_INPUT_CLASS} pl-9`}
            />
          </div>
        ) : null}
      </div>

      {availableTags.length === 0 ? (
        <SettingsEmpty>Nenhuma tag ainda.</SettingsEmpty>
      ) : visible.length === 0 ? (
        <SettingsEmpty>Nenhuma tag com esse nome.</SettingsEmpty>
      ) : (
        <ul className="flex flex-wrap gap-2" aria-label="Tags">
          {visible.map((tag) => (
            <li
              key={tag}
              className="group inline-flex items-center gap-1.5 rounded-full border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 pl-3 pr-1.5 py-1 text-sm text-slate-800 dark:text-slate-100"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-primary-500" aria-hidden="true" />
              {tag}
              <button
                type="button"
                onClick={() => setConfirm(tag)}
                aria-label={`Excluir tag ${tag}`}
                title="Excluir"
                className="ml-0.5 p-0.5 rounded-full text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
              >
                <X size={13} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <ConfirmModal
        isOpen={confirm !== null}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm) void removeTag(confirm).then(() => addToast(`Tag "${confirm}" excluída.`, 'info'));
          setConfirm(null);
        }}
        title="Excluir tag?"
        message={`A tag "${confirm ?? ''}" sai da lista de opções. Negócios que já a usam continuam com ela.`}
        confirmText="Excluir"
        cancelText="Cancelar"
        variant="danger"
      />
    </SettingsCard>
  );
};

export default TagsManager;
