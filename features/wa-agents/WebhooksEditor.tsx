'use client';

/**
 * Webhooks por evento do agente, um cartão por webhook: evento + URL + ativo
 * na primeira linha; corpo personalizado (JSON com {{variáveis}}, menu
 * "Inserir variável" agrupado, autocomplete no `{` e variáveis preenchidas
 * pela IA) e segredo ao expandir.
 */
import React from 'react';
import { Plus, Trash2, Webhook } from 'lucide-react';
import { WEBHOOK_VARIABLE_GROUPS, withCustomFieldVariables } from '@/lib/wa-agents/catalog';
import { AGENT_EVENTS, AGENT_EVENT_LABELS, type AgentAiVar, type AgentEvent, type AgentWebhook } from '@/lib/wa-agents/types';
import type { WaAgentOptions } from './useWaAgents';
import { VarField } from './VarField';
import { Disclosure, Field, INPUT_CLASS, InfoTip, KebabMenu, Toggle, BTN_SMALL, newId } from './ui';

const BODY_PLACEHOLDER = `{
  "evento": "{{event}}",
  "quando": "{{occurred_at}}",
  "agente": "{{agent.name}}",
  "telefone": "{{conversation.phone}}",
  "nome": "{{contact.name}}",
  "resultado": "{{resultado}}",
  "resumo": "{{ia:resumo_atendimento}}"
}`;

/**
 * Componente React `WebhooksEditor`.
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export const WebhooksEditor: React.FC<{
  value: AgentWebhook[];
  onChange: (value: AgentWebhook[]) => void;
  options?: WaAgentOptions | undefined;
  aiVars?: AgentAiVar[];
  onAiVarsChange?: (vars: AgentAiVar[]) => void;
}> = ({ value, onChange, options, aiVars = [], onAiVarsChange = () => {} }) => {
  const update = (index: number, patch: Partial<AgentWebhook>) =>
    onChange(value.map((w, i) => (i === index ? { ...w, ...patch } : w)));
  const remove = (index: number) => onChange(value.filter((_, i) => i !== index));
  const add = () =>
    onChange([
      ...value,
      { id: newId(), event: 'finished', url: '', secret: null, body_template: null, active: true },
    ]);
  const groups = withCustomFieldVariables(WEBHOOK_VARIABLE_GROUPS, options?.custom_fields, (key) => `{{deal.custom_fields.${key}}}`);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-slate-500 dark:text-slate-400 inline-flex items-center gap-1.5">
          {value.length === 0 ? 'Nenhum webhook.' : `${value.length} ${value.length === 1 ? 'webhook' : 'webhooks'}.`}
          <InfoTip
            label="Sobre os webhooks"
            text="Avise n8n, Make ou o seu backend quando algo acontecer no atendimento. Sem corpo personalizado, o envio traz o evento, o agente, a conversa, o contato e o negócio em JSON."
          />
        </p>
        <button type="button" className={BTN_SMALL} onClick={add}>
          <Plus size={14} aria-hidden="true" /> Novo webhook
        </button>
      </div>

      {value.length > 0 ? (
        <ul className="space-y-2" aria-label="Webhooks">
          {value.map((hook, index) => {
            const idPrefix = `webhook-${hook.id}`;
            return (
              <li
                key={hook.id}
                className={`rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 p-3 space-y-3 ${
                  hook.active ? '' : 'opacity-70'
                }`}
              >
                <div className="flex items-start gap-2">
                  <span className="mt-1.5 p-1.5 rounded-lg bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 shrink-0">
                    <Webhook size={14} aria-hidden="true" />
                  </span>
                  <div className="flex-1 min-w-0 grid grid-cols-1 md:grid-cols-[minmax(0,220px)_1fr] gap-2">
                    <select
                      id={`${idPrefix}-event`}
                      className={INPUT_CLASS}
                      value={hook.event}
                      onChange={(e) => update(index, { event: e.target.value as AgentEvent })}
                      aria-label="Evento"
                    >
                      {AGENT_EVENTS.map((ev) => (
                        <option key={ev} value={ev}>
                          {AGENT_EVENT_LABELS[ev]}
                        </option>
                      ))}
                    </select>
                    <input
                      id={`${idPrefix}-url`}
                      type="url"
                      className={INPUT_CLASS}
                      value={hook.url}
                      onChange={(e) => update(index, { url: e.target.value })}
                      placeholder="https://..."
                      aria-label="URL do webhook"
                    />
                  </div>
                  <div className="flex items-center gap-1 shrink-0 pt-1">
                    <Toggle checked={hook.active} onChange={(active) => update(index, { active })} label={`Webhook ${index + 1} ativo`} />
                    <KebabMenu
                      label={`Mais ações: webhook ${index + 1}`}
                      items={[
                        { label: 'Excluir', icon: <Trash2 size={14} aria-hidden="true" />, danger: true, onSelect: () => remove(index) },
                      ]}
                    />
                  </div>
                </div>

                <Disclosure label="Corpo personalizado e segredo" defaultOpen={!!hook.body_template || !!hook.secret}>
                  <div className="space-y-3">
                    <Field
                      label="Corpo (JSON)"
                      htmlFor={`${idPrefix}-body`}
                      tip="Vazio envia o JSON padrão do evento. Se o corpo for um JSON válido, vai como JSON; senão, como texto. Digite { para ver as variáveis; variáveis preenchidas pela IA ({{ia:nome}}) são geradas na hora do envio."
                    >
                      <VarField
                        id={`${idPrefix}-body`}
                        value={hook.body_template ?? ''}
                        onChange={(body) => update(index, { body_template: body || null })}
                        placeholder={BODY_PLACEHOLDER}
                        maxLength={20000}
                        rows={8}
                        ariaLabel="Corpo personalizado do webhook"
                        aiVars={aiVars}
                        onAiVarsChange={onAiVarsChange}
                        groups={groups}
                        insertLabel="Inserir variável"
                      />
                    </Field>
                    <Field
                      label="Segredo"
                      htmlFor={`${idPrefix}-secret`}
                      tip="Opcional. Enviado nos cabeçalhos X-Webhook-Secret e Authorization: Bearer."
                      className="sm:max-w-md"
                    >
                      <input
                        id={`${idPrefix}-secret`}
                        type="password"
                        autoComplete="off"
                        className={INPUT_CLASS}
                        value={hook.secret ?? ''}
                        onChange={(e) => update(index, { secret: e.target.value || null })}
                        maxLength={200}
                      />
                    </Field>
                  </div>
                </Disclosure>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
};

export default WebhooksEditor;
