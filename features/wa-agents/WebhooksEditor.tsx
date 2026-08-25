'use client';

/**
 * Editor de webhooks do agente: por evento, URL, segredo, ativo e corpo
 * personalizado (JSON com {{variáveis}}).
 */
import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { AGENT_EVENTS, AGENT_EVENT_LABELS, type AgentEvent, type AgentWebhook } from '@/lib/wa-agents/types';
import { BTN_ICON, BTN_SMALL, Field, HELP_CLASS, INPUT_CLASS, SUBCARD_CLASS, TEXTAREA_CLASS, Toggle, newId } from './ui';

const BODY_PLACEHOLDER = `{
  "evento": "{{event}}",
  "quando": "{{occurred_at}}",
  "agente": "{{agent.name}}",
  "telefone": "{{conversation.phone}}",
  "nome": "{{conversation.name}}",
  "resultado": "{{resultado}}",
  "resumo": "{{resumo}}"
}`;

const BODY_VARIABLES: Array<{ key: string; description: string }> = [
  { key: 'event', description: 'nome do evento' },
  { key: 'occurred_at', description: 'data e hora (ISO)' },
  { key: 'agent.name', description: 'nome do agente' },
  { key: 'conversation.phone', description: 'telefone da conversa' },
  { key: 'conversation.name', description: 'nome no WhatsApp' },
  { key: 'contact.name', description: 'nome do contato' },
  { key: 'deal.title', description: 'título do negócio' },
  { key: 'resultado', description: 'chave do resultado (no encerramento)' },
  { key: 'resumo', description: 'resumo do atendimento (no encerramento)' },
  { key: 'text', description: 'texto enviado (em resposta enviada)' },
];

/**
 * Componente React `WebhooksEditor`.
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export const WebhooksEditor: React.FC<{
  value: AgentWebhook[];
  onChange: (value: AgentWebhook[]) => void;
}> = ({ value, onChange }) => {
  const update = (index: number, patch: Partial<AgentWebhook>) =>
    onChange(value.map((w, i) => (i === index ? { ...w, ...patch } : w)));
  const remove = (index: number) => onChange(value.filter((_, i) => i !== index));
  const add = () =>
    onChange([
      ...value,
      { id: newId(), event: 'finished', url: '', secret: null, body_template: null, active: true },
    ]);

  return (
    <div className="space-y-3">
      <p className={HELP_CLASS}>
        Avise outro sistema (n8n, Make, seu backend) quando algo acontecer no atendimento. Sem corpo personalizado, o
        envio traz o evento, o agente, a conversa, o contato e o negócio em JSON.
      </p>

      {value.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">Nenhum webhook configurado.</p>
      ) : null}

      {value.map((hook, index) => {
        const idPrefix = `webhook-${hook.id}`;
        return (
          <div key={hook.id} className={SUBCARD_CLASS}>
            <div className="flex items-start gap-2">
              <div className="flex-1 grid grid-cols-1 md:grid-cols-[minmax(0,260px)_1fr] gap-3">
                <Field label="Evento" htmlFor={`${idPrefix}-event`}>
                  <select
                    id={`${idPrefix}-event`}
                    className={INPUT_CLASS}
                    value={hook.event}
                    onChange={(e) => update(index, { event: e.target.value as AgentEvent })}
                  >
                    {AGENT_EVENTS.map((ev) => (
                      <option key={ev} value={ev}>
                        {AGENT_EVENT_LABELS[ev]}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="URL" htmlFor={`${idPrefix}-url`}>
                  <input
                    id={`${idPrefix}-url`}
                    type="url"
                    className={INPUT_CLASS}
                    value={hook.url}
                    onChange={(e) => update(index, { url: e.target.value })}
                    placeholder="https://..."
                  />
                </Field>
              </div>
              <div className="flex flex-col items-center gap-2 shrink-0 pt-6">
                <Toggle
                  checked={hook.active}
                  onChange={(active) => update(index, { active })}
                  label={`Webhook ${index + 1} ativo`}
                />
                <button
                  type="button"
                  className={`${BTN_ICON} hover:text-red-600 dark:hover:text-red-400`}
                  aria-label={`Remover webhook ${index + 1}`}
                  title="Remover"
                  onClick={() => remove(index)}
                >
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              </div>
            </div>

            <Field
              label="Segredo (opcional)"
              htmlFor={`${idPrefix}-secret`}
              help="Enviado nos cabeçalhos X-Webhook-Secret e Authorization: Bearer."
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

            <details open={!!hook.body_template} className="group">
              <summary className="cursor-pointer text-sm font-medium text-slate-700 dark:text-slate-300 select-none">
                Corpo personalizado (opcional)
              </summary>
              <div className="mt-2 space-y-2">
                <textarea
                  id={`${idPrefix}-body`}
                  className={`${TEXTAREA_CLASS} font-mono text-xs`}
                  rows={8}
                  value={hook.body_template ?? ''}
                  onChange={(e) => update(index, { body_template: e.target.value || null })}
                  placeholder={BODY_PLACEHOLDER}
                  aria-label="Corpo personalizado do webhook"
                  maxLength={20000}
                />
                <div className={HELP_CLASS}>
                  <span className="font-medium">Variáveis disponíveis:</span>{' '}
                  {BODY_VARIABLES.map((v, i) => (
                    <span key={v.key}>
                      <code className="font-mono">{`{{${v.key}}}`}</code> ({v.description}){i < BODY_VARIABLES.length - 1 ? ', ' : '.'}
                    </span>
                  ))}{' '}
                  Se o resultado for um JSON válido, ele é enviado como JSON; senão vai como texto.
                </div>
              </div>
            </details>
          </div>
        );
      })}

      <button type="button" className={BTN_SMALL} onClick={add}>
        <Plus size={14} aria-hidden="true" />
        Adicionar webhook
      </button>
    </div>
  );
};

export default WebhooksEditor;
