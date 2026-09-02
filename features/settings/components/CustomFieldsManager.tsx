'use client';

/**
 * Campos personalizados (Configurações → CRM): lista agrupada e enxuta
 * (arraste para reordenar ou mover de grupo), busca, criação/edição num
 * modal com o essencial primeiro e a chave técnica em "Configurações
 * avançadas". Grupos podem ser criados vazios, reordenados e excluídos (os
 * campos voltam para "Campos gerais").
 *
 * Persistência: SettingsContext (/api/custom-fields, /api/custom-field-groups).
 * A ordem manual usa a coluna `position` (migração 20260902130000); sem ela a
 * lista fica na ordem de criação e o arrastar avisa que não pôde salvar.
 */
import React, { useMemo, useRef, useState } from 'react';
import {
  Check,
  Copy,
  FolderOpen,
  FolderPlus,
  GripVertical,
  Pencil,
  Plus,
  Search,
  Trash2,
  Type,
  Hash,
  Calendar,
  CircleDollarSign,
  ListChecks,
  List,
  type LucideIcon,
} from 'lucide-react';
import ConfirmModal from '@/components/ConfirmModal';
import { Modal } from '@/components/ui/Modal';
import { Disclosure } from '@/components/ui/Disclosure';
import { KebabMenu } from '@/components/ui/KebabMenu';
import { useSettings } from '@/context/settings/SettingsContext';
import { useToast } from '@/context/ToastContext';
import type { CustomFieldDefinition, CustomFieldType } from '@/types';
import {
  SETTINGS_BTN_PRIMARY,
  SETTINGS_BTN_SECONDARY,
  SETTINGS_BTN_SMALL,
  SETTINGS_INPUT_CLASS,
  SettingsCard,
  SettingsEmpty,
} from './SettingsUi';

const TYPE_META: Record<CustomFieldType, { label: string; icon: LucideIcon }> = {
  text: { label: 'Texto', icon: Type },
  number: { label: 'Número', icon: Hash },
  date: { label: 'Data', icon: Calendar },
  currency: { label: 'Moeda (R$)', icon: CircleDollarSign },
  select: { label: 'Seleção', icon: List },
  multiselect: { label: 'Múltipla seleção', icon: ListChecks },
};
const TYPES = Object.keys(TYPE_META) as CustomFieldType[];

const normalizeLabel = (label: string) => label.trim().replace(/\s+/g, ' ').toLowerCase();

/** Chave técnica (camelCase, só [a-zA-Z0-9_]) a partir do nome: o rótulo fica como digitado. */
export function buildFieldKey(label: string): string {
  const key = label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/(?:^\w|[A-Z]|\b\w)/g, (word, index) => (index === 0 ? word.toLowerCase() : word.toUpperCase()))
    .replace(/[^a-zA-Z0-9_]/g, '')
    .replace(/^[0-9_]+/, '');
  return key || 'campo';
}

const UNGROUPED = '';

type Draft = {
  id: string | null;
  label: string;
  type: CustomFieldType;
  optionsText: string;
  groupName: string;
  key: string;
  keyTouched: boolean;
};

const EMPTY_DRAFT: Draft = { id: null, label: '', type: 'text', optionsText: '', groupName: '', key: '', keyTouched: false };

type DropTarget = { group: string; index: number } | null;

export const CustomFieldsManager: React.FC = () => {
  const {
    customFieldDefinitions,
    addCustomField,
    updateCustomField,
    removeCustomField,
    customFieldGroups,
    addCustomFieldGroup,
    removeCustomFieldGroup,
    reorderCustomFields,
    reorderCustomFieldGroups,
  } = useSettings();
  const { addToast } = useToast();

  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [newGroupMode, setNewGroupMode] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmField, setConfirmField] = useState<CustomFieldDefinition | null>(null);
  const [confirmGroup, setConfirmGroup] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  // Arrasto de campo (alça) e de grupo (alça do cabeçalho)
  const [draggingField, setDraggingField] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget>(null);
  const [draggingGroup, setDraggingGroup] = useState<string | null>(null);
  const [groupDropIndex, setGroupDropIndex] = useState<number | null>(null);
  const armed = useRef(false);

  // Grupos: os da tabela (podem estar vazios) + nomes que só existem em campos antigos
  const groups = useMemo(() => {
    const names = [...customFieldGroups.map((g) => g.trim()).filter(Boolean)];
    for (const f of customFieldDefinitions) {
      const g = (f.groupName ?? '').trim();
      if (g && !names.includes(g)) names.push(g);
    }
    return names;
  }, [customFieldGroups, customFieldDefinitions]);

  const byGroup = useMemo(() => {
    const map = new Map<string, CustomFieldDefinition[]>();
    map.set(UNGROUPED, []);
    for (const g of groups) map.set(g, []);
    for (const f of customFieldDefinitions) {
      const g = (f.groupName ?? '').trim();
      map.get(map.has(g) ? g : UNGROUPED)!.push(f);
    }
    return map;
  }, [groups, customFieldDefinitions]);

  const term = normalizeLabel(search);
  const matches = (f: CustomFieldDefinition) =>
    !term || normalizeLabel(f.label).includes(term) || f.key.toLowerCase().includes(term) || (f.groupName ?? '').toLowerCase().includes(term);

  // ------------------------------------------------------------- modal
  const openCreate = (groupName = '') => setDraft({ ...EMPTY_DRAFT, groupName });
  const openEdit = (f: CustomFieldDefinition) =>
    setDraft({
      id: f.id,
      label: f.label,
      type: f.type,
      optionsText: (f.options ?? []).join('\n'),
      groupName: (f.groupName ?? '').trim(),
      key: f.key,
      keyTouched: true,
    });

  const draftKey = draft ? (draft.keyTouched ? draft.key : buildFieldKey(draft.label)) : '';
  const isSelect = draft?.type === 'select' || draft?.type === 'multiselect';

  const saveDraft = async () => {
    if (!draft) return;
    const label = draft.label.trim();
    if (!label) return addToast('Dê um nome ao campo.', 'warning');
    const key = draft.id ? draft.key : buildFieldKey(draft.keyTouched ? draft.key : label);
    const dupLabel = customFieldDefinitions.some((f) => f.id !== draft.id && normalizeLabel(f.label) === normalizeLabel(label));
    const dupKey = customFieldDefinitions.some((f) => f.id !== draft.id && f.key === key);
    if (dupLabel || dupKey) return addToast('Já existe um campo com esse nome.', 'warning');
    const options = isSelect
      ? draft.optionsText
          .split(/\r?\n|,/)
          .map((o) => o.trim())
          .filter(Boolean)
      : undefined;
    if (isSelect && (options?.length ?? 0) === 0) return addToast('Informe ao menos uma opção.', 'warning');
    const groupName = draft.groupName.trim() || null;
    setSaving(true);
    try {
      if (draft.id) {
        await updateCustomField(draft.id, { label, type: draft.type, options, groupName });
        addToast('Campo atualizado.', 'success');
      } else {
        const created = await addCustomField({ key, label, type: draft.type, options, groupName });
        if (!created) return;
        addToast('Campo criado.', 'success');
      }
      setDraft(null);
    } finally {
      setSaving(false);
    }
  };

  const createGroup = async () => {
    const name = newGroupName.trim();
    if (!name) return;
    if (groups.some((g) => g.toLowerCase() === name.toLowerCase())) {
      addToast('Já existe um grupo com esse nome.', 'warning');
      return;
    }
    const ok = await addCustomFieldGroup(name);
    if (ok) {
      setNewGroupName('');
      setNewGroupMode(false);
      addToast(`Grupo "${name}" criado. Arraste campos para dentro.`, 'success');
    }
  };

  const copyKey = async (key: string) => {
    try {
      await navigator.clipboard.writeText(key);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey((c) => (c === key ? null : c)), 1500);
    } catch {
      // sem permissão: a chave continua visível
    }
  };

  // ------------------------------------------------------------- arrastar campos
  const finishFieldDrag = () => {
    setDraggingField(null);
    setDropTarget(null);
    armed.current = false;
  };

  const dropField = async () => {
    if (!draggingField || !dropTarget) return finishFieldDrag();
    const field = customFieldDefinitions.find((f) => f.id === draggingField);
    const target = dropTarget;
    finishFieldDrag();
    if (!field) return;
    const fromGroup = (field.groupName ?? '').trim();
    const source = byGroup.get(byGroup.has(fromGroup) ? fromGroup : UNGROUPED) ?? [];
    const dest = target.group === fromGroup ? source : (byGroup.get(target.group) ?? []);
    const without = dest.filter((f) => f.id !== field.id);
    const fromIndex = source.findIndex((f) => f.id === field.id);
    let index = target.index;
    if (target.group === fromGroup && fromIndex >= 0 && fromIndex < index) index -= 1;
    const nextIds = [...without.map((f) => f.id)];
    nextIds.splice(Math.max(0, Math.min(index, nextIds.length)), 0, field.id);
    if (target.group !== fromGroup) await updateCustomField(field.id, { groupName: target.group || null });
    const ok = await reorderCustomFields(nextIds);
    if (!ok) addToast('O campo foi movido, mas a ordem manual não pôde ser salva (migração pendente no banco).', 'warning');
  };

  const groupDropProps = (group: string, count: number) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!draggingField) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      // Área vazia do grupo (fora das linhas): vai para o fim
      if (e.target === e.currentTarget) setDropTarget({ group, index: count });
    },
    onDrop: (e: React.DragEvent) => {
      if (!draggingField) return;
      e.preventDefault();
      if (!dropTarget) setDropTarget({ group, index: count });
      void dropField();
    },
  });

  // ------------------------------------------------------------- arrastar grupos
  const dropGroup = async () => {
    if (!draggingGroup || groupDropIndex === null) return;
    const from = groups.indexOf(draggingGroup);
    const next = [...groups];
    next.splice(from, 1);
    let to = groupDropIndex;
    if (from < to) to -= 1;
    next.splice(Math.max(0, Math.min(to, next.length)), 0, draggingGroup);
    setDraggingGroup(null);
    setGroupDropIndex(null);
    if (next.join(' ') === groups.join(' ')) return;
    const ok = await reorderCustomFieldGroups(next);
    if (!ok) addToast('A ordem dos grupos não pôde ser salva (migração pendente no banco).', 'warning');
  };

  // ------------------------------------------------------------- linhas
  const renderField = (f: CustomFieldDefinition, group: string, index: number) => {
    const meta = TYPE_META[f.type] ?? TYPE_META.text;
    const Icon = meta.icon;
    const isOver = dropTarget?.group === group && dropTarget.index === index && draggingField && draggingField !== f.id;
    return (
      <li
        key={f.id}
        draggable
        onDragStart={(e) => {
          if (!armed.current) {
            e.preventDefault();
            return;
          }
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', f.id);
          setDraggingField(f.id);
        }}
        onDragOver={(e) => {
          if (!draggingField) return;
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = 'move';
          const rect = e.currentTarget.getBoundingClientRect();
          const after = e.clientY > rect.top + rect.height / 2;
          const idx = after ? index + 1 : index;
          if (dropTarget?.group !== group || dropTarget.index !== idx) setDropTarget({ group, index: idx });
        }}
        onDrop={(e) => {
          if (!draggingField) return;
          e.preventDefault();
          e.stopPropagation();
          void dropField();
        }}
        onDragEnd={finishFieldDrag}
        className={`group relative flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${
          draggingField === f.id ? 'opacity-40' : 'hover:bg-slate-50 dark:hover:bg-white/5'
        }`}
      >
        {isOver ? <span className="absolute left-2 right-2 -top-px h-0.5 rounded-full bg-primary-500" aria-hidden="true" /> : null}
        <button
          type="button"
          aria-label={`Arrastar ${f.label}`}
          title="Arraste para reordenar ou mover de grupo"
          onPointerDown={() => {
            armed.current = true;
          }}
          onPointerUp={() => {
            armed.current = false;
          }}
          className="shrink-0 -ml-1 cursor-grab active:cursor-grabbing text-slate-300 hover:text-slate-500 dark:text-slate-600 dark:hover:text-slate-300 opacity-60 group-hover:opacity-100 transition-opacity"
        >
          <GripVertical size={14} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => openEdit(f)}
          className="flex-1 min-w-0 flex items-center gap-3 text-left rounded-md focus-visible-ring"
          aria-label={`Editar ${f.label}`}
        >
          <span className="text-sm font-medium text-slate-900 dark:text-white truncate">{f.label}</span>
          <span className="hidden sm:inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 shrink-0">
            <Icon size={12} aria-hidden="true" />
            {meta.label}
            {f.options && f.options.length > 0 ? <span className="text-slate-400">· {f.options.length} opções</span> : null}
          </span>
        </button>
        <button
          type="button"
          onClick={() => void copyKey(f.key)}
          title="Copiar a chave (custom_fields na API e no n8n)"
          className="hidden md:inline-flex items-center gap-1 font-mono text-[11px] text-slate-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors shrink-0"
        >
          {copiedKey === f.key ? <Check size={11} className="text-green-600" aria-hidden="true" /> : <Copy size={11} aria-hidden="true" />}
          {copiedKey === f.key ? 'copiado' : f.key}
        </button>
        <KebabMenu
          label={`Mais ações: ${f.label}`}
          items={[
            { label: 'Editar', icon: <Pencil size={14} aria-hidden="true" />, onSelect: () => openEdit(f) },
            { label: 'Copiar chave', icon: <Copy size={14} aria-hidden="true" />, onSelect: () => void copyKey(f.key) },
            { label: 'Excluir', icon: <Trash2 size={14} aria-hidden="true" />, danger: true, onSelect: () => setConfirmField(f) },
          ]}
        />
      </li>
    );
  };

  const renderGroup = (group: string, gi: number) => {
    const all = byGroup.get(group) ?? [];
    const visible = all.filter(matches);
    if (term && visible.length === 0) return null;
    const isGeneral = group === UNGROUPED;
    if (isGeneral && all.length === 0 && groups.length === 0 && !term) return null;
    const groupOver = draggingGroup && groupDropIndex === gi && draggingGroup !== group;
    return (
      <section
        key={group || '__geral'}
        className={`relative rounded-xl border transition-colors ${
          dropTarget?.group === group && draggingField
            ? 'border-primary-400 bg-primary-500/5'
            : 'border-slate-200 dark:border-white/10'
        }`}
        onDragOver={(e) => {
          if (!draggingGroup || isGeneral) return;
          e.preventDefault();
          const rect = e.currentTarget.getBoundingClientRect();
          setGroupDropIndex(e.clientY > rect.top + rect.height / 2 ? gi + 1 : gi);
        }}
        onDrop={(e) => {
          if (!draggingGroup) return;
          e.preventDefault();
          void dropGroup();
        }}
      >
        {groupOver ? <span className="absolute left-3 right-3 -top-1 h-0.5 rounded-full bg-primary-500" aria-hidden="true" /> : null}
        <header className="flex items-center gap-2 px-3 py-2 border-b border-slate-100 dark:border-white/5">
          {!isGeneral ? (
            <button
              type="button"
              draggable
              aria-label={`Arrastar grupo ${group}`}
              title="Arraste para reordenar os grupos"
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', `group:${group}`);
                setDraggingGroup(group);
              }}
              onDragEnd={() => {
                setDraggingGroup(null);
                setGroupDropIndex(null);
              }}
              className="shrink-0 -ml-1 cursor-grab active:cursor-grabbing text-slate-300 hover:text-slate-500 dark:text-slate-600 dark:hover:text-slate-300"
            >
              <GripVertical size={14} aria-hidden="true" />
            </button>
          ) : null}
          <FolderOpen size={14} className={isGeneral ? 'text-slate-400' : 'text-primary-500'} aria-hidden="true" />
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300 truncate">
            {isGeneral ? 'Campos gerais' : group}
          </h3>
          <span className="text-xs text-slate-400">
            {all.length} {all.length === 1 ? 'campo' : 'campos'}
          </span>
          <span className="flex-1" />
          <button type="button" className={SETTINGS_BTN_SMALL} onClick={() => openCreate(group)}>
            <Plus size={13} aria-hidden="true" /> Campo
          </button>
          {!isGeneral ? (
            <KebabMenu
              label={`Mais ações do grupo ${group}`}
              items={[
                {
                  label: 'Excluir grupo',
                  icon: <Trash2 size={14} aria-hidden="true" />,
                  danger: true,
                  onSelect: () => setConfirmGroup(group),
                },
              ]}
            />
          ) : null}
        </header>
        <ul className="p-1.5 min-h-[2.5rem]" {...groupDropProps(group, all.length)}>
          {visible.map((f) => renderField(f, group, all.indexOf(f)))}
          {all.length === 0 ? (
            <li className="px-3 py-3 text-xs text-slate-400 italic text-center">
              {isGeneral ? 'Nenhum campo geral.' : 'Grupo vazio. Arraste campos para cá ou crie um campo.'}
            </li>
          ) : null}
        </ul>
      </section>
    );
  };

  const total = customFieldDefinitions.length;

  return (
    <SettingsCard
      title="Campos personalizados"
      description="Os campos extras do lead, organizados em grupos. Aparecem no detalhe do negócio e na API."
      icon={Type}
      right={
        <button type="button" className={SETTINGS_BTN_PRIMARY} onClick={() => openCreate()}>
          <Plus size={16} aria-hidden="true" /> Novo campo
        </button>
      }
    >
      <div className="flex items-center gap-2 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar campos"
            aria-label="Buscar campos"
            className={`${SETTINGS_INPUT_CLASS} pl-9`}
          />
        </div>
        <span className="text-xs text-slate-400 hidden sm:inline">
          {total} {total === 1 ? 'campo' : 'campos'} · {groups.length} {groups.length === 1 ? 'grupo' : 'grupos'}
        </span>
      </div>

      {total === 0 && groups.length === 0 ? (
        <SettingsEmpty>Nenhum campo personalizado ainda. Crie o primeiro para ele aparecer no cadastro dos leads.</SettingsEmpty>
      ) : (
        <div className="space-y-3">
          {renderGroup(UNGROUPED, -1)}
          {groups.map((g, i) => renderGroup(g, i))}
        </div>
      )}

      <div className="mt-4">
        {newGroupMode ? (
          <div className="flex items-center gap-2 max-w-md">
            <div className="relative flex-1">
              <FolderPlus size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <input
                autoFocus
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void createGroup();
                  if (e.key === 'Escape') setNewGroupMode(false);
                }}
                placeholder="Nome do grupo (ex.: Dados pessoais)"
                maxLength={60}
                aria-label="Nome do novo grupo"
                className={`${SETTINGS_INPUT_CLASS} pl-9`}
              />
            </div>
            <button type="button" className={SETTINGS_BTN_PRIMARY} onClick={() => void createGroup()} disabled={!newGroupName.trim()}>
              Criar
            </button>
            <button type="button" className={SETTINGS_BTN_SECONDARY} onClick={() => setNewGroupMode(false)}>
              Cancelar
            </button>
          </div>
        ) : (
          <button type="button" className={SETTINGS_BTN_SECONDARY} onClick={() => setNewGroupMode(true)}>
            <FolderPlus size={15} aria-hidden="true" /> Criar grupo
          </button>
        )}
      </div>

      {/* Criar / editar campo */}
      <Modal isOpen={draft !== null} onClose={() => setDraft(null)} title={draft?.id ? 'Editar campo' : 'Novo campo'} size="lg">
        {draft ? (
          <div className="space-y-4">
            <div>
              <label htmlFor="cf-label" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                Nome do campo
              </label>
              <input
                id="cf-label"
                autoFocus
                className={SETTINGS_INPUT_CLASS}
                value={draft.label}
                onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                placeholder="Ex.: Data de nascimento"
                maxLength={120}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="cf-type" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Tipo
                </label>
                <select
                  id="cf-type"
                  className={SETTINGS_INPUT_CLASS}
                  value={draft.type}
                  onChange={(e) => setDraft({ ...draft, type: e.target.value as CustomFieldType })}
                >
                  {TYPES.map((t) => (
                    <option key={t} value={t}>
                      {TYPE_META[t].label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="cf-group" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Grupo
                </label>
                <select
                  id="cf-group"
                  className={SETTINGS_INPUT_CLASS}
                  value={draft.groupName}
                  onChange={(e) => setDraft({ ...draft, groupName: e.target.value })}
                >
                  <option value="">Campos gerais (sem grupo)</option>
                  {groups.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {isSelect ? (
              <div>
                <label htmlFor="cf-options" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Opções <span className="font-normal text-slate-400">(uma por linha)</span>
                </label>
                <textarea
                  id="cf-options"
                  className={`${SETTINGS_INPUT_CLASS} resize-y`}
                  rows={5}
                  value={draft.optionsText}
                  onChange={(e) => setDraft({ ...draft, optionsText: e.target.value })}
                  placeholder={'Google\nInstagram\nIndicação'}
                />
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  {draft.type === 'multiselect' ? 'A pessoa poderá marcar várias opções.' : 'A pessoa escolhe uma opção numa lista.'}
                </p>
              </div>
            ) : null}
            <Disclosure label="Configurações avançadas">
              <div>
                <label htmlFor="cf-key" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Chave técnica
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id="cf-key"
                    className={`${SETTINGS_INPUT_CLASS} font-mono`}
                    value={draftKey}
                    readOnly={!!draft.id}
                    onChange={(e) => setDraft({ ...draft, key: e.target.value.replace(/[^a-zA-Z0-9_]/g, ''), keyTouched: true })}
                    maxLength={80}
                  />
                  <button type="button" className={SETTINGS_BTN_SECONDARY} onClick={() => void copyKey(draftKey)} title="Copiar chave">
                    {copiedKey === draftKey ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
                  </button>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  {draft.id
                    ? 'A chave não muda depois de criada: integrações e automações dependem dela.'
                    : 'Identificador usado na API e no n8n (custom_fields). Gerado a partir do nome; só letras, números e _.'}
                </p>
              </div>
            </Disclosure>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-white/5">
              <button type="button" className={SETTINGS_BTN_SECONDARY} onClick={() => setDraft(null)}>
                Cancelar
              </button>
              <button type="button" className={SETTINGS_BTN_PRIMARY} onClick={() => void saveDraft()} disabled={saving || !draft.label.trim()}>
                {saving ? 'Salvando...' : draft.id ? 'Salvar' : 'Criar campo'}
              </button>
            </div>
          </div>
        ) : null}
      </Modal>

      <ConfirmModal
        isOpen={confirmField !== null}
        onClose={() => setConfirmField(null)}
        onConfirm={() => {
          if (confirmField) void removeCustomField(confirmField.id).then(() => addToast('Campo excluído.', 'info'));
          setConfirmField(null);
        }}
        title="Excluir campo?"
        message={`O campo "${confirmField?.label ?? ''}" deixa de aparecer nos leads. Os valores já preenchidos não são apagados dos negócios.`}
        confirmText="Excluir"
        cancelText="Cancelar"
        variant="danger"
      />
      <ConfirmModal
        isOpen={confirmGroup !== null}
        onClose={() => setConfirmGroup(null)}
        onConfirm={() => {
          if (confirmGroup) void removeCustomFieldGroup(confirmGroup).then((ok) => ok && addToast('Grupo excluído. Os campos foram para Campos gerais.', 'info'));
          setConfirmGroup(null);
        }}
        title="Excluir grupo?"
        message={`Os campos de "${confirmGroup ?? ''}" não são apagados: voltam para Campos gerais.`}
        confirmText="Excluir grupo"
        cancelText="Cancelar"
        variant="danger"
      />
    </SettingsCard>
  );
};

export default CustomFieldsManager;
