import { useState } from 'react';
import { useToast } from '@/context/ToastContext';
import { CustomFieldDefinition, CustomFieldType } from '@/types';
import { usePersistedState } from '@/hooks/usePersistedState';
import { useCRM } from '@/context/CRMContext';

// TODO: Migrate customFieldDefinitions and tags to Supabase
// For now, using local state as placeholder
/**
 * Hook React `useSettingsController` que encapsula uma lógica reutilizável.
 * @returns {{ defaultRoute: string; setDefaultRoute: Dispatch<SetStateAction<string>>; customFieldDefinitions: CustomFieldDefinition[]; newFieldLabel: string; ... 14 more ...; removeTag: (tag: string) => void; }} Retorna um valor do tipo `{ defaultRoute: string; setDefaultRoute: Dispatch<SetStateAction<string>>; customFieldDefinitions: CustomFieldDefinition[]; newFieldLabel: string; ... 14 more ...; removeTag: (tag: string) => void; }`.
 */
export const useSettingsController = () => {
  const { addToast } = useToast();
  const {
    customFieldDefinitions,
    addCustomField,
    updateCustomField,
    removeCustomField,
    availableTags,
    addTag,
    removeTag,
  } = useCRM();

  // General Settings
  const [defaultRoute, setDefaultRoute] = usePersistedState<string>('crm_default_route', '/boards');

  const [newFieldLabel, setNewFieldLabel] = useState('');
  const [newFieldType, setNewFieldType] = useState<CustomFieldType>('text');
  const [newFieldOptions, setNewFieldOptions] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);

  const [newTagName, setNewTagName] = useState('');

  const normalizeFieldLabel = (label: string) =>
    label.trim().replace(/\s+/g, ' ').toLowerCase();

  const buildFieldKey = (label: string) =>
    label
      .toLowerCase()
      .replace(/(?:^\w|[A-Z]|\b\w)/g, (word, index) =>
        index === 0 ? word.toLowerCase() : word.toUpperCase()
      )
      .replace(/\s+/g, '');

  // Custom Fields Logic
  const startEditingField = (field: CustomFieldDefinition) => {
    setEditingId(field.id);
    setNewFieldLabel(field.label);
    setNewFieldType(field.type);
    setNewFieldOptions(field.options ? field.options.join(', ') : '');
  };

  const cancelEditingField = () => {
    setEditingId(null);
    setNewFieldLabel('');
    setNewFieldType('text');
    setNewFieldOptions('');
  };

  const handleSaveField = () => {
    const cleanedLabel = newFieldLabel.trim();
    if (!cleanedLabel) return;

    const normalizedLabel = normalizeFieldLabel(cleanedLabel);
    const nextKey = buildFieldKey(cleanedLabel);
    const hasDuplicateLabel = customFieldDefinitions.some((f) => {
      if (editingId && f.id === editingId) return false;
      return normalizeFieldLabel(f.label) === normalizedLabel;
    });
    const hasDuplicateKey = customFieldDefinitions.some((f) => {
      if (editingId && f.id === editingId) return false;
      return f.key === nextKey;
    });

    if (hasDuplicateLabel || hasDuplicateKey) {
      addToast('Já existe um campo com esse nome.', 'warning');
      return;
    }

    const optionsArray =
      newFieldType === 'select'
        ? newFieldOptions
          .split(',')
          .map(opt => opt.trim())
          .filter(opt => opt !== '')
        : undefined;

    if (editingId) {
      // UPDATE EXISTING
      updateCustomField(editingId, { label: cleanedLabel, type: newFieldType, options: optionsArray });
      addToast('Campo personalizado atualizado com sucesso!', 'success');
      cancelEditingField();
    } else {
      // CREATE NEW
      const key = nextKey;

      const newField: Omit<CustomFieldDefinition, 'id'> = {
        key,
        label: cleanedLabel,
        type: newFieldType,
        options: optionsArray,
      };

      addCustomField(newField);
      addToast('Campo personalizado criado com sucesso!', 'success');
      setNewFieldLabel('');
      setNewFieldOptions('');
    }
  };

  const handleRemoveField = (id: string) => {
    removeCustomField(id);
    addToast('Campo personalizado removido.', 'info');
  };

  // Tags Logic
  const handleAddTag = () => {
    if (newTagName.trim()) {
      addTag(newTagName.trim());
      addToast(`Tag "${newTagName}" adicionada!`, 'success');
      setNewTagName('');
    }
  };

  const handleRemoveTag = (tag: string) => {
    removeTag(tag);
    addToast(`Tag "${tag}" removida.`, 'info');
  };

  return {
    // General Settings
    defaultRoute,
    setDefaultRoute,

    // Custom Fields
    customFieldDefinitions,
    newFieldLabel,
    setNewFieldLabel,
    newFieldType,
    setNewFieldType,
    newFieldOptions,
    setNewFieldOptions,
    editingId,
    startEditingField,
    cancelEditingField,
    handleSaveField,
    removeCustomField: handleRemoveField,

    // Tags
    availableTags,
    newTagName,
    setNewTagName,
    handleAddTag,
    removeTag: handleRemoveTag,
  };
};
