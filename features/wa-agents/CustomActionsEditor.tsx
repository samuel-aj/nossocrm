'use client';

/**
 * Editor das ações que o agente executa DURANTE a conversa (sem encerrar):
 * cada item tem nome, chave (gerada a partir do nome), "Quando acontecer"
 * (descrição em linguagem natural) e a lista de ações, no mesmo editor dos
 * resultados do encerramento.
 */
import React from 'react';
import { Plus, Trash2, ArrowUp, ArrowDown } from 'lucide-react';
import type { CustomAction } from '@/lib/wa-agents/types';
import type { WaAgentListItem, WaAgentOptions } from './useWaAgents';
import { ActionsEditor, slugifyKey, type ActionType } from './OutcomesEditor';
import { BTN_ICON, BTN_SMALL, Field, HELP_CLASS, INPUT_CLASS, SUBCARD_CLASS, TEXTAREA_CLASS } from './ui';

/**
 * Ações de encerramento não fazem sentido no meio da conversa: a ação
 * durante a conversa nunca encerra o atendimento (isso é papel dos resultados).
 */
const HIDDEN_ACTION_TYPES: ActionType[] = ['handoff', 'approval', 'stop'];

/**
 * Componente React `CustomActionsEditor`.
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export const CustomActionsEditor: React.FC<{
  value: CustomAction[];
  onChange: (value: CustomAction[]) => void;
  agents: WaAgentListItem[];
  options: WaAgentOptions | undefined;
  currentAgentId?: string | null;
}> = ({ value, onChange, agents, options, currentAgentId }) => {
  const update = (index: number, patch: Partial<CustomAction>) => {
    onChange(value.map((a, i) => (i === index ? { ...a, ...patch } : a)));
  };
  const remove = (index: number) => onChange(value.filter((_, i) => i !== index));
  const move = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= value.length) return;
    const next = [...value];
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    onChange(next);
  };
  const add = () => {
    let key = 'nova-acao';
    let n = 2;
    while (value.some((a) => a.key === key)) key = `nova-acao-${n++}`;
    onChange([...value, { key, label: 'Nova ação', description: '', actions: [] }]);
  };

  const setLabel = (index: number, label: string) => {
    const current = value[index];
    // Se a chave ainda segue o nome (ou está vazia), acompanha a mudança.
    const follows = !current.key || current.key === slugifyKey(current.label);
    update(index, { label, ...(follows ? { key: slugifyKey(label) } : {}) });
  };

  return (
    <div className="space-y-3">
      <p className={HELP_CLASS}>
        Situações que o agente reconhece no meio do atendimento, sem encerrar a conversa. Quando a situação descrita
        acontecer, o agente executa as ações uma vez e continua atendendo normalmente. Útil para registrar uma
        informação, mover a etapa, marcar um rótulo ou avisar outro sistema na hora.
      </p>

      {value.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Nenhuma ação durante a conversa. O agente só age no encerramento, pelos resultados.
        </p>
      ) : null}

      {value.map((item, index) => {
        const idPrefix = `custom-action-${index}`;
        return (
          <div key={idPrefix} className={SUBCARD_CLASS}>
            <div className="flex items-start gap-2">
              <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-3">
                <Field label="Nome" htmlFor={`${idPrefix}-label`}>
                  <input
                    id={`${idPrefix}-label`}
                    className={INPUT_CLASS}
                    value={item.label}
                    onChange={(e) => setLabel(index, e.target.value)}
                    maxLength={80}
                    placeholder="Ex.: Cliente já tem advogado"
                  />
                </Field>
                <Field label="Chave" htmlFor={`${idPrefix}-key`} help="Só letras minúsculas, números, hífen e sublinhado.">
                  <input
                    id={`${idPrefix}-key`}
                    className={`${INPUT_CLASS} font-mono`}
                    value={item.key}
                    onChange={(e) => update(index, { key: slugifyKey(e.target.value) })}
                    maxLength={40}
                  />
                </Field>
              </div>
              <div className="flex flex-col gap-1 shrink-0">
                <button
                  type="button"
                  className={BTN_ICON}
                  aria-label="Mover ação para cima"
                  title="Mover para cima"
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUp size={14} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className={BTN_ICON}
                  aria-label="Mover ação para baixo"
                  title="Mover para baixo"
                  disabled={index === value.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDown size={14} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className={`${BTN_ICON} hover:text-red-600 dark:hover:text-red-400`}
                  aria-label="Remover ação durante a conversa"
                  title="Remover"
                  onClick={() => remove(index)}
                >
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              </div>
            </div>

            <Field
              label="Quando acontecer"
              htmlFor={`${idPrefix}-description`}
              help='Descreva em linguagem natural quando o agente deve executar. Ex.: "o cliente informar que já tem advogado" ou "a pessoa pedir o endereço do escritório".'
            >
              <textarea
                id={`${idPrefix}-description`}
                className={TEXTAREA_CLASS}
                rows={2}
                value={item.description}
                onChange={(e) => update(index, { description: e.target.value })}
                maxLength={600}
                placeholder="Ex.: o cliente informar que já tem advogado"
              />
            </Field>

            <ActionsEditor
              value={item.actions}
              onChange={(actions) => update(index, { actions })}
              agents={agents}
              options={options}
              currentAgentId={currentAgentId}
              idPrefix={idPrefix}
              hiddenTypes={HIDDEN_ACTION_TYPES}
              emptyText='Sem ações no CRM: só o evento de webhook "Ação durante a conversa" é disparado.'
            />
          </div>
        );
      })}

      <button type="button" className={BTN_SMALL} onClick={add}>
        <Plus size={14} aria-hidden="true" />
        Adicionar ação durante a conversa
      </button>
    </div>
  );
};

export default CustomActionsEditor;
