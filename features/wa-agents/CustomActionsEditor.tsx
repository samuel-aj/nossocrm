'use client';

/**
 * Ações que o agente executa DURANTE a conversa (sem encerrar), como cartões
 * compactos: nome, "Quando: ..." e chips do que acontece. Editar abre a
 * configuração completa num modal (o mesmo padrão dos resultados do
 * encerramento). "Inserir no roteiro" (marca `[[acao:chave]]` no cursor da
 * aba Roteiro) fica no menu "..." e dentro da edição.
 */
import React, { useState } from 'react';
import { FileText, Plus, Zap } from 'lucide-react';
import type { AgentAiVar, CustomAction } from '@/lib/wa-agents/types';
import type { WaAgentListItem, WaAgentOptions } from './useWaAgents';
import { ActionSummary, ActionsEditor, slugifyKey, type ActionType } from './OutcomesEditor';
import { actionToken } from './PromptEditor';
import { RuleEditorModal, RuleList } from './RuleList';
import { BTN_SMALL, Disclosure, Field, INPUT_CLASS, TEXTAREA_CLASS, TokenChip } from './ui';

/**
 * Ações de encerramento não fazem sentido no meio da conversa: a ação
 * durante a conversa nunca encerra o atendimento (isso é papel dos resultados).
 */
const HIDDEN_ACTION_TYPES: ActionType[] = ['handoff', 'approval', 'stop', 'start_bot'];

/** Chave única a partir de uma base ("nova-acao", "nova-acao-2"...). */
export function uniqueKey(base: string, taken: string[]): string {
  let key = base || 'item';
  let n = 2;
  while (taken.includes(key)) key = `${base}-${n++}`;
  return key;
}

/**
 * Componente React `CustomActionsEditor`.
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export const CustomActionsEditor: React.FC<{
  value: CustomAction[];
  onChange: (value: CustomAction[]) => void;
  agents: WaAgentListItem[];
  options: WaAgentOptions | undefined;
  aiVars?: AgentAiVar[];
  onAiVarsChange?: (vars: AgentAiVar[]) => void;
  currentAgentId?: string | null;
  /** Insere o marcador `[[acao:chave]]` no cursor do roteiro (o editor pai troca de aba) */
  onInsertToken?: (token: string) => void;
}> = ({ value, onChange, agents, options, aiVars = [], onAiVarsChange = () => {}, currentAgentId, onInsertToken }) => {
  const [editing, setEditing] = useState<number | null>(null);

  const update = (index: number, patch: Partial<CustomAction>) => {
    onChange(value.map((a, i) => (i === index ? { ...a, ...patch } : a)));
  };
  const add = () => {
    const key = uniqueKey('nova-acao', value.map((a) => a.key));
    onChange([...value, { key, label: 'Nova ação', description: '', actions: [] }]);
    setEditing(value.length);
  };
  const setLabel = (index: number, label: string) => {
    const current = value[index];
    // Se a chave ainda segue o nome (ou está vazia), acompanha a mudança.
    const follows = !current.key || current.key === slugifyKey(current.label);
    update(index, { label, ...(follows ? { key: slugifyKey(label) } : {}) });
  };

  const item = editing !== null ? value[editing] : null;
  const idPrefix = `custom-action-${editing ?? 0}`;
  const token = item ? actionToken(item.key || slugifyKey(item.label) || 'chave') : '';

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {value.length === 0 ? 'Executa e o atendimento continua.' : `${value.length} ${value.length === 1 ? 'ação' : 'ações'}. Executa e o atendimento continua.`}
        </p>
        <button type="button" className={BTN_SMALL} onClick={add}>
          <Plus size={14} aria-hidden="true" /> Nova ação
        </button>
      </div>

      <RuleList
        items={value}
        onChange={(next) => {
          onChange(next);
          if (editing !== null && editing >= next.length) setEditing(null);
        }}
        keyOf={(a, i) => `${a.key || 'sem-chave'}-${i}`}
        itemLabel="ação"
        emptyText="Nenhuma ação durante a conversa. O agente só age no encerramento, pelos resultados."
        onEdit={setEditing}
        duplicate={(a, all) => ({
          ...a,
          key: uniqueKey(a.key || 'acao', all.map((x) => x.key)),
          label: `${a.label} (cópia)`,
          actions: a.actions.map((x) => ({ ...x })),
        })}
        render={(a) => ({
          icon: <Zap size={14} aria-hidden="true" />,
          title: a.label.trim() || 'Sem nome',
          subtitle: a.description.trim() ? (
            <>
              <span className="font-medium text-slate-600 dark:text-slate-300">Quando:</span> {a.description}
            </>
          ) : (
            <span className="text-amber-700 dark:text-amber-300">Descreva quando esta ação acontece.</span>
          ),
          body: (
            <ActionSummary
              actions={a.actions}
              agents={agents}
              options={options}
              emptyText="Sem ações no CRM: só o evento de webhook é disparado."
            />
          ),
          extraMenu:
            onInsertToken && a.key
              ? [
                  {
                    label: 'Inserir no roteiro',
                    icon: <FileText size={14} aria-hidden="true" />,
                    onSelect: () => onInsertToken(actionToken(a.key)),
                  },
                ]
              : [],
        })}
      />

      <RuleEditorModal
        open={item !== null}
        onClose={() => setEditing(null)}
        title={item ? `Ação durante a conversa: ${item.label.trim() || 'Sem nome'}` : 'Ação durante a conversa'}
      >
        {item && editing !== null ? (
          <>
            <Field label="Nome" htmlFor={`${idPrefix}-label`}>
              <input
                id={`${idPrefix}-label`}
                className={INPUT_CLASS}
                value={item.label}
                onChange={(e) => setLabel(editing, e.target.value)}
                maxLength={80}
                placeholder="Ex.: Cliente já tem advogado"
              />
            </Field>

            <Field
              label="Quando ativar"
              htmlFor={`${idPrefix}-description`}
              tip='Em linguagem natural. Ex.: "o cliente informar que já tem advogado" ou "a pessoa pedir o endereço do escritório". Para marcar o momento exato, insira o marcador no roteiro.'
            >
              <textarea
                id={`${idPrefix}-description`}
                className={TEXTAREA_CLASS}
                rows={2}
                value={item.description}
                onChange={(e) => update(editing, { description: e.target.value })}
                maxLength={600}
                placeholder="Ex.: o cliente informar que já tem advogado"
              />
            </Field>

            <ActionsEditor
              value={item.actions}
              onChange={(actions) => update(editing, { actions })}
              agents={agents}
              options={options}
              aiVars={aiVars}
              onAiVarsChange={onAiVarsChange}
              currentAgentId={currentAgentId}
              idPrefix={idPrefix}
              hiddenTypes={HIDDEN_ACTION_TYPES}
              emptyText="Sem ações no CRM: só o evento de webhook é disparado."
            />

            <Disclosure label="Avançado">
              <div className="space-y-3">
                <Field
                  label="Chave"
                  htmlFor={`${idPrefix}-key`}
                  tip="Nome interno que o modelo usa para chamar esta ação. Só letras minúsculas, números, hífen e sublinhado."
                >
                  <input
                    id={`${idPrefix}-key`}
                    className={`${INPUT_CLASS} font-mono sm:max-w-xs`}
                    value={item.key}
                    onChange={(e) => update(editing, { key: slugifyKey(e.target.value) })}
                    maxLength={40}
                  />
                </Field>
                {item.key ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-slate-500 dark:text-slate-400">Marcador no roteiro:</span>
                    <TokenChip token={token} tone="purple" draggable={false} onInsert={onInsertToken} />
                    {onInsertToken ? (
                      <button type="button" className={BTN_SMALL} onClick={() => onInsertToken(token)}>
                        <FileText size={13} aria-hidden="true" /> Inserir no roteiro
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </Disclosure>
          </>
        ) : null}
      </RuleEditorModal>
    </div>
  );
};

export default CustomActionsEditor;
