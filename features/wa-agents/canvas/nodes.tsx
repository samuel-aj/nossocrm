'use client';

/**
 * Nós do quadro do robô: Gatilho, Mensagem, Esperar, Esperar resposta, Condição,
 * Mover etapa, Rótulo, Webhook, Entregar a agente e Encerrar.
 *
 * Cada nó edita seus dados inline (updateNodeData) e expõe handles de saída com
 * nome fixo; a serialização usa esses nomes para montar next/goto/else/timeout.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  Handle,
  Position,
  useReactFlow,
  useUpdateNodeInternals,
  type NodeProps,
  type NodeTypes,
} from '@xyflow/react';
import {
  Bot,
  Clock,
  Flag,
  GitBranch,
  MessageCircle,
  MessageSquareReply,
  MoveRight,
  Plus,
  Tag,
  Trash2,
  Webhook,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { AgentSelect, StageSelect, TagInput } from '../OutcomesEditor';
import { HELP_CLASS, INPUT_CLASS, newId } from '../ui';
import { useCanvasContext } from './context';
import {
  BOT_VARIABLES,
  HANDLE_ELSE,
  HANDLE_IN,
  HANDLE_NEXT,
  HANDLE_TIMEOUT,
  MAX_REPLY_MINUTES,
  MAX_WAIT_SECONDS,
  STEP_LABELS,
  TRIGGER_LABELS,
  WAIT_UNIT_LABELS,
  WAIT_UNIT_SECONDS,
  ruleHandleId,
  type BotTriggerType,
  type ConditionNode,
  type ConditionRuleDraft,
  type EndNode,
  type FlowEdge,
  type FlowNode,
  type HandoffNode,
  type MessageNode,
  type MoveStageNode,
  type StepType,
  type TagNode,
  type TriggerData,
  type TriggerNode,
  type WaitNode,
  type WaitReplyNode,
  type WaitUnit,
  type WebhookNode,
} from './types';

// ---------------------------------------------------------------- Aparência

export type NodeTone = 'amber' | 'green' | 'sky' | 'blue' | 'purple' | 'pink' | 'orange' | 'slate' | 'red';

const TONE_CLASS: Record<NodeTone, string> = {
  amber: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  green: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  sky: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300',
  blue: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  purple: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  pink: 'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300',
  orange: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
  slate: 'bg-slate-100 text-slate-700 dark:bg-white/10 dark:text-slate-200',
  red: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
};

/** Classes do ícone colorido de um tom. */
export function toneClass(tone: NodeTone): string {
  return TONE_CLASS[tone];
}

export type NodeMeta = { label: string; icon: LucideIcon; tone: NodeTone; color: string; hint: string };

/** Rótulo, ícone, cor (minimapa) e dica de cada tipo de passo. */
export const NODE_META: Record<StepType, NodeMeta> = {
  send_text: {
    label: STEP_LABELS.send_text,
    icon: MessageCircle,
    tone: 'green',
    color: '#22c55e',
    hint: 'Envia um texto pelo WhatsApp',
  },
  wait: { label: STEP_LABELS.wait, icon: Clock, tone: 'sky', color: '#0ea5e9', hint: 'Aguarda um tempo antes de seguir' },
  wait_reply: {
    label: STEP_LABELS.wait_reply,
    icon: MessageSquareReply,
    tone: 'blue',
    color: '#3b82f6',
    hint: 'Espera o lead responder, com prazo',
  },
  condition: {
    label: STEP_LABELS.condition,
    icon: GitBranch,
    tone: 'purple',
    color: '#a855f7',
    hint: 'Escolhe o caminho pela resposta do lead',
  },
  move_stage: {
    label: STEP_LABELS.move_stage,
    icon: MoveRight,
    tone: 'orange',
    color: '#f97316',
    hint: 'Move o negócio para uma etapa',
  },
  add_tag: { label: STEP_LABELS.add_tag, icon: Tag, tone: 'pink', color: '#ec4899', hint: 'Adiciona um rótulo ao negócio' },
  webhook: { label: STEP_LABELS.webhook, icon: Webhook, tone: 'slate', color: '#64748b', hint: 'Chama uma URL externa' },
  handoff_agent: {
    label: STEP_LABELS.handoff_agent,
    icon: Bot,
    tone: 'purple',
    color: '#7c3aed',
    hint: 'Um agente de IA assume a conversa',
  },
  end: { label: STEP_LABELS.end, icon: Flag, tone: 'red', color: '#ef4444', hint: 'Encerra o robô' },
};

const TRIGGER_COLOR = '#f59e0b';

/** Cor do nó no minimapa. */
export function minimapColor(type: string | undefined): string {
  if (type === 'trigger') return TRIGGER_COLOR;
  return (type && (NODE_META as Record<string, NodeMeta | undefined>)[type]?.color) || '#94a3b8';
}

// ---------------------------------------------------------------- Peças comuns

/** Cartão do nó: título, ícone, botão de remover, entrada à esquerda e saídas no rodapé. */
function NodeShell({
  id,
  title,
  icon: Icon,
  tone,
  selected,
  deletable = true,
  hasInput = true,
  children,
  outputs,
}: {
  id: string;
  title: string;
  icon: LucideIcon;
  tone: NodeTone;
  selected: boolean;
  deletable?: boolean;
  hasInput?: boolean;
  children: React.ReactNode;
  outputs?: React.ReactNode;
}) {
  const { deleteElements } = useReactFlow<FlowNode, FlowEdge>();
  return (
    <div
      className={`w-[300px] rounded-xl border bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm transition-shadow ${
        selected ? 'border-purple-500 ring-2 ring-purple-500/30 shadow-lg' : 'border-slate-200 dark:border-white/10'
      }`}
    >
      {hasInput ? (
        <Handle type="target" position={Position.Left} id={HANDLE_IN} className="wa-handle-in" aria-label={`Entrada de ${title}`} />
      ) : null}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100 dark:border-white/5">
        <span className={`p-1 rounded-md shrink-0 ${TONE_CLASS[tone]}`} aria-hidden="true">
          <Icon size={14} />
        </span>
        <span className="text-sm font-semibold truncate">{title}</span>
        {deletable ? (
          <button
            type="button"
            className="nodrag ml-auto p-1 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:text-red-400 dark:hover:bg-red-900/20 transition-colors"
            aria-label={`Remover ${title}`}
            title="Remover"
            onClick={() => void deleteElements({ nodes: [{ id }] })}
          >
            <X size={14} aria-hidden="true" />
          </button>
        ) : (
          <span className="ml-auto text-[10px] font-semibold uppercase tracking-wide text-slate-400">Fixo</span>
        )}
      </div>
      <div className="nodrag p-3 space-y-2">{children}</div>
      {outputs ? <div className="border-t border-slate-100 dark:border-white/5 py-1">{outputs}</div> : null}
    </div>
  );
}

/** Linha de saída com rótulo e handle à direita. */
function OutputRow({
  handleId,
  label,
  tone = 'slate',
}: {
  handleId: string;
  label: string;
  tone?: 'slate' | 'green' | 'amber';
}) {
  const color = {
    slate: 'text-slate-500 dark:text-slate-400',
    green: 'text-emerald-600 dark:text-emerald-400',
    amber: 'text-amber-600 dark:text-amber-400',
  }[tone];
  return (
    <div className="relative flex items-center justify-end px-3 py-1.5">
      <span className={`text-[11px] font-medium ${color}`}>{label}</span>
      <Handle type="source" position={Position.Right} id={handleId} aria-label={`Saída: ${label}`} />
    </div>
  );
}

/** Campo numérico que aceita digitação livre e só aplica o limite ao sair do campo. */
function NumberField({
  id,
  value,
  min,
  max,
  onCommit,
  ariaLabel,
  className,
}: {
  id?: string;
  value: number;
  min: number;
  max: number;
  onCommit: (value: number) => void;
  ariaLabel: string;
  className?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      id={id}
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      className={className ?? INPUT_CLASS}
      value={draft ?? String(value)}
      onChange={(e) => {
        setDraft(e.target.value);
        const n = Number(e.target.value);
        if (e.target.value !== '' && Number.isFinite(n)) onCommit(Math.round(n));
      }}
      onBlur={() => {
        if (draft !== null) {
          const n = Number(draft);
          onCommit(draft === '' || !Number.isFinite(n) ? min : Math.max(min, Math.min(max, Math.round(n))));
        }
        setDraft(null);
      }}
      aria-label={ariaLabel}
    />
  );
}

function autoResize(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

// ---------------------------------------------------------------- Gatilho

function TriggerNodeView({ id, data, selected }: NodeProps<TriggerNode>) {
  const { updateNodeData } = useReactFlow<FlowNode, FlowEdge>();
  const { options } = useCanvasContext();
  const boards = options?.boards ?? [];
  const board = boards.find((b) => b.id === data.board_id) ?? null;
  const set = (patch: Partial<TriggerData>) => updateNodeData(id, patch);
  const help =
    data.trigger_type === 'deal_created'
      ? 'Dispara quando um negócio é cadastrado no quadro escolhido (ou em qualquer um).'
      : data.trigger_type === 'deal_stage_entered'
        ? 'Dispara quando um negócio entra nesta etapa.'
        : 'Só dispara pelo botão Testar ou pela API.';

  return (
    <NodeShell
      id={id}
      title="Gatilho"
      icon={Zap}
      tone="amber"
      selected={selected}
      deletable={false}
      hasInput={false}
      outputs={<OutputRow handleId={HANDLE_NEXT} label="Então" tone="green" />}
    >
      <select
        className={INPUT_CLASS}
        value={data.trigger_type}
        aria-label="Quando o robô dispara"
        onChange={(e) => {
          const t = e.target.value as BotTriggerType;
          set(t === 'manual' ? { trigger_type: t, board_id: '', stage_id: '' } : { trigger_type: t });
        }}
      >
        {(Object.keys(TRIGGER_LABELS) as BotTriggerType[]).map((t) => (
          <option key={t} value={t}>
            {TRIGGER_LABELS[t]}
          </option>
        ))}
      </select>
      {data.trigger_type !== 'manual' ? (
        <select
          className={INPUT_CLASS}
          value={data.board_id}
          aria-label="Quadro"
          onChange={(e) => set({ board_id: e.target.value, stage_id: '' })}
        >
          <option value="">{data.trigger_type === 'deal_created' ? 'Qualquer quadro' : 'Selecione o quadro'}</option>
          {boards.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      ) : null}
      {data.trigger_type === 'deal_stage_entered' ? (
        <select
          className={INPUT_CLASS}
          value={data.stage_id}
          aria-label="Etapa"
          disabled={!board}
          onChange={(e) => set({ stage_id: e.target.value })}
        >
          <option value="">Selecione a etapa</option>
          {(board?.stages ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      ) : null}
      <p className={HELP_CLASS}>{help}</p>
    </NodeShell>
  );
}

// ---------------------------------------------------------------- Mensagem

function MessageNodeView({ id, data, selected }: NodeProps<MessageNode>) {
  const { updateNodeData } = useReactFlow<FlowNode, FlowEdge>();
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    autoResize(textRef.current);
  }, [data.text]);

  const insert = (key: string) => {
    const el = textRef.current;
    const value = data.text;
    const startPos = el?.selectionStart ?? value.length;
    const endPos = el?.selectionEnd ?? value.length;
    updateNodeData(id, { text: value.slice(0, startPos) + key + value.slice(endPos) });
    const caret = startPos + key.length;
    window.setTimeout(() => {
      const target = textRef.current;
      if (!target) return;
      target.focus();
      target.setSelectionRange(caret, caret);
    }, 0);
  };

  return (
    <NodeShell
      id={id}
      title="Mensagem"
      icon={MessageCircle}
      tone="green"
      selected={selected}
      outputs={<OutputRow handleId={HANDLE_NEXT} label="Depois" />}
    >
      <div className="rounded-2xl rounded-tl-md bg-[#d9fdd3] dark:bg-[#005c4b] px-3 py-2 shadow-sm">
        <textarea
          ref={textRef}
          className="nowheel w-full bg-transparent resize-none outline-none text-sm leading-snug text-slate-900 dark:text-white placeholder:text-slate-500 dark:placeholder:text-emerald-100/70"
          rows={2}
          value={data.text}
          onChange={(e) => updateNodeData(id, { text: e.target.value })}
          placeholder="Escreva a mensagem..."
          aria-label="Texto da mensagem"
          maxLength={4000}
        />
      </div>
      <div className="flex flex-wrap gap-1" role="group" aria-label="Variáveis disponíveis">
        {BOT_VARIABLES.map((v) => (
          <button
            key={v.key}
            type="button"
            className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-slate-300 hover:bg-purple-100 dark:hover:bg-purple-900/30 transition-colors"
            title={`Inserir ${v.description}`}
            onClick={() => insert(v.key)}
          >
            {v.key}
          </button>
        ))}
      </div>
    </NodeShell>
  );
}

// ---------------------------------------------------------------- Esperar

function maxAmountFor(unit: WaitUnit): number {
  return Math.floor(MAX_WAIT_SECONDS / WAIT_UNIT_SECONDS[unit]);
}

function WaitNodeView({ id, data, selected }: NodeProps<WaitNode>) {
  const { updateNodeData } = useReactFlow<FlowNode, FlowEdge>();
  return (
    <NodeShell
      id={id}
      title="Esperar"
      icon={Clock}
      tone="sky"
      selected={selected}
      outputs={<OutputRow handleId={HANDLE_NEXT} label="Depois" />}
    >
      <div className="flex items-center gap-2">
        <NumberField
          className={`${INPUT_CLASS} w-24`}
          value={data.amount}
          min={1}
          max={maxAmountFor(data.unit)}
          onCommit={(amount) => updateNodeData(id, { amount })}
          ariaLabel="Quanto tempo esperar"
        />
        <select
          className={INPUT_CLASS}
          value={data.unit}
          aria-label="Unidade de tempo"
          onChange={(e) => {
            const unit = e.target.value as WaitUnit;
            updateNodeData(id, { unit, amount: Math.min(data.amount, maxAmountFor(unit)) });
          }}
        >
          {(Object.keys(WAIT_UNIT_LABELS) as WaitUnit[]).map((u) => (
            <option key={u} value={u}>
              {WAIT_UNIT_LABELS[u]}
            </option>
          ))}
        </select>
      </div>
      <p className={HELP_CLASS}>No máximo 7 dias.</p>
    </NodeShell>
  );
}

// ---------------------------------------------------------------- Esperar resposta

function WaitReplyNodeView({ id, data, selected }: NodeProps<WaitReplyNode>) {
  const { updateNodeData } = useReactFlow<FlowNode, FlowEdge>();
  return (
    <NodeShell
      id={id}
      title="Esperar resposta"
      icon={MessageSquareReply}
      tone="blue"
      selected={selected}
      outputs={
        <>
          <OutputRow handleId={HANDLE_NEXT} label="Respondeu" tone="green" />
          <OutputRow handleId={HANDLE_TIMEOUT} label="Sem resposta" tone="amber" />
        </>
      }
    >
      <label htmlFor={`node-${id}-timeout`} className="block text-xs font-medium text-slate-600 dark:text-slate-300">
        Aguardar por (minutos)
      </label>
      <NumberField
        id={`node-${id}-timeout`}
        value={data.timeout_minutes}
        min={1}
        max={MAX_REPLY_MINUTES}
        onCommit={(timeout_minutes) => updateNodeData(id, { timeout_minutes })}
        ariaLabel="Minutos aguardando resposta"
      />
      <p className={HELP_CLASS}>Até 30 dias (43200 minutos). Sem resposta no prazo, segue pela saída "Sem resposta".</p>
    </NodeShell>
  );
}

// ---------------------------------------------------------------- Condição

function ConditionNodeView({ id, data, selected }: NodeProps<ConditionNode>) {
  const { updateNodeData, setEdges } = useReactFlow<FlowNode, FlowEdge>();
  const updateNodeInternals = useUpdateNodeInternals();
  const ruleCount = data.rules.length;

  // Regras entram e saem: avisa o React Flow para medir os handles de novo.
  useEffect(() => {
    updateNodeInternals(id);
  }, [id, ruleCount, updateNodeInternals]);

  const setRules = (rules: ConditionRuleDraft[]) => updateNodeData(id, { rules });
  const removeRule = (rule: ConditionRuleDraft) => {
    setRules(data.rules.filter((r) => r.id !== rule.id));
    const handle = ruleHandleId(rule.id);
    setEdges((eds) => eds.filter((e) => !(e.source === id && e.sourceHandle === handle)));
  };

  return (
    <NodeShell
      id={id}
      title="Condição"
      icon={GitBranch}
      tone="purple"
      selected={selected}
      outputs={<OutputRow handleId={HANDLE_ELSE} label="Senão" tone="amber" />}
    >
      <p className={HELP_CLASS}>
        Compara a última resposta do lead (sem acentos, sem diferenciar maiúsculas). A primeira regra que bater decide o
        caminho. Separe as palavras por vírgula; use aspas para palavras com vírgula, ex.: "sim, quero".
      </p>
      {data.rules.map((rule, index) => (
        <div key={rule.id} className="relative flex items-center gap-1 -mr-3 pr-4">
          <input
            className={INPUT_CLASS}
            value={rule.keywords}
            onChange={(e) =>
              setRules(data.rules.map((r) => (r.id === rule.id ? { ...r, keywords: e.target.value } : r)))
            }
            placeholder="sim, quero, pode"
            aria-label={`Palavras-chave da regra ${index + 1} (separadas por vírgula)`}
          />
          <button
            type="button"
            className="p-1 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:text-red-400 dark:hover:bg-red-900/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            aria-label={`Remover regra ${index + 1}`}
            title="Remover regra"
            disabled={ruleCount <= 1}
            onClick={() => removeRule(rule)}
          >
            <Trash2 size={12} aria-hidden="true" />
          </button>
          <Handle
            type="source"
            position={Position.Right}
            id={ruleHandleId(rule.id)}
            aria-label={`Saída da regra ${index + 1}`}
          />
        </div>
      ))}
      <button
        type="button"
        className="inline-flex items-center gap-1 text-xs font-medium text-purple-600 dark:text-purple-300 hover:underline"
        onClick={() => setRules([...data.rules, { id: newId(), keywords: '' }])}
      >
        <Plus size={12} aria-hidden="true" />
        regra
      </button>
    </NodeShell>
  );
}

// ---------------------------------------------------------------- Mover etapa

function MoveStageNodeView({ id, data, selected }: NodeProps<MoveStageNode>) {
  const { updateNodeData } = useReactFlow<FlowNode, FlowEdge>();
  const { options } = useCanvasContext();
  return (
    <NodeShell
      id={id}
      title="Mover etapa"
      icon={MoveRight}
      tone="orange"
      selected={selected}
      outputs={<OutputRow handleId={HANDLE_NEXT} label="Depois" />}
    >
      <StageSelect
        id={`node-${id}-stage`}
        value={data.stage_id}
        onChange={(stage_id) => updateNodeData(id, { stage_id })}
        options={options}
        ariaLabel="Etapa de destino"
      />
      <p className={HELP_CLASS}>Sem negócio ligado à conversa, este passo é pulado.</p>
    </NodeShell>
  );
}

// ---------------------------------------------------------------- Rótulo

function TagNodeView({ id, data, selected }: NodeProps<TagNode>) {
  const { updateNodeData } = useReactFlow<FlowNode, FlowEdge>();
  const { options } = useCanvasContext();
  return (
    <NodeShell
      id={id}
      title="Rótulo"
      icon={Tag}
      tone="pink"
      selected={selected}
      outputs={<OutputRow handleId={HANDLE_NEXT} label="Depois" />}
    >
      <TagInput
        id={`node-${id}-tag`}
        value={data.tag}
        onChange={(tag) => updateNodeData(id, { tag })}
        options={options}
        ariaLabel="Rótulo a adicionar"
      />
      <p className={HELP_CLASS}>Adiciona o rótulo ao negócio da conversa.</p>
    </NodeShell>
  );
}

// ---------------------------------------------------------------- Webhook

function WebhookNodeView({ id, data, selected }: NodeProps<WebhookNode>) {
  const { updateNodeData } = useReactFlow<FlowNode, FlowEdge>();
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    autoResize(bodyRef.current);
  }, [data.body_template]);

  return (
    <NodeShell
      id={id}
      title="Webhook"
      icon={Webhook}
      tone="slate"
      selected={selected}
      outputs={<OutputRow handleId={HANDLE_NEXT} label="Depois" />}
    >
      <input
        type="url"
        className={INPUT_CLASS}
        value={data.url}
        onChange={(e) => updateNodeData(id, { url: e.target.value })}
        placeholder="https://..."
        aria-label="URL do webhook"
        autoComplete="off"
      />
      <input
        type="password"
        className={INPUT_CLASS}
        value={data.secret}
        onChange={(e) => updateNodeData(id, { secret: e.target.value })}
        placeholder="Segredo (opcional)"
        aria-label="Segredo do webhook"
        autoComplete="off"
        maxLength={200}
      />
      <textarea
        ref={bodyRef}
        className={`${INPUT_CLASS} nowheel resize-none font-mono text-xs`}
        rows={2}
        value={data.body_template}
        onChange={(e) => updateNodeData(id, { body_template: e.target.value })}
        placeholder={'Corpo personalizado (opcional), ex.: {"telefone": "{{telefone}}"}'}
        aria-label="Corpo personalizado do webhook"
        maxLength={20000}
      />
      <p className={HELP_CLASS}>POST em JSON. Vazio: envia os dados padrão do lead e do negócio.</p>
    </NodeShell>
  );
}

// ---------------------------------------------------------------- Entregar a agente

function HandoffNodeView({ id, data, selected }: NodeProps<HandoffNode>) {
  const { updateNodeData } = useReactFlow<FlowNode, FlowEdge>();
  const { agents } = useCanvasContext();
  return (
    <NodeShell id={id} title="Entregar a agente" icon={Bot} tone="purple" selected={selected}>
      <AgentSelect
        id={`node-${id}-agent`}
        value={data.agent_id}
        onChange={(agent_id) => updateNodeData(id, { agent_id })}
        agents={agents}
        ariaLabel="Agente de IA que assume"
      />
      <p className={HELP_CLASS}>O robô encerra e o agente de IA assume a conversa a partir daqui.</p>
    </NodeShell>
  );
}

// ---------------------------------------------------------------- Encerrar

function EndNodeView({ id, selected }: NodeProps<EndNode>) {
  return (
    <NodeShell id={id} title="Encerrar" icon={Flag} tone="red" selected={selected}>
      <p className={HELP_CLASS}>O robô termina aqui.</p>
    </NodeShell>
  );
}

// ---------------------------------------------------------------- Registro

/** Mapa tipo -> componente, referência estável para o React Flow. */
export const nodeTypes: NodeTypes = {
  trigger: TriggerNodeView,
  send_text: MessageNodeView,
  wait: WaitNodeView,
  wait_reply: WaitReplyNodeView,
  condition: ConditionNodeView,
  move_stage: MoveStageNodeView,
  add_tag: TagNodeView,
  webhook: WebhookNodeView,
  handoff_agent: HandoffNodeView,
  end: EndNodeView,
};
