'use client';

/**
 * Resultados do atendimento (outcomes) como cartões "Resultado X -> ações",
 * com resumo legível das ações e edição expandida (um cartão por vez).
 *
 * Exporta também o editor de ações (`ActionsEditor`), reutilizado pelas
 * ações durante a conversa (CustomActionsEditor), os ícones e rótulos por
 * tipo de ação e `describeActions` (resumo em texto de uma lista de ações).
 */
import React, { useState } from 'react';
import {
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  Pencil,
  ChevronUp,
  Flag,
  ArrowRightLeft,
  ShieldCheck,
  Hand,
  StickyNote,
  ArrowRight,
  Tag,
  CircleX,
  UserCheck,
  Package,
  CalendarPlus,
  Webhook,
  type LucideIcon,
} from 'lucide-react';
import type { EndAction, Outcome } from '@/lib/wa-agents/types';
import type { WaAgentListItem, WaAgentOptions } from './useWaAgents';
import { BTN_ICON, BTN_SMALL, Badge, Field, HELP_CLASS, INPUT_CLASS, SUBCARD_CLASS, TEXTAREA_CLASS } from './ui';

export type ActionType = EndAction['type'];

export const ACTION_LABELS: Record<ActionType, string> = {
  handoff: 'Passar para outro agente',
  approval: 'Pedir aprovação humana para passar a outro agente',
  stop: 'Encerrar e entregar ao atendente',
  note: 'Registrar nota no negócio',
  move_stage: 'Mover para etapa',
  add_tag: 'Adicionar rótulo',
  mark_lost: 'Marcar como perdido',
  assign_owner: 'Atribuir responsável',
  set_product: 'Cadastrar produto no negócio',
  create_task: 'Criar tarefa',
  webhook: 'Chamar webhook',
};

export const ACTION_ICONS: Record<ActionType, LucideIcon> = {
  handoff: ArrowRightLeft,
  approval: ShieldCheck,
  stop: Hand,
  note: StickyNote,
  move_stage: ArrowRight,
  add_tag: Tag,
  mark_lost: CircleX,
  assign_owner: UserCheck,
  set_product: Package,
  create_task: CalendarPlus,
  webhook: Webhook,
};

const ACTION_TYPES = Object.keys(ACTION_LABELS) as ActionType[];

/** Variáveis aceitas no corpo personalizado da ação "Chamar webhook". */
export const ACTION_WEBHOOK_VARIABLES: Array<{ key: string; description: string }> = [
  { key: 'event', description: 'nome do evento' },
  { key: 'agent.name', description: 'nome do agente' },
  { key: 'conversation.phone', description: 'telefone da conversa' },
  { key: 'contact.name', description: 'nome do contato' },
  { key: 'deal.title', description: 'título do negócio' },
  { key: 'resultado', description: 'chave do resultado (no encerramento)' },
  { key: 'resumo', description: 'resumo do atendimento (no encerramento)' },
  { key: 'acao', description: 'chave da ação (durante a conversa)' },
  { key: 'detalhes', description: 'detalhes informados pelo agente (durante a conversa)' },
];

const ACTION_WEBHOOK_PLACEHOLDER = `{
  "evento": "{{event}}",
  "agente": "{{agent.name}}",
  "telefone": "{{conversation.phone}}",
  "nome": "{{contact.name}}",
  "negocio": "{{deal.title}}",
  "resultado": "{{resultado}}",
  "resumo": "{{resumo}}",
  "acao": "{{acao}}",
  "detalhes": "{{detalhes}}"
}`;

/** Chave a partir do rótulo: minúsculas, sem acento, hífens. */
export function slugifyKey(label: string): string {
  return label
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

/** Ação nova de um tipo, com valores iniciais razoáveis. */
export function defaultAction(
  type: ActionType,
  agents: WaAgentListItem[],
  options: WaAgentOptions | undefined,
  currentAgentId: string | null | undefined
): EndAction {
  const otherAgent = agents.find((a) => a.id !== currentAgentId)?.id ?? '';
  const firstStage = options?.boards.find((b) => b.stages.length > 0)?.stages[0]?.id ?? '';
  switch (type) {
    case 'handoff':
      return { type, agent_id: otherAgent };
    case 'approval':
      return { type, agent_id: otherAgent };
    case 'stop':
      return { type };
    case 'note':
      return { type };
    case 'move_stage':
      return { type, stage_id: firstStage };
    case 'add_tag':
      return { type, tag: '' };
    case 'mark_lost':
      return { type };
    case 'assign_owner':
      return { type, owner_id: options?.owners[0]?.id ?? '' };
    case 'set_product':
      return { type, product_id: options?.products[0]?.id ?? '' };
    case 'create_task':
      return { type, title: '', days: 1 };
    case 'webhook':
      return { type, url: '', secret: null, body_template: null };
  }
}

function findStage(options: WaAgentOptions | undefined, stageId: string) {
  for (const b of options?.boards ?? []) {
    const s = b.stages.find((x) => x.id === stageId);
    if (s) return { board: b.name, label: s.label };
  }
  return null;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url.trim() ? url.trim() : 'sem URL';
  }
}

/** Uma ação em texto legível, em minúsculas (para compor frases). */
export function describeAction(action: EndAction, agents: WaAgentListItem[], options: WaAgentOptions | undefined): string {
  const agentName = (id: string) =>
    id ? (agents.find((a) => a.id === id)?.name ?? 'agente não encontrado') : 'agente não escolhido';
  switch (action.type) {
    case 'handoff':
      return `passar para o agente ${agentName(action.agent_id)}`;
    case 'approval':
      return `pedir aprovação para passar a ${agentName(action.agent_id)}`;
    case 'stop':
      return 'encerrar e entregar ao atendente';
    case 'note':
      return action.title ? `registrar nota "${action.title}"` : 'registrar nota no negócio';
    case 'move_stage': {
      const stage = findStage(options, action.stage_id);
      return `mover para a etapa ${stage ? stage.label : 'não escolhida'}`;
    }
    case 'add_tag':
      return `adicionar rótulo ${action.tag.trim() ? `"${action.tag.trim()}"` : 'sem nome'}`;
    case 'mark_lost':
      return action.loss_reason ? `marcar como perdido (${action.loss_reason})` : 'marcar como perdido';
    case 'assign_owner': {
      const owner = options?.owners.find((o) => o.id === action.owner_id);
      return `atribuir a ${owner?.name ?? 'responsável não escolhido'}`;
    }
    case 'set_product': {
      const product = options?.products.find((p) => p.id === action.product_id);
      return `cadastrar o produto ${product?.name ?? 'não escolhido'}`;
    }
    case 'create_task': {
      const days = action.days ?? 0;
      return `criar tarefa ${action.title.trim() ? `"${action.title.trim()}"` : 'sem título'}${
        days > 0 ? ` em ${days} ${days === 1 ? 'dia' : 'dias'}` : ''
      }`;
    }
    case 'webhook':
      return `chamar webhook ${hostOf(action.url)}`;
  }
}

/** Lista de ações em uma frase: "Mover para a etapa Qualificado, adicionar rótulo Quente, passar para o agente Fechamento". */
export function describeActions(actions: EndAction[], agents: WaAgentListItem[], options: WaAgentOptions | undefined): string {
  if (actions.length === 0) return '';
  const text = actions.map((a) => describeAction(a, agents, options)).join(', ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Resumo visual das ações: um chip com ícone por ação. */
export function ActionSummary({
  actions,
  agents,
  options,
  emptyText,
}: {
  actions: EndAction[];
  agents: WaAgentListItem[];
  options: WaAgentOptions | undefined;
  emptyText: string;
}) {
  if (actions.length === 0) return <p className="text-xs text-slate-500 dark:text-slate-400">{emptyText}</p>;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Ações">
      {actions.map((a, i) => {
        const Icon = ACTION_ICONS[a.type];
        const text = describeAction(a, agents, options);
        return (
          <li
            key={`${a.type}-${i}`}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-200"
            title={ACTION_LABELS[a.type]}
          >
            <Icon size={12} className="text-purple-600 dark:text-purple-400 shrink-0" aria-hidden="true" />
            <span>{text.charAt(0).toUpperCase() + text.slice(1)}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** Select de etapa agrupado por board. */
export function StageSelect({
  id,
  value,
  onChange,
  options,
  ariaLabel,
}: {
  id?: string;
  value: string;
  onChange: (stageId: string) => void;
  options: WaAgentOptions | undefined;
  ariaLabel?: string;
}) {
  const boards = options?.boards ?? [];
  return (
    <select id={id} className={INPUT_CLASS} value={value} onChange={(e) => onChange(e.target.value)} aria-label={ariaLabel}>
      <option value="">Selecione a etapa</option>
      {boards.map((b) => (
        <optgroup key={b.id} label={b.name}>
          {b.stages.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

/** Select de agente (exclui o agente sendo editado). */
export function AgentSelect({
  id,
  value,
  onChange,
  agents,
  excludeId,
  ariaLabel,
}: {
  id?: string;
  value: string;
  onChange: (agentId: string) => void;
  agents: WaAgentListItem[];
  excludeId?: string | null;
  ariaLabel?: string;
}) {
  const list = agents.filter((a) => a.id !== excludeId);
  return (
    <select id={id} className={INPUT_CLASS} value={value} onChange={(e) => onChange(e.target.value)} aria-label={ariaLabel}>
      <option value="">Selecione o agente</option>
      {list.map((a) => (
        <option key={a.id} value={a.id}>
          {a.name}
          {a.enabled ? '' : ' (desligado)'}
        </option>
      ))}
    </select>
  );
}

/** Campo de rótulo com sugestões dos rótulos da organização. */
export function TagInput({
  id,
  value,
  onChange,
  options,
  ariaLabel,
}: {
  id?: string;
  value: string;
  onChange: (tag: string) => void;
  options: WaAgentOptions | undefined;
  ariaLabel?: string;
}) {
  const listId = `${id ?? 'tag'}-list`;
  return (
    <>
      <input
        id={id}
        list={listId}
        className={INPUT_CLASS}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Nome do rótulo"
        maxLength={60}
        aria-label={ariaLabel}
      />
      <datalist id={listId}>
        {(options?.tags ?? []).map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
    </>
  );
}

/** Ajuda com as variáveis do corpo personalizado da ação webhook. */
function WebhookVariablesHelp() {
  return (
    <div className={HELP_CLASS}>
      <span className="font-medium">Variáveis disponíveis:</span>{' '}
      {ACTION_WEBHOOK_VARIABLES.map((v, i) => (
        <span key={v.key}>
          <code className="font-mono">{`{{${v.key}}}`}</code> ({v.description})
          {i < ACTION_WEBHOOK_VARIABLES.length - 1 ? ', ' : '.'}
        </span>
      ))}{' '}
      Sem corpo personalizado, o envio traz o evento, o agente, a conversa, o contato, o negócio e o resultado (ou a
      ação) em JSON. Se o corpo for um JSON válido, ele é enviado como JSON; senão vai como texto.
    </div>
  );
}

function ActionFields({
  action,
  onChange,
  agents,
  options,
  currentAgentId,
  idPrefix,
}: {
  action: EndAction;
  onChange: (a: EndAction) => void;
  agents: WaAgentListItem[];
  options: WaAgentOptions | undefined;
  currentAgentId: string | null | undefined;
  idPrefix: string;
}) {
  switch (action.type) {
    case 'handoff':
    case 'approval':
      return (
        <AgentSelect
          id={`${idPrefix}-agent`}
          value={action.agent_id}
          onChange={(agent_id) => onChange({ ...action, agent_id })}
          agents={agents}
          excludeId={currentAgentId}
          ariaLabel="Agente de destino"
        />
      );
    case 'stop':
      return <p className={HELP_CLASS}>O agente para de responder e a conversa fica com a equipe.</p>;
    case 'note':
      return (
        <input
          id={`${idPrefix}-title`}
          className={INPUT_CLASS}
          value={action.title ?? ''}
          onChange={(e) => onChange({ ...action, title: e.target.value || undefined })}
          placeholder="Título da nota (opcional; padrão: Pré-atendimento IA: resultado)"
          maxLength={120}
          aria-label="Título da nota"
        />
      );
    case 'move_stage':
      return (
        <StageSelect
          id={`${idPrefix}-stage`}
          value={action.stage_id}
          onChange={(stage_id) => onChange({ ...action, stage_id })}
          options={options}
          ariaLabel="Etapa de destino"
        />
      );
    case 'add_tag':
      return (
        <TagInput
          id={`${idPrefix}-tag`}
          value={action.tag}
          onChange={(tag) => onChange({ ...action, tag })}
          options={options}
          ariaLabel="Rótulo a adicionar"
        />
      );
    case 'mark_lost':
      return (
        <input
          id={`${idPrefix}-loss`}
          className={INPUT_CLASS}
          value={action.loss_reason ?? ''}
          onChange={(e) => onChange({ ...action, loss_reason: e.target.value || undefined })}
          placeholder="Motivo da perda (opcional)"
          maxLength={200}
          aria-label="Motivo da perda"
        />
      );
    case 'assign_owner':
      return (
        <select
          id={`${idPrefix}-owner`}
          className={INPUT_CLASS}
          value={action.owner_id}
          onChange={(e) => onChange({ ...action, owner_id: e.target.value })}
          aria-label="Responsável"
        >
          <option value="">Selecione o responsável</option>
          {(options?.owners ?? []).map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      );
    case 'set_product':
      return (
        <select
          id={`${idPrefix}-product`}
          className={INPUT_CLASS}
          value={action.product_id}
          onChange={(e) => onChange({ ...action, product_id: e.target.value })}
          aria-label="Produto"
        >
          <option value="">Selecione o produto</option>
          {(options?.products ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      );
    case 'create_task':
      return (
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2">
          <input
            id={`${idPrefix}-task-title`}
            className={INPUT_CLASS}
            value={action.title}
            onChange={(e) => onChange({ ...action, title: e.target.value })}
            placeholder="Título da tarefa"
            maxLength={200}
            aria-label="Título da tarefa"
          />
          <div className="flex items-center gap-2">
            <label htmlFor={`${idPrefix}-task-days`} className="text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
              em (dias)
            </label>
            <input
              id={`${idPrefix}-task-days`}
              type="number"
              min={0}
              max={365}
              className={`${INPUT_CLASS} w-24`}
              value={action.days ?? 0}
              onChange={(e) => onChange({ ...action, days: Math.max(0, Math.min(365, Number(e.target.value) || 0)) })}
            />
          </div>
        </div>
      );
    case 'webhook':
      return (
        <div className="space-y-2">
          <input
            id={`${idPrefix}-url`}
            type="url"
            className={INPUT_CLASS}
            value={action.url}
            onChange={(e) => onChange({ ...action, url: e.target.value })}
            placeholder="https://..."
            aria-label="URL do webhook"
          />
          <input
            id={`${idPrefix}-secret`}
            type="password"
            autoComplete="off"
            className={INPUT_CLASS}
            value={action.secret ?? ''}
            onChange={(e) => onChange({ ...action, secret: e.target.value || null })}
            placeholder="Segredo (opcional): vai em X-Webhook-Secret e Authorization: Bearer"
            maxLength={200}
            aria-label="Segredo do webhook"
          />
          <details open={!!action.body_template}>
            <summary className="cursor-pointer text-xs font-medium text-slate-700 dark:text-slate-300 select-none">
              Corpo personalizado (opcional)
            </summary>
            <div className="mt-2 space-y-2">
              <textarea
                id={`${idPrefix}-body`}
                className={`${TEXTAREA_CLASS} font-mono text-xs`}
                rows={7}
                value={action.body_template ?? ''}
                onChange={(e) => onChange({ ...action, body_template: e.target.value || null })}
                placeholder={ACTION_WEBHOOK_PLACEHOLDER}
                aria-label="Corpo personalizado do webhook"
                maxLength={20000}
              />
              <WebhookVariablesHelp />
            </div>
          </details>
        </div>
      );
  }
}

/**
 * Editor de uma lista de ações (select de tipo com ícone + campos por tipo).
 * Usado pelos resultados do encerramento e pelas ações durante a conversa.
 */
export const ActionsEditor: React.FC<{
  value: EndAction[];
  onChange: (actions: EndAction[]) => void;
  agents: WaAgentListItem[];
  options: WaAgentOptions | undefined;
  currentAgentId?: string | null;
  /** Prefixo dos ids dos campos (acessibilidade e chaves do React) */
  idPrefix: string;
  /** Texto exibido quando a lista está vazia */
  emptyText?: string;
  /** Tipos que não aparecem no seletor (uma ação já salva com esse tipo continua editável) */
  hiddenTypes?: ActionType[];
  /** Tipo da ação criada pelo botão "Adicionar ação" */
  defaultType?: ActionType;
}> = ({
  value,
  onChange,
  agents,
  options,
  currentAgentId,
  idPrefix,
  emptyText = 'Sem ações.',
  hiddenTypes = [],
  defaultType = 'note',
}) => {
  const visibleTypes = ACTION_TYPES.filter((t) => !hiddenTypes.includes(t));
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Ações</span>
        <button
          type="button"
          className={BTN_SMALL}
          onClick={() => onChange([...value, defaultAction(defaultType, agents, options, currentAgentId)])}
        >
          <Plus size={14} aria-hidden="true" />
          Adicionar ação
        </button>
      </div>
      {value.length === 0 ? <p className={HELP_CLASS}>{emptyText}</p> : null}
      {value.map((action, aIndex) => {
        const aPrefix = `${idPrefix}-action-${aIndex}`;
        const setAction = (a: EndAction) => onChange(value.map((x, i) => (i === aIndex ? a : x)));
        const types = visibleTypes.includes(action.type) ? visibleTypes : [action.type, ...visibleTypes];
        const Icon = ACTION_ICONS[action.type];
        return (
          <div
            key={aPrefix}
            className="grid grid-cols-[auto_minmax(0,1fr)] md:grid-cols-[auto_minmax(0,240px)_1fr_auto] gap-2 items-start bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-lg p-2"
          >
            <span
              className="mt-2 p-1.5 rounded-md bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400"
              title={ACTION_LABELS[action.type]}
            >
              <Icon size={14} aria-hidden="true" />
            </span>
            <select
              className={INPUT_CLASS}
              value={action.type}
              aria-label={`Tipo da ação ${aIndex + 1}`}
              onChange={(e) => setAction(defaultAction(e.target.value as ActionType, agents, options, currentAgentId))}
            >
              {types.map((t) => (
                <option key={t} value={t}>
                  {ACTION_LABELS[t]}
                </option>
              ))}
            </select>
            <div className="min-w-0 col-span-2 md:col-span-1">
              <ActionFields
                action={action}
                onChange={setAction}
                agents={agents}
                options={options}
                currentAgentId={currentAgentId}
                idPrefix={aPrefix}
              />
            </div>
            <button
              type="button"
              className={`${BTN_ICON} hover:text-red-600 dark:hover:text-red-400 col-start-2 md:col-start-auto justify-self-end`}
              aria-label={`Remover ação ${aIndex + 1}`}
              title="Remover ação"
              onClick={() => onChange(value.filter((_, i) => i !== aIndex))}
            >
              <Trash2 size={14} aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
};

/** Botões de ordenar e remover de um cartão. */
export function CardControls({
  index,
  total,
  onMove,
  onRemove,
  itemLabel,
}: {
  index: number;
  total: number;
  onMove: (index: number, dir: -1 | 1) => void;
  onRemove: (index: number) => void;
  itemLabel: string;
}) {
  return (
    <>
      <button
        type="button"
        className={BTN_ICON}
        aria-label={`Mover ${itemLabel} para cima`}
        title="Mover para cima"
        disabled={index === 0}
        onClick={() => onMove(index, -1)}
      >
        <ArrowUp size={14} aria-hidden="true" />
      </button>
      <button
        type="button"
        className={BTN_ICON}
        aria-label={`Mover ${itemLabel} para baixo`}
        title="Mover para baixo"
        disabled={index === total - 1}
        onClick={() => onMove(index, 1)}
      >
        <ArrowDown size={14} aria-hidden="true" />
      </button>
      <button
        type="button"
        className={`${BTN_ICON} hover:text-red-600 dark:hover:text-red-400`}
        aria-label={`Remover ${itemLabel}`}
        title="Remover"
        onClick={() => onRemove(index)}
      >
        <Trash2 size={14} aria-hidden="true" />
      </button>
    </>
  );
}

/** Índice expandido após mover/remover um item (um cartão aberto por vez). */
export function nextExpanded(expanded: number | null, change: { moved?: [from: number, to: number]; removed?: number }): number | null {
  if (expanded === null) return null;
  if (change.moved) {
    const [from, to] = change.moved;
    if (expanded === from) return to;
    if (expanded === to) return from;
    return expanded;
  }
  if (change.removed !== undefined) {
    if (expanded === change.removed) return null;
    return expanded > change.removed ? expanded - 1 : expanded;
  }
  return expanded;
}

/**
 * Componente React `OutcomesEditor`.
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export const OutcomesEditor: React.FC<{
  value: Outcome[];
  onChange: (value: Outcome[]) => void;
  agents: WaAgentListItem[];
  options: WaAgentOptions | undefined;
  currentAgentId?: string | null;
}> = ({ value, onChange, agents, options, currentAgentId }) => {
  const [expanded, setExpanded] = useState<number | null>(null);

  const update = (index: number, patch: Partial<Outcome>) => {
    onChange(value.map((o, i) => (i === index ? { ...o, ...patch } : o)));
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
    let key = 'novo-resultado';
    let n = 2;
    while (value.some((o) => o.key === key)) key = `novo-resultado-${n++}`;
    onChange([...value, { key, label: 'Novo resultado', description: '', actions: [] }]);
    setExpanded(value.length);
  };

  const setLabel = (index: number, label: string) => {
    const current = value[index];
    // Se a chave ainda segue o rótulo (ou está vazia), acompanha a mudança.
    const follows = !current.key || current.key === slugifyKey(current.label);
    update(index, { label, ...(follows ? { key: slugifyKey(label) } : {}) });
  };

  return (
    <div className="space-y-3">
      <p className={HELP_CLASS}>
        Ao encerrar, o agente escolhe um destes resultados e as ações do cartão são executadas em ordem. A chave é o
        nome que o modelo usa internamente.
      </p>

      {value.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">Nenhum resultado. O agente só encerra a conversa.</p>
      ) : null}

      {value.map((outcome, index) => {
        const idPrefix = `outcome-${index}`;
        const open = expanded === index;
        const bodyId = `${idPrefix}-body`;
        return (
          <div key={idPrefix} className={SUBCARD_CLASS}>
            <div className="flex items-start gap-2">
              <span className="mt-0.5 p-1.5 rounded-lg bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 shrink-0">
                <Flag size={14} aria-hidden="true" />
              </span>
              <div className="flex-1 min-w-0 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-slate-900 dark:text-white">
                    {outcome.label.trim() || 'Sem rótulo'}
                  </span>
                  {outcome.key ? (
                    <Badge tone="slate">
                      <span className="font-mono font-normal">{outcome.key}</span>
                    </Badge>
                  ) : (
                    <Badge tone="amber">sem chave</Badge>
                  )}
                </div>
                {!open ? (
                  <>
                    {outcome.description.trim() ? (
                      <p className="text-xs text-slate-600 dark:text-slate-300 line-clamp-2">
                        <span className="font-medium">Quando usar:</span> {outcome.description}
                      </p>
                    ) : (
                      <p className="text-xs text-amber-700 dark:text-amber-300">Sem descrição de quando usar.</p>
                    )}
                    <div className="flex items-start gap-1.5">
                      <ArrowRight size={14} className="mt-0.5 text-slate-400 shrink-0" aria-hidden="true" />
                      <ActionSummary
                        actions={outcome.actions}
                        agents={agents}
                        options={options}
                        emptyText="Sem ações: o agente só encerra e a conversa fica com a equipe."
                      />
                    </div>
                  </>
                ) : null}
              </div>
              <div className="flex items-center gap-0.5 shrink-0">
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
                <CardControls index={index} total={value.length} onMove={move} onRemove={remove} itemLabel="resultado" />
              </div>
            </div>

            {open ? (
              <div id={bodyId} className="space-y-3 border-t border-slate-200 dark:border-white/10 pt-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <Field label="Rótulo" htmlFor={`${idPrefix}-label`}>
                    <input
                      id={`${idPrefix}-label`}
                      className={INPUT_CLASS}
                      value={outcome.label}
                      onChange={(e) => setLabel(index, e.target.value)}
                      maxLength={80}
                    />
                  </Field>
                  <Field label="Chave" htmlFor={`${idPrefix}-key`} help="Só letras minúsculas, números, hífen e sublinhado.">
                    <input
                      id={`${idPrefix}-key`}
                      className={`${INPUT_CLASS} font-mono`}
                      value={outcome.key}
                      onChange={(e) => update(index, { key: slugifyKey(e.target.value) })}
                      maxLength={40}
                    />
                  </Field>
                </div>

                <Field
                  label="Quando usar"
                  htmlFor={`${idPrefix}-description`}
                  help="Explique ao modelo em que situação este resultado se aplica."
                >
                  <textarea
                    id={`${idPrefix}-description`}
                    className={TEXTAREA_CLASS}
                    rows={2}
                    value={outcome.description}
                    onChange={(e) => update(index, { description: e.target.value })}
                    maxLength={500}
                  />
                </Field>

                <ActionsEditor
                  value={outcome.actions}
                  onChange={(actions) => update(index, { actions })}
                  agents={agents}
                  options={options}
                  currentAgentId={currentAgentId}
                  idPrefix={idPrefix}
                  emptyText="Sem ações: o agente só encerra e a conversa fica com a equipe."
                />
              </div>
            ) : null}
          </div>
        );
      })}

      <button type="button" className={BTN_SMALL} onClick={add}>
        <Plus size={14} aria-hidden="true" />
        Adicionar resultado
      </button>
    </div>
  );
};

export default OutcomesEditor;
