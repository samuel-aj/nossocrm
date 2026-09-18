'use client';

/**
 * Campos compartilhados entre robôs e agentes de IA:
 * - LeadChangesEditor: lista de alterações do lead (campo · o que fazer · valor),
 *   com o valor no formato do tipo do campo personalizado;
 * - LossFields: classificação e motivo da perda quando a etapa marca o lead
 *   como perdido (motivos da organização, com "Outro" livre).
 */
import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useOrgPreferences } from '@/lib/query/hooks/useOrgPreferences';
import { DEFAULT_DISQUALIFIED_REASONS, DEFAULT_QUALIFIED_REASONS } from '@/components/ui/LossReasonModal';
import type { WaAgentOptions } from './useWaAgents';
import { HELP_CLASS, INPUT_CLASS } from './ui';

export type LeadChangeRow = {
  field: 'title' | 'value' | 'description' | 'owner_id' | 'custom_field';
  key: string;
  mode: 'replace' | 'append' | 'clear';
  value: string;
};

const FIELD_LABELS: Record<LeadChangeRow['field'], string> = {
  title: 'Título do lead',
  value: 'Valor',
  description: 'Descrição',
  owner_id: 'Responsável',
  custom_field: 'Campo personalizado',
};

const MODE_LABELS: Record<LeadChangeRow['mode'], string> = {
  replace: 'Substituir por',
  append: 'Acrescentar',
  clear: 'Limpar',
};

/** Modos que fazem sentido para o campo (valor e responsável não "acrescentam"). */
function modesFor(row: LeadChangeRow, fieldType?: string): LeadChangeRow['mode'][] {
  if (row.field === 'title') return ['replace', 'append'];
  if (row.field === 'value' || row.field === 'owner_id') return ['replace', 'clear'];
  if (row.field === 'custom_field' && fieldType && ['number', 'currency', 'date', 'select'].includes(fieldType)) {
    return ['replace', 'clear'];
  }
  return ['replace', 'append', 'clear'];
}

const SMALL_BTN =
  'p-1.5 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:text-red-400 dark:hover:bg-red-900/20 transition-colors';

export function LeadChangesEditor<T extends LeadChangeRow>({
  rows,
  onChange,
  makeRow,
  options,
  idPrefix,
  renderText,
  createMode = false,
}: {
  rows: T[];
  onChange: (rows: T[]) => void;
  /** Linha nova (o robô precisa de id; o agente não) */
  makeRow: (row: LeadChangeRow) => T;
  options: WaAgentOptions | undefined;
  idPrefix: string;
  /** Campo de texto com variáveis (cada tela usa o seu) */
  renderText?: (props: { id: string; value: string; onChange: (v: string) => void; ariaLabel: string; placeholder: string }) => React.ReactNode;
  /** Na criação do lead não existe "limpar" nem "acrescentar" */
  createMode?: boolean;
}) {
  const fields = options?.custom_fields ?? [];
  const owners = options?.owners ?? [];
  const set = (i: number, patch: Partial<LeadChangeRow>) => onChange(rows.map((r, j) => (j === i ? ({ ...r, ...patch } as T) : r)));

  const valueInput = (row: T, i: number) => {
    const id = `${idPrefix}-${i}-value`;
    const ariaLabel = `Valor da alteração ${i + 1}`;
    const setValue = (value: string) => set(i, { value });
    if (row.mode === 'clear') return <p className={`${HELP_CLASS} py-2`}>O campo fica vazio.</p>;
    if (row.field === 'owner_id') {
      return (
        <select id={id} className={INPUT_CLASS} value={row.value} aria-label={ariaLabel} onChange={(e) => setValue(e.target.value)}>
          <option value="">Escolha o responsável</option>
          {owners.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      );
    }
    const def = row.field === 'custom_field' ? fields.find((f) => f.key === row.key) : undefined;
    if (def?.type === 'select' && (def.options ?? []).length > 0 && !row.value.includes('{{')) {
      return (
        <select id={id} className={INPUT_CLASS} value={row.value} aria-label={ariaLabel} onChange={(e) => setValue(e.target.value)}>
          <option value="">Escolha a opção</option>
          {(def.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
    }
    const placeholder =
      row.field === 'value' || def?.type === 'number' || def?.type === 'currency'
        ? 'ex.: 1500,00 ou {{variável}}'
        : def?.type === 'date'
          ? 'dd/mm/aaaa ou {{variável}}'
          : def?.type === 'multiselect'
            ? `opções separadas por vírgula (${(def.options ?? []).join(', ')})`
            : 'texto ou {{variável}}';
    if (renderText) return renderText({ id, value: row.value, onChange: setValue, ariaLabel, placeholder });
    return <input id={id} className={INPUT_CLASS} value={row.value} placeholder={placeholder} aria-label={ariaLabel} onChange={(e) => setValue(e.target.value)} />;
  };

  return (
    <div className="space-y-2">
      {rows.map((row, i) => {
        const def = row.field === 'custom_field' ? fields.find((f) => f.key === row.key) : undefined;
        const modes = createMode ? (['replace'] as LeadChangeRow['mode'][]) : modesFor(row, def?.type);
        return (
          <div key={i} className="rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 p-2 space-y-1.5">
            <div className="flex items-center gap-1">
              <select
                className={`${INPUT_CLASS} flex-1 min-w-0`}
                value={row.field}
                aria-label={`Campo da alteração ${i + 1}`}
                onChange={(e) => {
                  const field = e.target.value as LeadChangeRow['field'];
                  set(i, { field, key: '', value: '', mode: 'replace' });
                }}
              >
                {(Object.keys(FIELD_LABELS) as LeadChangeRow['field'][]).map((f) => (
                  <option key={f} value={f}>
                    {FIELD_LABELS[f]}
                  </option>
                ))}
              </select>
              <button type="button" className={SMALL_BTN} aria-label={`Remover alteração ${i + 1}`} onClick={() => onChange(rows.filter((_, j) => j !== i))}>
                <Trash2 size={14} aria-hidden="true" />
              </button>
            </div>
            {row.field === 'custom_field' ? (
              <select
                className={INPUT_CLASS}
                value={row.key}
                aria-label={`Campo personalizado da alteração ${i + 1}`}
                onChange={(e) => set(i, { key: e.target.value, value: '', mode: 'replace' })}
              >
                <option value="">{fields.length === 0 ? 'Nenhum campo personalizado cadastrado' : 'Escolha o campo'}</option>
                {fields.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label}
                  </option>
                ))}
                {row.key && !fields.some((f) => f.key === row.key) ? <option value={row.key}>{row.key} (não existe mais)</option> : null}
              </select>
            ) : null}
            {modes.length > 1 ? (
              <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={`O que fazer na alteração ${i + 1}`}>
                {modes.map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={row.mode === m}
                    className={`px-2 py-0.5 rounded-full text-xs border transition-colors ${
                      row.mode === m
                        ? 'border-primary-500 bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-200'
                        : 'border-slate-300 text-slate-600 dark:border-white/15 dark:text-slate-300'
                    }`}
                    onClick={() => set(i, { mode: m })}
                  >
                    {MODE_LABELS[m]}
                  </button>
                ))}
              </div>
            ) : null}
            {valueInput(row, i)}
          </div>
        );
      })}
      <button
        type="button"
        className="inline-flex items-center gap-1 text-xs font-medium text-primary-600 dark:text-primary-300 hover:underline"
        onClick={() => onChange([...rows, makeRow({ field: 'custom_field', key: '', mode: 'replace', value: '' })])}
      >
        <Plus size={12} aria-hidden="true" />
        {createMode ? 'Adicionar dado inicial' : 'Adicionar campo'}
      </button>
      <p className={HELP_CLASS}>
        {createMode
          ? 'Sem título, o lead leva o nome do contato. Sem responsável, vale o rodízio da organização.'
          : 'Só os campos listados mudam; o resto do lead fica como está. "Acrescentar" junta ao que já existe (na descrição, numa linha nova).'}
      </p>
    </div>
  );
}

/** Motivos efetivos da organização (os configurados ou os padrão). */
function useLossReasons(category: 'qualified' | 'disqualified'): string[] {
  const prefs = useOrgPreferences();
  const custom = category === 'disqualified' ? prefs.lossReasonsDisqualified : prefs.lossReasonsQualified;
  if (custom && custom.length > 0) return custom;
  return (category === 'disqualified' ? DEFAULT_DISQUALIFIED_REASONS : DEFAULT_QUALIFIED_REASONS).map((r) => r.value);
}

/** Classificação + motivo da perda (mesmas opções da tela do lead). */
export function LossFields({
  idPrefix,
  category,
  reason,
  onChange,
  renderText,
}: {
  idPrefix: string;
  category: '' | 'qualified' | 'disqualified';
  reason: string;
  onChange: (patch: { category?: '' | 'qualified' | 'disqualified'; reason?: string }) => void;
  renderText?: (props: { id: string; value: string; onChange: (v: string) => void; ariaLabel: string; placeholder: string }) => React.ReactNode;
}) {
  const effective = category || 'qualified';
  const reasons = useLossReasons(effective);
  const isPreset = reasons.includes(reason);
  const [custom, setCustom] = React.useState(!!reason && !isPreset);
  return (
    <div className="rounded-lg border border-red-200 dark:border-red-500/30 bg-red-50/60 dark:bg-red-900/10 p-2 space-y-1.5">
      <p className="text-xs font-semibold text-red-700 dark:text-red-300">Esta etapa marca o lead como perdido</p>
      <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Classificação da perda">
        {(
          [
            ['qualified', 'Qualificado'],
            ['disqualified', 'Desqualificado'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={effective === value}
            className={`px-2 py-0.5 rounded-full text-xs border transition-colors ${
              effective === value
                ? 'border-red-500 bg-white text-red-700 dark:bg-red-900/30 dark:text-red-200'
                : 'border-slate-300 text-slate-600 dark:border-white/15 dark:text-slate-300'
            }`}
            onClick={() => onChange({ category: value, reason: '' })}
          >
            {label}
          </button>
        ))}
      </div>
      <select
        id={`${idPrefix}-reason`}
        className={INPUT_CLASS}
        aria-label="Motivo da perda"
        value={custom ? '__outro__' : reason}
        onChange={(e) => {
          if (e.target.value === '__outro__') {
            setCustom(true);
            onChange({ category: effective, reason: '' });
          } else {
            setCustom(false);
            onChange({ category: effective, reason: e.target.value });
          }
        }}
      >
        <option value="">Sem motivo</option>
        {reasons.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
        <option value="__outro__">Outro (escrever)</option>
      </select>
      {custom
        ? renderText
          ? renderText({
              id: `${idPrefix}-reason-text`,
              value: reason,
              onChange: (v) => onChange({ category: effective, reason: v }),
              ariaLabel: 'Motivo da perda (texto)',
              placeholder: 'Motivo (aceita {{variável}})',
            })
          : (
            <input
              id={`${idPrefix}-reason-text`}
              className={INPUT_CLASS}
              value={reason}
              maxLength={200}
              placeholder="Motivo"
              aria-label="Motivo da perda (texto)"
              onChange={(e) => onChange({ category: effective, reason: e.target.value })}
            />
          )
        : null}
      <p className={HELP_CLASS}>Classificação e motivo ficam no cadastro do lead e no histórico dele.</p>
    </div>
  );
}
