'use client';

/**
 * Nós do quadro do robô: Gatilho (fixo) e Balão (blocos empilhados, estilo Typebot).
 *
 * O balão mostra cada bloco com ícone, título e resumo; a edição dos campos
 * acontece no painel de propriedades (BlockPanel). A entrada fica à esquerda,
 * no cabeçalho; as saídas (uma por saída do ÚLTIMO bloco) ficam à direita, no
 * rodapé. Blocos podem ser reordenados arrastando pela alça ou pelos botões
 * de subir/descer, e recebem blocos soltos da paleta ou de outro balão.
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
  AlertCircle,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Copy,
  CopyPlus,
  GripVertical,
  MoreHorizontal,
  Pencil,
  Plus,
  Rows3,
  Trash2,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import type { WaAgentListItem, WaAgentOptions } from '../useWaAgents';
import { HELP_CLASS, INPUT_CLASS } from '../ui';
import { BlockCatalog, BlockIcon, NODE_META, toneClass } from './catalog';
import { useCanvasContext, type IssueSummary } from './context';
import { bubbleTitle } from './serialize';
import {
  DND_BLOCK_MIME,
  DND_MIME,
  HANDLE_IN,
  HANDLE_NEXT,
  STEP_LABELS,
  TRIGGER_LABELS,
  WAIT_UNIT_LABELS,
  bubbleOutputs,
  buttonHandleId,
  edgeIdFor,
  isButtonHandle,
  isStepType,
  isValidBlockOrder,
  placementProblem,
  type Block,
  type BlockRef,
  type BotTriggerType,
  type BubbleNode,
  type FlowEdge,
  type FlowNode,
  type OutputTone,
  type StepType,
  type TriggerData,
  type TriggerNode,
  type WaitUnit,
} from './types';

export { NODE_META, toneClass } from './catalog';

const TRIGGER_COLOR = '#f59e0b';

/** Cor do nó no minimapa (balão: cor do primeiro bloco). */
export function minimapColor(node: FlowNode): string {
  if (node.type === 'trigger') return TRIGGER_COLOR;
  const first = node.type === 'bubble' ? node.data.blocks[0] : undefined;
  return first ? NODE_META[first.type].color : '#94a3b8';
}

const WAIT_UNIT_SINGULAR: Record<WaitUnit, string> = { s: 'segundo', min: 'minuto', h: 'hora', d: 'dia' };

/** Resumo curto de um bloco, mostrado dentro do balão. */
export function blockSummary(block: Block, options: WaAgentOptions | undefined, agents: WaAgentListItem[]): string {
  switch (block.type) {
    case 'send_text':
      return block.data.text.trim() || 'Sem texto ainda';
    case 'send_template': {
      const name = block.data.template_name.trim() || (block.data.template_id ? 'Modelo escolhido' : 'Escolha o modelo');
      const n = block.data.buttons.length;
      return n > 0 ? `${name} · ${n} ${n === 1 ? 'botão' : 'botões'}` : name;
    }
    case 'wait': {
      const { amount, unit } = block.data;
      return `${amount} ${amount === 1 ? WAIT_UNIT_SINGULAR[unit] : WAIT_UNIT_LABELS[unit]}`;
    }
    case 'wait_reply':
      return `Aguarda a resposta por até ${block.data.timeout_minutes} min`;
    case 'typing':
      return `Digitando por ${block.data.seconds}s`;
    case 'start_bot':
      return block.data.bot_name.trim() || (block.data.bot_id ? 'Robô escolhido' : 'Escolha o robô');
    case 'condition': {
      const n = block.data.rules.length;
      return `${n} ${n === 1 ? 'regra' : 'regras'} + Senão`;
    }
    case 'move_stage': {
      for (const board of options?.boards ?? []) {
        const stage = board.stages.find((s) => s.id === block.data.stage_id);
        if (stage) return `${board.name} › ${stage.label}`;
      }
      return block.data.stage_id ? 'Etapa não encontrada' : 'Escolha a etapa';
    }
    case 'add_tag':
      return block.data.tag.trim() || 'Informe o rótulo';
    case 'webhook': {
      const url = block.data.url.trim();
      if (!url) return 'Informe a URL';
      try {
        return new URL(url).host;
      } catch {
        return url;
      }
    }
    case 'handoff_agent': {
      const agent = agents.find((a) => a.id === block.data.agent_id);
      return agent ? agent.name : block.data.agent_id ? 'Agente não encontrado' : 'Escolha o agente';
    }
    case 'end':
      return 'O robô termina aqui';
  }
}

/**
 * Motivo de um bloco não poder ir da posição `from` para a posição de inserção
 * `rawIndex` (contada na lista atual, antes de tirar o bloco), ou null.
 */
function moveProblem(types: StepType[], from: number, rawIndex: number): string | null {
  const rest = types.filter((_, i) => i !== from);
  const index = rawIndex > from ? rawIndex - 1 : rawIndex;
  return placementProblem(rest, types[from], index);
}

// ---------------------------------------------------------------- Peças comuns

const OUTPUT_COLOR: Record<OutputTone, string> = {
  slate: 'text-slate-500 dark:text-slate-400',
  green: 'text-emerald-600 dark:text-emerald-400',
  amber: 'text-amber-600 dark:text-amber-400',
};

/** Linha de saída com rótulo e handle à direita; saída sem ligação fica esmaecida. */
function OutputRow({
  handleId,
  label,
  tone,
  connected,
}: {
  handleId: string;
  label: string;
  tone: OutputTone;
  connected: boolean;
}) {
  return (
    <div
      className="relative flex items-center justify-end px-3 py-1.5"
      title={connected ? undefined : 'Sem ligação: o robô termina aqui. Arraste da bolinha até outro balão.'}
    >
      <span className={`text-[11px] font-medium truncate ${OUTPUT_COLOR[tone]} ${connected ? '' : 'opacity-60'}`}>{label}</span>
      <Handle
        type="source"
        position={Position.Right}
        id={handleId}
        className={connected ? undefined : 'wa-handle-loose'}
        aria-label={`Saída: ${label}${connected ? '' : ' (sem ligação)'}`}
      />
    </div>
  );
}

function IssueMark({ issue, size = 14 }: { issue: IssueSummary | undefined; size?: number }) {
  if (!issue) return null;
  if (issue.errors.length > 0) {
    return (
      <span className="text-red-500 shrink-0" title={issue.errors.join('\n')} aria-label={`Problemas: ${issue.errors.join('; ')}`}>
        <AlertCircle size={size} aria-hidden="true" />
      </span>
    );
  }
  if (issue.warnings.length > 0) {
    return (
      <span className="text-amber-500 shrink-0" title={issue.warnings.join('\n')} aria-label={`Avisos: ${issue.warnings.join('; ')}`}>
        <AlertTriangle size={size} aria-hidden="true" />
      </span>
    );
  }
  return null;
}

/** Fecha ao clicar fora do elemento ou ao apertar Esc. */
function useDismiss(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    // Captura: fecha antes de o editor tratar o Esc (que fecharia o painel ou o editor)
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open, onClose]);
  return ref;
}

function MenuItem({
  icon: Icon,
  label,
  shortcut,
  danger = false,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  shortcut?: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors ${
        danger
          ? 'text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20'
          : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10'
      }`}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      <Icon size={14} aria-hidden="true" />
      <span className="flex-1">{label}</span>
      {shortcut ? <kbd className="text-[10px] text-slate-400 font-sans">{shortcut}</kbd> : null}
    </button>
  );
}

// ---------------------------------------------------------------- Gatilho

function TriggerNodeView({ id, data, selected }: NodeProps<TriggerNode>) {
  const { updateNodeData } = useReactFlow<FlowNode, FlowEdge>();
  const { options, issues, connected } = useCanvasContext();
  const boards = options?.boards ?? [];
  const board = boards.find((b) => b.id === data.board_id) ?? null;
  const set = (patch: Partial<TriggerData>) => updateNodeData(id, patch);
  const help =
    data.trigger_type === 'deal_created'
      ? 'Dispara quando um negócio é cadastrado no quadro escolhido (ou em qualquer um).'
      : data.trigger_type === 'deal_stage_entered'
        ? 'Dispara quando um negócio entra nesta etapa.'
        : 'Só dispara pelo botão Testar ou pela API.';
  const issue = issues.byNode.get(id);
  const linked = connected.has(edgeIdFor(id, HANDLE_NEXT));

  return (
    <div
      className={`w-[300px] rounded-xl border bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm transition-shadow ${
        selected
          ? 'border-purple-500 ring-2 ring-purple-500/30 shadow-lg'
          : issue?.errors.length
            ? 'border-red-400 dark:border-red-500/60'
            : 'border-slate-200 dark:border-white/10'
      }`}
    >
      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100 dark:border-white/5">
        <span className={`p-1 rounded-md shrink-0 ${toneClass('amber')}`} aria-hidden="true">
          <Zap size={14} />
        </span>
        <span className="text-sm font-semibold truncate">Gatilho</span>
        <IssueMark issue={issue} />
        <span className="ml-auto text-[10px] font-semibold uppercase tracking-wide text-slate-400">Fixo</span>
      </div>
      <div className="nodrag p-3 space-y-2">
        <select
          className={INPUT_CLASS}
          value={data.trigger_type}
          aria-label="Quando o robô dispara"
          onChange={(e) => {
            const t = e.target.value as BotTriggerType;
            set(t === 'manual' || t === 'agent_followup' ? { trigger_type: t, board_id: '', stage_id: '' } : { trigger_type: t });
          }}
        >
          {(Object.keys(TRIGGER_LABELS) as BotTriggerType[]).map((t) => (
            <option key={t} value={t}>
              {TRIGGER_LABELS[t]}
            </option>
          ))}
        </select>
        {data.trigger_type === 'agent_followup' ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Entra em ação quando uma regra de follow-up de um agente de IA aponta para este robô (lead sem responder).
          </p>
        ) : null}
        {data.trigger_type !== 'manual' && data.trigger_type !== 'agent_followup' ? (
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
      </div>
      <div className="border-t border-slate-100 dark:border-white/5 py-1">
        <OutputRow handleId={HANDLE_NEXT} label="Então" tone="green" connected={linked} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Balão

type DropTarget = 'bubble' | number | null;

function acceptsDrop(e: React.DragEvent): boolean {
  const types = e.dataTransfer.types;
  return types.includes(DND_MIME) || types.includes(DND_BLOCK_MIME);
}

/** Índice de inserção (antes ou depois da linha) pela posição vertical do mouse. */
function insertionIndex(e: React.DragEvent, el: HTMLElement | null, index: number): number {
  if (!el) return index + 1;
  const rect = el.getBoundingClientRect();
  return e.clientY < rect.top + rect.height / 2 ? index : index + 1;
}

function BlockRow({
  bubbleId,
  block,
  index,
  types,
  selected,
  issue,
  summary,
  dropIndex,
  onDragOverRow,
  onDropRow,
}: {
  bubbleId: string;
  block: Block;
  index: number;
  types: StepType[];
  selected: boolean;
  issue: IssueSummary | undefined;
  summary: string;
  dropIndex: DropTarget;
  onDragOverRow: (index: number) => void;
  onDropRow: (e: React.DragEvent, index: number) => void;
}) {
  const { actions, connected } = useCanvasContext();
  const rowRef = useRef<HTMLLIElement>(null);
  const isLast = index === types.length - 1;
  const ref: BlockRef = { bubbleId, blockId: block.id };
  const upProblem = index === 0 ? 'Já é o primeiro bloco' : moveProblem(types, index, index - 1);
  const downProblem = isLast ? 'Já é o último bloco' : moveProblem(types, index, index + 2);
  const hasError = (issue?.errors.length ?? 0) > 0;
  const label = STEP_LABELS[block.type];

  return (
    <li
      ref={rowRef}
      className={`group relative flex items-start gap-1.5 rounded-lg border pl-1 pr-1.5 py-1.5 cursor-pointer transition-colors ${
        selected
          ? 'border-purple-500 bg-purple-50/70 dark:bg-purple-900/20'
          : hasError
            ? 'border-red-300 dark:border-red-500/50 bg-white dark:bg-slate-900'
            : 'border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 hover:border-purple-300 dark:hover:border-purple-500/50'
      }`}
      onClick={() => actions.selectBlock(ref)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          actions.selectBlock(ref);
        }
      }}
      onDragOver={(e) => {
        if (!acceptsDrop(e)) return;
        e.preventDefault();
        e.stopPropagation();
        onDragOverRow(insertionIndex(e, rowRef.current, index));
      }}
      onDrop={(e) => {
        if (!acceptsDrop(e)) return;
        e.preventDefault();
        e.stopPropagation();
        onDropRow(e, insertionIndex(e, rowRef.current, index));
      }}
      tabIndex={0}
      role="button"
      aria-pressed={selected}
      aria-label={`${label}: ${summary}`}
    >
      {dropIndex === index ? <span className="wa-drop-line -top-1" aria-hidden="true" /> : null}
      {isLast && dropIndex === index + 1 ? <span className="wa-drop-line -bottom-1" aria-hidden="true" /> : null}
      <span
        className="nodrag wa-block-grip mt-1 shrink-0 text-slate-300 hover:text-slate-500 dark:text-slate-600 dark:hover:text-slate-300 cursor-grab active:cursor-grabbing"
        draggable
        onClick={(e) => e.stopPropagation()}
        onDragStart={(e) => {
          e.stopPropagation();
          e.dataTransfer.setData(DND_BLOCK_MIME, JSON.stringify(ref));
          e.dataTransfer.effectAllowed = 'move';
          if (rowRef.current) e.dataTransfer.setDragImage(rowRef.current, 16, 16);
        }}
        title="Arraste para reordenar ou levar a outro balão"
        aria-label={`Arrastar o bloco ${label}`}
      >
        <GripVertical size={12} aria-hidden="true" />
      </span>
      <BlockIcon type={block.type} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1">
          <span className="text-xs font-semibold truncate">{label}</span>
          <IssueMark issue={issue} size={12} />
        </div>
        <p className="text-xs text-slate-600 dark:text-slate-300 line-clamp-3 whitespace-pre-line break-words">{summary}</p>
        {block.type === 'send_template' && isLast && block.data.buttons.length > 0 ? (
          <ul className="mt-1.5 space-y-1" aria-label="Botões do modelo (uma saída por botão)">
            {block.data.buttons.map((text, i) => {
              const handleId = buttonHandleId(i);
              const isConnected = connected.has(edgeIdFor(bubbleId, handleId));
              return (
                <li
                  key={handleId}
                  className="relative flex items-center justify-between gap-2 rounded-md border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-900/15 pl-2 pr-3 py-1 text-[11px] font-medium text-emerald-800 dark:text-emerald-200"
                  title={isConnected ? undefined : 'Sem ligação: arraste da bolinha até outro balão'}
                >
                  <span className={`truncate ${isConnected ? '' : 'opacity-70'}`}>{text.trim() || `Botão ${i + 1}`}</span>
                  <Handle
                    type="source"
                    position={Position.Right}
                    id={handleId}
                    className={isConnected ? undefined : 'wa-handle-loose'}
                    aria-label={`Saída do botão ${text.trim() || i + 1}${isConnected ? '' : ' (sem ligação)'}`}
                  />
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
      <div className="nodrag wa-block-actions flex flex-col items-center -my-0.5">
        <button
          type="button"
          className="p-0.5 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:text-white dark:hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed"
          disabled={!!upProblem}
          title={upProblem ?? 'Subir'}
          aria-label={`Subir o bloco ${label}`}
          onClick={(e) => {
            e.stopPropagation();
            actions.moveBlock(ref, bubbleId, index - 1);
          }}
        >
          <ChevronUp size={12} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="p-0.5 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:text-white dark:hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed"
          disabled={!!downProblem}
          title={downProblem ?? 'Descer'}
          aria-label={`Descer o bloco ${label}`}
          onClick={(e) => {
            e.stopPropagation();
            actions.moveBlock(ref, bubbleId, index + 2);
          }}
        >
          <ChevronDown size={12} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="p-0.5 rounded text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:text-red-400 dark:hover:bg-red-900/20"
          title="Remover bloco"
          aria-label={`Remover o bloco ${label}`}
          onClick={(e) => {
            e.stopPropagation();
            actions.removeBlock(ref);
          }}
        >
          <X size={12} aria-hidden="true" />
        </button>
      </div>
    </li>
  );
}

function BubbleNodeView({ id, data, selected }: NodeProps<BubbleNode>) {
  const { actions, issues, connected, selectedBlock, options, agents } = useCanvasContext();
  const updateNodeInternals = useUpdateNodeInternals();
  const blocks = data.blocks;
  const types = blocks.map((b) => b.type);
  const outputs = bubbleOutputs(blocks);
  const handleKey = outputs.map((o) => o.handleId).join('|');
  const title = bubbleTitle(data);

  // Blocos entram, saem e mudam de ordem: avisa o React Flow para medir os handles de novo.
  useEffect(() => {
    updateNodeInternals(id);
  }, [id, handleKey, blocks.length, updateNodeInternals]);

  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(data.name);
  const [menuOpen, setMenuOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [drop, setDrop] = useState<DropTarget>(null);
  const menuRef = useDismiss(menuOpen, () => setMenuOpen(false));
  const addRef = useDismiss(addOpen, () => setAddOpen(false));

  const issue = issues.byNode.get(id);
  const hasError = (issue?.errors.length ?? 0) > 0;
  const last = blocks[blocks.length - 1];
  // Depois de um bloco com várias saídas ou terminal não entra mais nada.
  const appendProblem = last ? placementProblem(types, 'send_text', blocks.length) : null;
  const orderOk = isValidBlockOrder(types);

  const startRename = () => {
    setDraftName(data.name);
    setEditing(true);
    setMenuOpen(false);
  };
  const commitRename = () => {
    setEditing(false);
    if (draftName.trim() !== data.name.trim()) actions.renameBubble(id, draftName.trim().slice(0, 80));
  };

  const handleDrop = (e: React.DragEvent, index: number) => {
    setDrop(null);
    const type = e.dataTransfer.getData(DND_MIME);
    if (type && isStepType(type)) {
      actions.addBlock(id, type, index);
      return;
    }
    const raw = e.dataTransfer.getData(DND_BLOCK_MIME);
    if (!raw) return;
    try {
      const from = JSON.parse(raw) as BlockRef;
      if (from && typeof from.bubbleId === 'string' && typeof from.blockId === 'string') actions.moveBlock(from, id, index);
    } catch {
      // conteúdo inesperado no arrasto: ignora
    }
  };

  return (
    <div
      className={`relative w-[300px] rounded-xl border bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm transition-shadow ${
        selected
          ? 'border-purple-500 ring-2 ring-purple-500/30 shadow-lg'
          : hasError
            ? 'border-red-400 dark:border-red-500/60'
            : 'border-slate-200 dark:border-white/10'
      } ${drop === 'bubble' ? 'ring-2 ring-emerald-400/70' : ''}`}
      onDragOver={(e) => {
        if (!acceptsDrop(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = e.dataTransfer.types.includes(DND_BLOCK_MIME) ? 'move' : 'copy';
        setDrop('bubble');
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDrop(null);
      }}
      onDrop={(e) => {
        if (!acceptsDrop(e)) return;
        e.preventDefault();
        e.stopPropagation();
        handleDrop(e, blocks.length);
      }}
      data-bubble-id={id}
    >
      <div
        className="relative flex items-center gap-1.5 pl-3 pr-1.5 py-1.5 border-b border-slate-100 dark:border-white/5"
        onDoubleClick={(e) => {
          e.stopPropagation();
          startRename();
        }}
      >
        <Handle type="target" position={Position.Left} id={HANDLE_IN} className="wa-handle-in" aria-label={`Entrada de ${title}`} />
        <Rows3 size={14} className="text-slate-400 shrink-0" aria-hidden="true" />
        {editing ? (
          <input
            autoFocus
            className="nodrag flex-1 min-w-0 bg-slate-50 dark:bg-slate-800 border border-purple-500 rounded px-1.5 py-0.5 text-sm font-semibold outline-none"
            value={draftName}
            maxLength={80}
            placeholder={title}
            aria-label="Nome do balão"
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') commitRename();
              if (e.key === 'Escape') setEditing(false);
            }}
            onMouseDown={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="flex-1 min-w-0 text-sm font-semibold truncate select-none" title="Duplo clique para renomear">
            {title}
          </span>
        )}
        <IssueMark issue={issue} />
        <div ref={menuRef} className="nodrag relative shrink-0">
          <button
            type="button"
            className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:text-white dark:hover:bg-white/10 transition-colors"
            aria-label={`Opções do balão ${title}`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            title="Opções"
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((v) => !v);
            }}
          >
            <MoreHorizontal size={14} aria-hidden="true" />
          </button>
          {menuOpen ? (
            <div
              role="menu"
              className="nodrag nopan absolute right-0 top-full mt-1 z-30 w-48 py-1 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-800 shadow-lg"
            >
              <MenuItem icon={Pencil} label="Renomear" onClick={startRename} />
              <MenuItem
                icon={CopyPlus}
                label="Duplicar"
                shortcut="Ctrl+D"
                onClick={() => {
                  setMenuOpen(false);
                  actions.duplicateBubbles([id]);
                }}
              />
              <MenuItem
                icon={Copy}
                label="Copiar"
                shortcut="Ctrl+C"
                onClick={() => {
                  setMenuOpen(false);
                  actions.copyBubbles([id]);
                }}
              />
              <MenuItem
                icon={Trash2}
                label="Excluir"
                shortcut="Delete"
                danger
                onClick={() => {
                  setMenuOpen(false);
                  actions.deleteBubbles([id]);
                }}
              />
            </div>
          ) : null}
        </div>
      </div>

      <ol className="p-2 space-y-1.5" aria-label={`Blocos do balão ${title}`}>
        {blocks.map((block, index) => (
          <BlockRow
            key={block.id}
            bubbleId={id}
            block={block}
            index={index}
            types={types}
            selected={selectedBlock?.bubbleId === id && selectedBlock.blockId === block.id}
            issue={issues.byBlock.get(block.id)}
            summary={blockSummary(block, options, agents)}
            dropIndex={drop}
            onDragOverRow={(i) => setDrop(i)}
            onDropRow={(e, i) => handleDrop(e, i)}
          />
        ))}
        {blocks.length === 0 ? (
          <li className="rounded-lg border border-dashed border-slate-300 dark:border-white/15 px-2 py-3 text-center text-xs text-slate-400">
            Balão vazio: solte um bloco aqui
          </li>
        ) : null}
      </ol>

      <div ref={addRef} className="nodrag relative px-2 pb-2">
        <button
          type="button"
          className="w-full inline-flex items-center justify-center gap-1 rounded-lg border border-dashed border-slate-300 dark:border-white/15 px-2 py-1.5 text-xs font-medium text-purple-600 dark:text-purple-300 hover:border-purple-400 hover:bg-purple-50 dark:hover:bg-purple-900/20 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent transition-colors"
          disabled={!!appendProblem}
          title={appendProblem ?? 'Adicionar um bloco ao fim deste balão'}
          aria-expanded={addOpen}
          onClick={(e) => {
            e.stopPropagation();
            setAddOpen((v) => !v);
          }}
        >
          <Plus size={12} aria-hidden="true" />
          Adicionar bloco
        </button>
        {appendProblem ? <p className="mt-1 text-[10px] leading-snug text-slate-400 text-center">{appendProblem}</p> : null}
        {!orderOk ? (
          <p className="mt-1 text-[10px] leading-snug text-red-500 text-center">
            Só o último bloco pode ter várias saídas ou encerrar o robô.
          </p>
        ) : null}
        {addOpen ? (
          <div className="nodrag nopan nowheel absolute left-2 right-2 top-full z-30 mt-1 max-h-64 overflow-y-auto p-1 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-800 shadow-lg">
            <BlockCatalog
              onPick={(type) => {
                setAddOpen(false);
                actions.addBlock(id, type);
              }}
            />
          </div>
        ) : null}
      </div>

      {outputs.length > 0 ? (
        <div className="border-t border-slate-100 dark:border-white/5 py-1">
          {outputs.filter((o) => !isButtonHandle(o.handleId)).map((o) => (
            <OutputRow key={o.handleId} handleId={o.handleId} label={o.label} tone={o.tone} connected={connected.has(edgeIdFor(id, o.handleId))} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- Registro

/** Mapa tipo -> componente, referência estável para o React Flow. */
export const nodeTypes: NodeTypes = {
  trigger: TriggerNodeView,
  bubble: BubbleNodeView,
};
