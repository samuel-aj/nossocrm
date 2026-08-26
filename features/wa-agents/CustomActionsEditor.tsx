'use client';

/**
 * Ações que o agente executa DURANTE a conversa (sem encerrar), como cartões:
 * nome, "quando ativar" e resumo das ações; edição expandida (um por vez).
 * Cada cartão tem "Inserir no roteiro" (marca `[[acao:chave]]` no cursor da
 * aba Roteiro) e um chip com o mesmo marcador. O chip aqui não é arrastável:
 * a textarea do roteiro está escondida nesta aba (arrastar só na paleta da
 * aba Roteiro).
 */
import React, { useState } from 'react';
import { Plus, Pencil, ChevronUp, Zap, ArrowRight, FileText } from 'lucide-react';
import type { CustomAction } from '@/lib/wa-agents/types';
import type { WaAgentListItem, WaAgentOptions } from './useWaAgents';
import { ActionSummary, ActionsEditor, CardControls, nextExpanded, slugifyKey, type ActionType } from './OutcomesEditor';
import { actionToken } from './PromptEditor';
import { BTN_SMALL, Badge, Field, HELP_CLASS, INPUT_CLASS, SUBCARD_CLASS, TEXTAREA_CLASS, TokenChip } from './ui';

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
  /** Insere o marcador `[[acao:chave]]` no cursor do roteiro (o editor pai troca de aba) */
  onInsertToken?: (token: string) => void;
}> = ({ value, onChange, agents, options, currentAgentId, onInsertToken }) => {
  const [expanded, setExpanded] = useState<number | null>(null);

  const update = (index: number, patch: Partial<CustomAction>) => {
    onChange(value.map((a, i) => (i === index ? { ...a, ...patch } : a)));
  };
  const remove = (index: number) => {
    onChange(value.filter((_, i) => i !== index));
    setExpanded((e) => nextExpanded(e, { removed: index }));
  };
  const move = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= value.length) return;
    const next = [...value];
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    onChange(next);
    setExpanded((e) => nextExpanded(e, { moved: [index, target] }));
  };
  const add = () => {
    let key = 'nova-acao';
    let n = 2;
    while (value.some((a) => a.key === key)) key = `nova-acao-${n++}`;
    onChange([...value, { key, label: 'Nova ação', description: '', actions: [] }]);
    setExpanded(value.length);
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
        acontecer, o agente executa as ações uma vez e continua atendendo. Para marcar o momento exato no texto, use
        "Inserir no roteiro" (ou, na aba Roteiro, arraste o chip da paleta até o ponto certo).
      </p>

      {value.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Nenhuma ação durante a conversa. O agente só age no encerramento, pelos resultados.
        </p>
      ) : null}

      {value.map((item, index) => {
        const idPrefix = `custom-action-${index}`;
        const open = expanded === index;
        const bodyId = `${idPrefix}-body`;
        const token = actionToken(item.key || slugifyKey(item.label) || 'chave');
        return (
          <div key={idPrefix} className={SUBCARD_CLASS}>
            <div className="flex items-start gap-2">
              <span className="mt-0.5 p-1.5 rounded-lg bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 shrink-0">
                <Zap size={14} aria-hidden="true" />
              </span>
              <div className="flex-1 min-w-0 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-slate-900 dark:text-white">{item.label.trim() || 'Sem nome'}</span>
                  {item.key ? (
                    <TokenChip
                      token={token}
                      tone="purple"
                      draggable={false}
                      title={`Marcador desta ação no roteiro: ${token}. Clique para inserir no cursor; para arrastar, use a paleta da aba Roteiro.`}
                      onInsert={onInsertToken}
                    />
                  ) : (
                    <Badge tone="amber">sem chave</Badge>
                  )}
                </div>
                {!open ? (
                  <>
                    {item.description.trim() ? (
                      <p className="text-xs text-slate-600 dark:text-slate-300 line-clamp-2">
                        <span className="font-medium">Quando ativar:</span> {item.description}
                      </p>
                    ) : (
                      <p className="text-xs text-amber-700 dark:text-amber-300">Descreva quando esta ação acontece.</p>
                    )}
                    <div className="flex items-start gap-1.5">
                      <ArrowRight size={14} className="mt-0.5 text-slate-400 shrink-0" aria-hidden="true" />
                      <ActionSummary
                        actions={item.actions}
                        agents={agents}
                        options={options}
                        emptyText='Sem ações no CRM: só o evento de webhook "Ação durante a conversa" é disparado.'
                      />
                    </div>
                  </>
                ) : null}
              </div>
              <div className="flex items-center gap-0.5 shrink-0 flex-wrap justify-end">
                {onInsertToken && item.key ? (
                  <button
                    type="button"
                    className={BTN_SMALL}
                    onClick={() => onInsertToken(token)}
                    title="Coloca o marcador desta ação no cursor da aba Roteiro"
                  >
                    <FileText size={14} aria-hidden="true" />
                    Inserir no roteiro
                  </button>
                ) : null}
                <button
                  type="button"
                  className={BTN_SMALL}
                  aria-expanded={open}
                  aria-controls={bodyId}
                  onClick={() => setExpanded(open ? null : index)}
                >
                  {open ? <ChevronUp size={14} aria-hidden="true" /> : <Pencil size={14} aria-hidden="true" />}
                  {open ? 'Fechar' : 'Editar'}
                </button>
                <CardControls
                  index={index}
                  total={value.length}
                  onMove={move}
                  onRemove={remove}
                  itemLabel="ação durante a conversa"
                />
              </div>
            </div>

            {open ? (
              <div id={bodyId} className="space-y-3 border-t border-slate-200 dark:border-white/10 pt-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
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

                <Field
                  label="Quando ativar"
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
            ) : null}
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
