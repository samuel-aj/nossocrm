import React, { useMemo, useState } from 'react';
import { PenTool, Pencil, Check, Copy, Plus, List, Tag, Trash2, FolderOpen } from 'lucide-react';
import { SettingsSection } from './SettingsSection';
import { CustomFieldDefinition, CustomFieldType } from '@/types';

interface CustomFieldsManagerProps {
  customFieldDefinitions: CustomFieldDefinition[];
  newFieldLabel: string;
  setNewFieldLabel: (label: string) => void;
  newFieldType: CustomFieldType;
  setNewFieldType: (type: CustomFieldType) => void;
  newFieldOptions: string;
  setNewFieldOptions: (options: string) => void;
  newFieldGroup: string;
  setNewFieldGroup: (group: string) => void;
  existingFieldGroups: string[];
  editingId: string | null;
  onStartEditing: (field: CustomFieldDefinition) => void;
  onCancelEditing: () => void;
  onSaveField: () => void;
  onRemoveField: (id: string) => void;
}

/**
 * Componente React `CustomFieldsManager`.
 *
 * @param {CustomFieldsManagerProps} {
  customFieldDefinitions,
  newFieldLabel,
  setNewFieldLabel,
  newFieldType,
  setNewFieldType,
  newFieldOptions,
  setNewFieldOptions,
  editingId,
  onStartEditing,
  onCancelEditing,
  onSaveField,
  onRemoveField
} - Parâmetro `{
  customFieldDefinitions,
  newFieldLabel,
  setNewFieldLabel,
  newFieldType,
  setNewFieldType,
  newFieldOptions,
  setNewFieldOptions,
  editingId,
  onStartEditing,
  onCancelEditing,
  onSaveField,
  onRemoveField
}`.
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export const CustomFieldsManager: React.FC<CustomFieldsManagerProps> = ({
  customFieldDefinitions,
  newFieldLabel,
  setNewFieldLabel,
  newFieldType,
  setNewFieldType,
  newFieldOptions,
  setNewFieldOptions,
  newFieldGroup,
  setNewFieldGroup,
  existingFieldGroups,
  editingId,
  onStartEditing,
  onCancelEditing,
  onSaveField,
  onRemoveField
}) => {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  // true = usuário escolheu "criar novo grupo" e está digitando o nome
  const [creatingGroup, setCreatingGroup] = useState(false);

  // Ao entrar/sair do modo edição, volta o controle de grupo pro select
  React.useEffect(() => {
    setCreatingGroup(false);
  }, [editingId]);

  // Lista agrupada: desagrupados primeiro, depois cada grupo em ordem alfabética
  const groupedList = useMemo(() => {
    const ungrouped = customFieldDefinitions.filter(f => !(f.groupName ?? '').trim());
    const groups = new Map<string, CustomFieldDefinition[]>();
    for (const f of customFieldDefinitions) {
      const g = (f.groupName ?? '').trim();
      if (!g) continue;
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g)!.push(f);
    }
    return {
      ungrouped,
      groups: Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0], 'pt-BR')),
    };
  }, [customFieldDefinitions]);

  const copyKey = async (key: string) => {
    try {
      await navigator.clipboard.writeText(key);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey((cur) => (cur === key ? null : cur)), 1500);
    } catch {
      // Clipboard pode falhar em contextos sem permissão; ignora silenciosamente.
    }
  };

  return (
    <SettingsSection title="Campos Personalizados" icon={PenTool}>
      <p className="text-sm text-slate-600 dark:text-slate-300 mb-4 leading-relaxed">
        Crie campos específicos para o seu negócio (ex: CNPJ, Data de Contrato, Origem). Eles aparecerão nos detalhes do negócio.
      </p>

      <div className={`p-4 rounded-xl border transition-all mb-6 ${editingId ? 'bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-500/20' : 'bg-slate-50 dark:bg-black/20 border-slate-200 dark:border-white/5'}`}>
        {editingId && (
          <div className="flex items-center gap-2 mb-3 text-amber-600 dark:text-amber-400 text-xs font-bold uppercase tracking-wider">
            <Pencil size={12} /> Editando Campo
          </div>
        )}
        <div className="flex gap-3 items-end mb-3">
          <div className="flex-1">
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Nome do Campo</label>
            <input
              type="text"
              value={newFieldLabel}
              onChange={(e) => setNewFieldLabel(e.target.value)}
              placeholder="Ex: Data de Contrato"
              className="w-full bg-white dark:bg-black/30 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary-500 dark:text-white"
            />
          </div>
          <div className="w-40">
            <label htmlFor="custom-field-type" className="block text-xs font-bold text-slate-500 uppercase mb-1">Tipo</label>
            <select
              id="custom-field-type"
              value={newFieldType}
              onChange={(e) => setNewFieldType(e.target.value as CustomFieldType)}
              className="w-full bg-white dark:bg-black/30 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary-500 dark:text-white"
            >
              <option value="text">Texto</option>
              <option value="number">Número</option>
              <option value="date">Data</option>
              <option value="currency">Financeiro (R$)</option>
              <option value="select">Seleção</option>
              <option value="multiselect">Múltipla Seleção</option>
            </select>
          </div>
          <div className="flex gap-2">
            {editingId && (
              <button
                onClick={onCancelEditing}
                className="bg-white dark:bg-white/5 hover:bg-slate-100 dark:hover:bg-white/10 text-slate-500 px-3 py-2 rounded-lg text-sm font-bold transition-colors h-[38px] border border-slate-200 dark:border-white/10"
              >
                Cancelar
              </button>
            )}
            <button
              onClick={onSaveField}
              disabled={!newFieldLabel.trim()}
              className={`${editingId ? 'bg-amber-600 hover:bg-amber-500 shadow-amber-600/20' : 'bg-primary-600 hover:bg-primary-500 shadow-primary-600/20'} text-white px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-colors h-[38px] shadow-lg`}
            >
              {editingId ? <Check size={16} /> : <Plus size={16} />}
              {editingId ? 'Salvar' : 'Criar'}
            </button>
          </div>
        </div>

        {/* GRUPO (opcional): separa campos por produto/pipeline. Escolhe um
            existente ou cria um novo; vazio = campo desagrupado (geral). */}
        <div className="mb-3">
          <label htmlFor="custom-field-group" className="block text-xs font-bold text-slate-500 uppercase mb-1 flex items-center gap-2">
            <FolderOpen size={12} /> Grupo (opcional)
          </label>
          {creatingGroup ? (
            <div className="flex gap-2">
              <input
                type="text"
                autoFocus
                value={newFieldGroup}
                onChange={(e) => setNewFieldGroup(e.target.value)}
                placeholder="Nome do novo grupo (ex: BPC LOAS)"
                className="flex-1 bg-white dark:bg-black/30 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary-500 dark:text-white"
              />
              <button
                type="button"
                onClick={() => {
                  setCreatingGroup(false);
                  setNewFieldGroup('');
                }}
                className="shrink-0 px-3 py-2 rounded-lg text-sm text-slate-500 border border-slate-200 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-white/10 transition-colors"
              >
                Cancelar
              </button>
            </div>
          ) : (
            <select
              id="custom-field-group"
              value={newFieldGroup}
              onChange={(e) => {
                if (e.target.value === '__new__') {
                  setCreatingGroup(true);
                  setNewFieldGroup('');
                  return;
                }
                setNewFieldGroup(e.target.value);
              }}
              className="w-full bg-white dark:bg-black/30 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary-500 dark:text-white cursor-pointer"
            >
              <option value="">Sem grupo (geral)</option>
              {existingFieldGroups.map((g) => (
                <option key={g} value={g}>{g}</option>
              ))}
              <option value="__new__">➕ Criar novo grupo…</option>
            </select>
          )}
          <p className="text-[10px] text-slate-400 mt-1">
            Use grupos pra separar campos de produtos/pipelines diferentes. No card do lead, cada grupo abre e fecha como uma sanfona.
          </p>
        </div>

        {(newFieldType === 'select' || newFieldType === 'multiselect') && (
          <div className="animate-in slide-in-from-top-2 fade-in duration-200">
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1 flex items-center gap-2">
              <List size={12} /> Opções (Separadas por vírgula)
            </label>
            <input
              type="text"
              value={newFieldOptions}
              onChange={(e) => setNewFieldOptions(e.target.value)}
              placeholder="Ex: Google, Facebook, Instagram, Indicação"
              className="w-full bg-white dark:bg-black/30 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary-500 dark:text-white"
            />
            <p className="text-[10px] text-slate-400 mt-1">
              {newFieldType === 'multiselect'
                ? 'O usuário poderá selecionar várias opções ao mesmo tempo.'
                : 'Essas opções aparecerão em um menu dropdown no detalhe do negócio.'}
            </p>
          </div>
        )}
      </div>

      <div className="space-y-2">
        {(() => {
          const renderFieldCard = (field: CustomFieldDefinition) => (
          <div key={field.id} className={`flex items-center justify-between p-3 bg-white dark:bg-white/5 border rounded-lg group transition-colors ${editingId === field.id ? 'border-amber-400 dark:border-amber-500/50 ring-1 ring-amber-400/30' : 'border-slate-200 dark:border-white/10 hover:border-primary-300 dark:hover:border-primary-500/50'}`}>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded bg-slate-100 dark:bg-white/10 flex items-center justify-center text-slate-500 dark:text-slate-400">
                <Tag size={14} />
              </div>
              <div>
                <p className="text-sm font-bold text-slate-900 dark:text-white">{field.label}</p>
                <div className="flex items-center gap-2 text-xs text-slate-500 font-mono mt-0.5">
                  <button
                    type="button"
                    onClick={() => copyKey(field.key)}
                    title="Copiar a chave (use no campo custom_fields da API/n8n)"
                    className="inline-flex items-center gap-1 rounded bg-slate-100 dark:bg-white/10 px-1.5 py-0.5 hover:text-primary-600 dark:hover:text-primary-400 hover:bg-slate-200 dark:hover:bg-white/15 transition-colors"
                  >
                    {copiedKey === field.key ? <Check size={11} className="text-green-600" /> : <Copy size={11} />}
                    {copiedKey === field.key ? 'copiado!' : field.key}
                  </button>
                  <span className="w-1 h-1 bg-slate-300 rounded-full"></span>
                  <span className="uppercase">{{ text: 'texto', number: 'número', date: 'data', select: 'seleção', multiselect: 'múltipla seleção', currency: 'financeiro' }[field.type] || field.type}</span>
                  {field.options && (
                    <>
                      <span className="w-1 h-1 bg-slate-300 rounded-full"></span>
                      <span className="text-primary-500">{field.options.length} opções</span>
                    </>
                  )}
                </div>
              </div>
            </div>
            <div className="flex gap-1">
              <button
                onClick={() => onStartEditing(field)}
                className="text-slate-400 hover:text-amber-500 p-2 rounded hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors"
                title="Editar campo"
              >
                <Pencil size={16} />
              </button>
              <button
                onClick={() => onRemoveField(field.id)}
                className="text-slate-400 hover:text-red-500 p-2 rounded hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                title="Remover campo"
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>
          );

          return (
            <>
              {/* Campos desagrupados (gerais) */}
              {groupedList.ungrouped.length > 0 && (
                <div className="space-y-2">
                  {groupedList.groups.length > 0 && (
                    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 pt-1">
                      Campos gerais (sem grupo)
                    </p>
                  )}
                  {groupedList.ungrouped.map(renderFieldCard)}
                </div>
              )}

              {/* Grupos */}
              {groupedList.groups.map(([groupName, fields]) => (
                <div key={groupName} className="space-y-2 pt-2">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-300 flex items-center gap-1.5">
                    <FolderOpen size={12} className="text-primary-500" />
                    {groupName}
                    <span className="font-normal text-slate-400 normal-case">· {fields.length} campo{fields.length === 1 ? '' : 's'}</span>
                  </p>
                  {fields.map(renderFieldCard)}
                </div>
              ))}

              {customFieldDefinitions.length === 0 && (
                <p className="text-center text-slate-500 text-sm py-4 italic">Nenhum campo personalizado criado.</p>
              )}
            </>
          );
        })()}
      </div>
    </SettingsSection>
  );
};
