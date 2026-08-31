'use client';

/**
 * Editor do robô em quadro visual (React Flow), aberto como uma camada de tela
 * cheia por cima do app (portal em document.body, estilo Typebot): barra superior
 * (voltar, nome, ligado, número que envia, Testar, Salvar), quadro ocupando todo
 * o resto da altura, paleta de blocos flutuando sobre o quadro e painel de
 * propriedades do bloco (gaveta à direita no desktop, folha inferior no celular).
 *
 * Balões empilham vários blocos; copiar/colar/duplicar/excluir agem sobre os
 * balões selecionados (Ctrl/Cmd+C, V, D e Delete). Robô novo começa vazio e
 * desligado (rascunho); ligar exige o gatilho ligado a um balão.
 * Salva via POST (novo) ou PATCH (existente) com o payload validado por BotInputSchema.
 */
import '@xyflow/react/dist/style.css';
import './canvas/canvas.css';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type XYPosition,
} from '@xyflow/react';
import { ArrowLeft, Loader2, Play, Save } from 'lucide-react';
import ConfirmModal from '@/components/ConfirmModal';
import { Modal } from '@/components/ui/Modal';
import { FocusTrap } from '@/lib/a11y';
import { useTheme } from '@/context/ThemeContext';
import { useToast } from '@/context/ToastContext';
import { BotInputSchema, type BotInput, type BotRow } from '@/lib/wa-agents/types';
import { DEFAULT_BOT_STEPS } from '@/lib/wa-agents/defaults';
import {
  useSaveWaBot,
  useStartWaBot,
  useWaAgentOptions,
  useWaAgentsList,
  type WaAgentListItem,
  type WaAgentOptions,
} from './useWaAgents';
import {
  BTN_ICON,
  BTN_PRIMARY,
  Badge,
  BTN_SECONDARY,
  Field,
  INPUT_CLASS,
  Notice,
  Toggle,
  describeZodIssue,
  errorMessage,
} from './ui';
import { BotCanvas } from './canvas/BotCanvas';
import { BlockPanel } from './canvas/BlockPanel';
import { Palette } from './canvas/Palette';
import {
  CanvasContext,
  type CanvasActions,
  type CanvasContextValue,
  type CanvasIssues,
  type IssueSummary,
} from './canvas/context';
import {
  TRIGGER_OFFSET_X,
  botToFlow,
  cloneBubbles,
  createBlock,
  createBubble,
  flowToBot,
  isBubbleNode,
  pruneEdges,
  validateFlow,
  type FlowIssue,
} from './canvas/serialize';
import {
  HANDLE_IN,
  HANDLE_NEXT,
  NODE_WIDTH,
  PASTE_OFFSET,
  TRIGGER_NODE_ID,
  edgeIdFor,
  placementProblem,
  type Block,
  type BlockRef,
  type BubbleNode,
  type FlowEdge,
  type FlowHeader,
  type FlowNode,
  type StepType,
} from './canvas/types';

export { STEP_LABELS, TRIGGER_LABELS } from './canvas/types';

const FIELD_NAMES: Record<string, string> = {
  name: 'Nome',
  connection_id: 'Número',
  connection_ids: 'Números',
  trigger: 'Gatilho',
  steps: 'Passos',
  start_step_id: 'Primeiro passo',
  layout: 'Quadro',
};

/**
 * Camada do editor. Fica acima do app inteiro (sidebar z-20, cabeçalho z-40) e
 * logo ABAIXO das notificações do ToastContext (z-50), que precisam continuar
 * aparecendo por cima do editor ("Robô salvo", erros de validação). Os modais
 * internos (z-[9999]) vivem dentro deste contexto de empilhamento, portanto
 * também ficam abaixo dos toasts.
 */
const OVERLAY_CLASS =
  'fixed inset-0 z-[49] flex flex-col bg-slate-50 dark:bg-dark-bg text-slate-900 dark:text-white outline-none';

/**
 * Estilo da camada: para em cima da barra de navegação inferior do celular e
 * zera o deslocamento da sidebar que os modais usam (`--app-sidebar-width`),
 * já que aqui a camada cobre a sidebar e os modais devem centralizar na tela.
 */
const OVERLAY_STYLE = {
  bottom: 'var(--app-bottom-nav-height, 0px)',
  '--app-sidebar-width': '0px',
} as React.CSSProperties;

const NAME_INPUT_CLASS =
  'flex-1 min-w-[140px] max-w-md bg-transparent border border-transparent hover:border-slate-200 dark:hover:border-white/10 focus:border-purple-500 focus:bg-white dark:focus:bg-slate-800 rounded-lg px-2 py-1.5 text-base font-semibold text-slate-900 dark:text-white placeholder:font-normal placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-purple-500/20 transition-colors';

/** Mensagem em pt-BR para um problema do zod, pelo caminho do campo. */
function describeIssue(path: PropertyKey[], message: string): string {
  const root = String(path[0] ?? '');
  const label = FIELD_NAMES[root] ?? root;
  if (root === 'steps' && typeof path[1] === 'number') {
    const rest = path.slice(2).map(String).join('.');
    return `Passo ${path[1] + 1}${rest ? ` (${rest})` : ''}: ${message}`;
  }
  const rest = path.slice(1).map(String).join('.');
  return `${label}${rest ? ` (${rest})` : ''}: ${message}`;
}

/** Campo de texto em foco (Esc só tira o foco dele, em vez de fechar o editor). */
function isTextField(el: Element | null): el is HTMLElement {
  return (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement ||
    (el instanceof HTMLElement && el.isContentEditable)
  );
}

type PendingSave = { payload: BotInput; warnings: string[] };
type Clipboard = { nodes: BubbleNode[]; edges: FlowEdge[] };
type GraphState = { nodes: FlowNode[]; edges: FlowEdge[] };

/**
 * Esc na camada é tratado pelo próprio editor (listener na janela): o trap de
 * foco recebe um onEscape vazio só para não se desativar com a tecla.
 */
const keepTrapOnEscape = () => {};

/** Referência estável enquanto a lista de agentes não chega (evita re-renderizar os nós a cada tecla). */
const EMPTY_AGENTS: WaAgentListItem[] = [];

function bubbleById(nodes: FlowNode[], id: string): BubbleNode | undefined {
  const node = nodes.find((n) => n.id === id);
  return node && isBubbleNode(node) ? node : undefined;
}

function replaceBubble(nodes: FlowNode[], bubble: BubbleNode, blocks: Block[]): FlowNode[] {
  return nodes.map((n) => (n.id === bubble.id ? { ...bubble, data: { ...bubble.data, blocks } } : n));
}

/** Problemas de validação agrupados por balão e por bloco (marcação inline). */
function groupIssues(errors: FlowIssue[], warnings: FlowIssue[]): CanvasIssues {
  const byNode = new Map<string, IssueSummary>();
  const byBlock = new Map<string, IssueSummary>();
  const add = (map: Map<string, IssueSummary>, key: string, kind: 'errors' | 'warnings', message: string) => {
    const current = map.get(key) ?? { errors: [], warnings: [] };
    current[kind].push(message);
    map.set(key, current);
  };
  for (const issue of errors) {
    if (issue.nodeId) add(byNode, issue.nodeId, 'errors', issue.message);
    if (issue.blockId) add(byBlock, issue.blockId, 'errors', issue.message);
  }
  for (const issue of warnings) {
    if (issue.nodeId) add(byNode, issue.nodeId, 'warnings', issue.message);
    if (issue.blockId) add(byBlock, issue.blockId, 'warnings', issue.message);
  }
  return { byNode, byBlock };
}

/**
 * Números em que o robô atende. Ele é EXCLUSIVO deles: numa conversa de outro
 * número, iniciar este robô é recusado. Vários podem ser marcados.
 */
function BotConnectionsPicker({
  connections,
  selected,
  onChange,
}: {
  connections: WaAgentOptions['connections'];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const escolhidos = connections.filter((c) => selected.includes(c.id));
  const resumo =
    escolhidos.length === 0
      ? 'Números que atende...'
      : escolhidos.length === 1
        ? escolhidos[0].label
        : `${escolhidos.length} números`;

  const alternar = (id: string) => {
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  };

  return (
    <div className="relative">
      <button
        type="button"
        className={`${INPUT_CLASS} w-auto min-w-[160px] max-w-[260px] text-left truncate`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="true"
        title="Em quais números este robô pode agir"
      >
        {resumo}
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="absolute z-20 mt-1 w-72 max-h-64 overflow-y-auto rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 shadow-lg p-1">
            {connections.length === 0 ? (
              <p className="p-2 text-xs text-slate-500 dark:text-slate-400">Nenhum número conectado.</p>
            ) : (
              connections.map((c) => (
                <label
                  key={c.id}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-md text-sm cursor-pointer hover:bg-slate-100 dark:hover:bg-white/5"
                >
                  <input
                    type="checkbox"
                    className="accent-purple-600"
                    checked={selected.includes(c.id)}
                    onChange={() => alternar(c.id)}
                  />
                  <span className="flex-1 min-w-0 truncate text-slate-900 dark:text-white">{c.label}</span>
                  {c.status === 'connected' ? null : <Badge tone="amber">Desconectado</Badge>}
                </label>
              ))
            )}
            <p className="px-2 py-1 text-[11px] text-slate-500 dark:text-slate-400">
              O robô só age nas conversas destes números.
            </p>
          </div>
        </>
      ) : null}
    </div>
  );
}

const BotEditorInner: React.FC<{ bot: BotRow | null; onClose: () => void }> = ({ bot, onClose }) => {
  const { showToast } = useToast();
  const { darkMode } = useTheme();
  const optionsQ = useWaAgentOptions();
  const agentsQ = useWaAgentsList();
  const save = useSaveWaBot();
  const start = useStartWaBot();
  const flow = useReactFlow<FlowNode, FlowEdge>();

  const initial = useMemo(() => botToFlow(bot, DEFAULT_BOT_STEPS), [bot]);
  const [nodes, setNodes, handleNodeChanges] = useNodesState<FlowNode>(initial.nodes);
  const [edges, setEdges, handleEdgeChanges] = useEdgesState<FlowEdge>(initial.edges);
  // Robô novo nasce desligado (rascunho): ligar exige o gatilho ligado a um balão.
  const [header, setHeader] = useState<FlowHeader>({
    name: bot?.name ?? '',
    enabled: bot?.enabled ?? false,
    connection_ids: bot?.connection_ids?.length ? bot.connection_ids : bot?.connection_id ? [bot.connection_id] : [],
  });
  const [botId, setBotId] = useState<string | null>(bot?.id ?? null);
  const [dirty, setDirty] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [pending, setPending] = useState<PendingSave | null>(null);
  const [testOpen, setTestOpen] = useState(false);
  const [testPhone, setTestPhone] = useState('');
  const [selectedBlock, setSelectedBlock] = useState<BlockRef | null>(null);
  const [clipboard, setClipboard] = useState<Clipboard | null>(null);
  const [showMinimap, setShowMinimap] = useState(true);
  const [paletteCollapsed, setPaletteCollapsed] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  // Conta os balões adicionados pela paleta para não empilhar todos no mesmo ponto.
  const addedRef = useRef(0);
  // Último estado do quadro, para as ações lerem sem depender do ciclo de render.
  const graphRef = useRef<GraphState>({ nodes: initial.nodes, edges: initial.edges });
  const clipboardRef = useRef<Clipboard | null>(null);

  useEffect(() => {
    graphRef.current = { nodes, edges };
  }, [nodes, edges]);
  useEffect(() => {
    clipboardRef.current = clipboard;
  }, [clipboard]);

  const options = optionsQ.data;
  const connections = options?.connections ?? [];
  const agents = agentsQ.data ?? EMPTY_AGENTS;

  // Enquanto a camada está aberta, a página de trás não rola (o quadro cuida da própria rolagem).
  useEffect(() => {
    const { body } = document;
    const previous = body.style.overflow;
    body.style.overflow = 'hidden';
    return () => {
      body.style.overflow = previous;
    };
  }, []);

  // Foco inicial: robô novo começa pelo nome; robô existente foca a camada (leitores de tela).
  useEffect(() => {
    if (bot) rootRef.current?.focus();
    else nameRef.current?.focus();
  }, [bot]);

  const anyModalOpen = confirmLeave || pending !== null || testOpen;

  const handleCancel = useCallback(() => {
    if (dirty) setConfirmLeave(true);
    else onClose();
  }, [dirty, onClose]);

  // Esc: com um modal aberto, o próprio modal trata; num campo de texto só tira o foco;
  // com o painel do bloco aberto, fecha o painel; fora disso pergunta antes de sair
  // (com alterações) ou fecha direto.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || anyModalOpen || e.defaultPrevented) return;
      const active = document.activeElement;
      if (isTextField(active)) {
        active.blur();
        return;
      }
      e.preventDefault();
      if (selectedBlock) {
        setSelectedBlock(null);
        return;
      }
      handleCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [anyModalOpen, handleCancel, selectedBlock]);

  const patchHeader = (patch: Partial<FlowHeader>) => {
    setHeader((prev) => ({ ...prev, ...patch }));
    setDirty(true);
  };

  const onNodesChange = useCallback(
    (changes: NodeChange<FlowNode>[]) => {
      if (changes.some((c) => c.type !== 'select' && c.type !== 'dimensions')) setDirty(true);
      handleNodeChanges(changes);
    },
    [handleNodeChanges]
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange<FlowEdge>[]) => {
      if (changes.some((c) => c.type !== 'select')) setDirty(true);
      handleEdgeChanges(changes);
    },
    [handleEdgeChanges]
  );

  // Uma aresta por handle de saída: ligar de novo substitui a anterior.
  const onConnect = useCallback(
    (c: Connection) => {
      const sourceHandle = c.sourceHandle;
      if (!sourceHandle || c.source === c.target) return;
      setEdges((eds) => [
        ...eds.filter((e) => !(e.source === c.source && e.sourceHandle === sourceHandle)),
        {
          id: edgeIdFor(c.source, sourceHandle),
          source: c.source,
          sourceHandle,
          target: c.target,
          targetHandle: c.targetHandle ?? HANDLE_IN,
        },
      ]);
      setDirty(true);
    },
    [setEdges]
  );

  /**
   * Aplica uma mudança no quadro a partir do último estado. Depois da mudança,
   * as arestas que perderam a origem, o destino ou a saída são descartadas.
   * `fn` devolve null para não mudar nada.
   */
  const mutateGraph = useCallback(
    (fn: (nodes: FlowNode[], edges: FlowEdge[]) => GraphState | null) => {
      const current = graphRef.current;
      const result = fn(current.nodes, current.edges);
      if (!result) return;
      const nextEdges = pruneEdges(result.nodes, result.edges);
      graphRef.current = { nodes: result.nodes, edges: nextEdges };
      setNodes(result.nodes);
      setEdges(nextEdges);
      setDirty(true);
    },
    [setEdges, setNodes]
  );

  /** Posição perto do centro da área visível, com um pequeno deslocamento a cada adição. */
  const viewportCenter = useCallback((): XYPosition => {
    const jitter = (addedRef.current % 6) * 24;
    addedRef.current += 1;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: jitter, y: jitter };
    const center = flow.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    return { x: Math.round(center.x - NODE_WIDTH / 2 + jitter), y: Math.round(center.y - 40 + jitter) };
  }, [flow]);

  /**
   * Bloco vindo da paleta. Clique (sem posição) com um único balão selecionado:
   * entra no fim dele, se couber. Senão vira um balão novo: na posição do
   * drop, à direita do gatilho (primeiro balão, que já sai ligado a ele) ou
   * perto do centro da tela.
   */
  const addStep = useCallback(
    (type: StepType, position?: XYPosition) => {
      mutateGraph((nodes, edges) => {
        const bubbles = nodes.filter(isBubbleNode);
        const selected = bubbles.filter((n) => n.selected);
        if (!position && selected.length === 1) {
          const bubble = selected[0];
          const problem = placementProblem(bubble.data.blocks.map((b) => b.type), type, bubble.data.blocks.length);
          if (!problem) {
            const block = createBlock(type);
            setSelectedBlock({ bubbleId: bubble.id, blockId: block.id });
            return { nodes: replaceBubble(nodes, bubble, [...bubble.data.blocks, block]), edges };
          }
          showToast(`${problem} Criando um balão novo.`, 'info');
        }
        const block = createBlock(type);
        const trigger = nodes.find((n) => n.id === TRIGGER_NODE_ID);
        const first = bubbles.length === 0;
        const at =
          position ??
          (first && trigger ? { x: trigger.position.x + TRIGGER_OFFSET_X, y: trigger.position.y } : viewportCenter());
        const bubble = createBubble([block], at, `Balão ${bubbles.length + 1}`);
        bubble.selected = true;
        setSelectedBlock({ bubbleId: bubble.id, blockId: block.id });
        const nextEdges = [...edges];
        // Primeiro balão do quadro: já sai ligado ao gatilho.
        if (first && !edges.some((e) => e.source === TRIGGER_NODE_ID)) {
          nextEdges.push({
            id: edgeIdFor(TRIGGER_NODE_ID, HANDLE_NEXT),
            source: TRIGGER_NODE_ID,
            sourceHandle: HANDLE_NEXT,
            target: bubble.id,
            targetHandle: HANDLE_IN,
          });
        }
        return { nodes: [...nodes.map((n) => (n.selected ? { ...n, selected: false } : n)), bubble], edges: nextEdges };
      });
    },
    [mutateGraph, showToast, viewportCenter]
  );

  const addBlock = useCallback(
    (bubbleId: string, type: StepType, index?: number) => {
      mutateGraph((nodes, edges) => {
        const bubble = bubbleById(nodes, bubbleId);
        if (!bubble) return null;
        const blocks = bubble.data.blocks;
        const at = index === undefined ? blocks.length : Math.max(0, Math.min(blocks.length, index));
        const problem = placementProblem(blocks.map((b) => b.type), type, at);
        if (problem) {
          showToast(problem, 'warning');
          return null;
        }
        const block = createBlock(type);
        setSelectedBlock({ bubbleId, blockId: block.id });
        const withBlock = replaceBubble(nodes, bubble, [...blocks.slice(0, at), block, ...blocks.slice(at)]);
        return { nodes: withBlock.map((n) => (n.selected !== (n.id === bubbleId) ? { ...n, selected: n.id === bubbleId } : n)), edges };
      });
    },
    [mutateGraph, showToast]
  );

  const moveBlock = useCallback(
    (from: BlockRef, toBubbleId: string, rawIndex: number) => {
      mutateGraph((nodes, edges) => {
        const source = bubbleById(nodes, from.bubbleId);
        const target = bubbleById(nodes, toBubbleId);
        if (!source || !target) return null;
        const fromIndex = source.data.blocks.findIndex((b) => b.id === from.blockId);
        if (fromIndex < 0) return null;
        const block = source.data.blocks[fromIndex];
        const same = source.id === target.id;
        const sourceBlocks = source.data.blocks.filter((_, i) => i !== fromIndex);
        // No mesmo balão, o índice foi contado com o bloco ainda na lista: depois de tirá-lo, o que vinha depois anda uma casa.
        const base = same ? sourceBlocks : target.data.blocks;
        const index = Math.max(0, Math.min(base.length, same && rawIndex > fromIndex ? rawIndex - 1 : rawIndex));
        if (same && index === fromIndex) return null;
        const problem = placementProblem(base.map((b) => b.type), block.type, index);
        if (problem) {
          showToast(problem, 'warning');
          return null;
        }
        const targetBlocks = [...base.slice(0, index), block, ...base.slice(index)];
        let next = nodes.map((n) => {
          if (n.id === target.id) return { ...target, data: { ...target.data, blocks: targetBlocks } };
          if (n.id === source.id) return { ...source, data: { ...source.data, blocks: sourceBlocks } };
          return n;
        });
        // Balão de origem que ficou vazio some (com as ligações dele).
        if (!same && sourceBlocks.length === 0) next = next.filter((n) => n.id !== source.id);
        setSelectedBlock({ bubbleId: target.id, blockId: block.id });
        return { nodes: next, edges };
      });
    },
    [mutateGraph, showToast]
  );

  const removeBlock = useCallback(
    (ref: BlockRef) => {
      mutateGraph((nodes, edges) => {
        const bubble = bubbleById(nodes, ref.bubbleId);
        if (!bubble) return null;
        const blocks = bubble.data.blocks.filter((b) => b.id !== ref.blockId);
        if (blocks.length === bubble.data.blocks.length) return null;
        setSelectedBlock((prev) => (prev?.blockId === ref.blockId ? null : prev));
        // Balão sem blocos some (com as ligações dele).
        if (blocks.length === 0) return { nodes: nodes.filter((n) => n.id !== bubble.id), edges };
        return { nodes: replaceBubble(nodes, bubble, blocks), edges };
      });
    },
    [mutateGraph]
  );

  const updateBlock = useCallback(
    (bubbleId: string, block: Block) => {
      mutateGraph((nodes, edges) => {
        const bubble = bubbleById(nodes, bubbleId);
        if (!bubble) return null;
        return { nodes: replaceBubble(nodes, bubble, bubble.data.blocks.map((b) => (b.id === block.id ? block : b))), edges };
      });
    },
    [mutateGraph]
  );

  const renameBubble = useCallback(
    (bubbleId: string, name: string) => {
      mutateGraph((nodes, edges) => {
        const bubble = bubbleById(nodes, bubbleId);
        if (!bubble || bubble.data.name === name) return null;
        return { nodes: nodes.map((n) => (n.id === bubbleId ? { ...bubble, data: { ...bubble.data, name } } : n)), edges };
      });
    },
    [mutateGraph]
  );

  const deleteBubbles = useCallback(
    (ids: string[]) => {
      const list = ids.filter((id) => id !== TRIGGER_NODE_ID);
      if (list.length === 0) return;
      setSelectedBlock((prev) => (prev && list.includes(prev.bubbleId) ? null : prev));
      void flow.deleteElements({ nodes: list.map((id) => ({ id })) });
    },
    [flow]
  );

  /** Balões selecionados no quadro (o gatilho nunca entra). */
  const selectedBubbleIds = useCallback(
    (): string[] => graphRef.current.nodes.filter((n) => isBubbleNode(n) && n.selected).map((n) => n.id),
    []
  );

  const copyBubbles = useCallback(
    (ids: string[]) => {
      const { nodes, edges } = graphRef.current;
      const bubbles = nodes.filter((n): n is BubbleNode => isBubbleNode(n) && ids.includes(n.id));
      if (bubbles.length === 0) return;
      const set = new Set(bubbles.map((b) => b.id));
      setClipboard({
        nodes: bubbles.map((b) => ({ ...b, selected: false })),
        edges: edges.filter((e) => set.has(e.source) && set.has(e.target)),
      });
      showToast(bubbles.length === 1 ? '1 balão copiado' : `${bubbles.length} balões copiados`, 'info');
    },
    [showToast]
  );

  /** Cola cópias (ids novos, deslocadas) já selecionadas; as próximas colagens caem um pouco mais adiante. */
  const pasteClones = useCallback(
    (source: Clipboard, verb: 'colado' | 'duplicado') => {
      const cloned = cloneBubbles(source.nodes, source.edges, { x: PASTE_OFFSET, y: PASTE_OFFSET });
      if (cloned.nodes.length === 0) return;
      mutateGraph((nodes, edges) => ({
        nodes: [...nodes.map((n) => (n.selected ? { ...n, selected: false } : n)), ...cloned.nodes],
        edges: [...edges, ...cloned.edges],
      }));
      setSelectedBlock(null);
      const n = cloned.nodes.length;
      showToast(n === 1 ? `Balão ${verb}` : `${n} balões ${verb}s`, 'success');
      return cloned;
    },
    [mutateGraph, showToast]
  );

  const paste = useCallback(() => {
    const clip = clipboardRef.current;
    if (!clip) return;
    const cloned = pasteClones(clip, 'colado');
    if (cloned) setClipboard({ nodes: cloned.nodes.map((n) => ({ ...n, selected: false })), edges: cloned.edges });
  }, [pasteClones]);

  const duplicateBubbles = useCallback(
    (ids: string[]) => {
      const { nodes, edges } = graphRef.current;
      const bubbles = nodes.filter((n): n is BubbleNode => isBubbleNode(n) && ids.includes(n.id));
      if (bubbles.length === 0) return;
      const set = new Set(bubbles.map((b) => b.id));
      pasteClones({ nodes: bubbles, edges: edges.filter((e) => set.has(e.source) && set.has(e.target)) }, 'duplicado');
    },
    [pasteClones]
  );

  // Atalhos do quadro: Ctrl/Cmd + C, V, D (Delete/Backspace é do próprio React Flow).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (anyModalOpen || e.altKey || !(e.ctrlKey || e.metaKey)) return;
      if (isTextField(document.activeElement)) return;
      const key = e.key.toLowerCase();
      if (key === 'c') {
        const ids = selectedBubbleIds();
        if (ids.length === 0) return;
        e.preventDefault();
        copyBubbles(ids);
      } else if (key === 'v') {
        if (!clipboardRef.current) return;
        e.preventDefault();
        paste();
      } else if (key === 'd') {
        const ids = selectedBubbleIds();
        if (ids.length === 0) return;
        e.preventDefault();
        duplicateBubbles(ids);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [anyModalOpen, copyBubbles, duplicateBubbles, paste, selectedBubbleIds]);

  const selectBlock = useCallback((ref: BlockRef | null) => setSelectedBlock(ref), []);

  const actions = useMemo<CanvasActions>(
    () => ({ selectBlock, addBlock, moveBlock, removeBlock, renameBubble, duplicateBubbles, copyBubbles, deleteBubbles }),
    [selectBlock, addBlock, moveBlock, removeBlock, renameBubble, duplicateBubbles, copyBubbles, deleteBubbles]
  );

  // Validação a cada mudança: marca balões e blocos com problema no próprio quadro.
  const validation = useMemo(() => validateFlow(nodes, edges, header), [nodes, edges, header]);
  const issues = useMemo(() => groupIssues(validation.errors, validation.warnings), [validation]);
  const connected = useMemo(
    () => new Set(edges.filter((e) => e.sourceHandle).map((e) => edgeIdFor(e.source, e.sourceHandle as string))),
    [edges]
  );

  const ctx = useMemo<CanvasContextValue>(
    () => ({ options, agents, actions, selectedBlock, issues, connected }),
    [options, agents, actions, selectedBlock, issues, connected]
  );

  // Bloco apontado no painel (some se o balão ou o bloco deixarem de existir).
  const panelTarget = useMemo(() => {
    if (!selectedBlock) return null;
    const bubble = bubbleById(nodes, selectedBlock.bubbleId);
    if (!bubble) return null;
    const index = bubble.data.blocks.findIndex((b) => b.id === selectedBlock.blockId);
    if (index < 0) return null;
    return { bubble, block: bubble.data.blocks[index], index };
  }, [nodes, selectedBlock]);

  useEffect(() => {
    if (selectedBlock && !panelTarget) setSelectedBlock(null);
  }, [selectedBlock, panelTarget]);

  /** Seleciona e enquadra um balão (e aponta o bloco), usado para mostrar o problema de validação. */
  const focusNode = useCallback(
    (id: string, blockId?: string) => {
      setNodes((nds) => nds.map((n) => ({ ...n, selected: n.id === id })));
      if (blockId) setSelectedBlock({ bubbleId: id, blockId });
      void flow.fitView({ nodes: [{ id }], duration: 400, maxZoom: 1, padding: 0.4 });
    },
    [flow, setNodes]
  );

  const persist = async (payload: BotInput) => {
    try {
      const saved = await save.mutateAsync({ id: botId, input: payload });
      setBotId(saved.id);
      setDirty(false);
      showToast(botId ? 'Robô salvo' : 'Robô criado', 'success');
    } catch (err) {
      showToast(errorMessage(err, 'Falha ao salvar o robô'), 'error');
    }
  };

  const handleSave = () => {
    const { errors, warnings } = validateFlow(nodes, edges, header);
    if (errors.length > 0) {
      const first = errors[0];
      showToast(errors.length > 1 ? `${first.message} (+${errors.length - 1})` : first.message, 'error');
      if (first.nodeId) focusNode(first.nodeId, first.blockId);
      return;
    }
    const parsed = BotInputSchema.safeParse(flowToBot(nodes, edges, header));
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      showToast(issue ? describeIssue(issue.path, describeZodIssue(issue)) : 'Dados inválidos', 'error');
      return;
    }
    if (warnings.length > 0) {
      setPending({ payload: parsed.data, warnings: warnings.map((w) => w.message) });
      if (warnings[0].nodeId) focusNode(warnings[0].nodeId);
      return;
    }
    void persist(parsed.data);
  };

  const openTest = () => {
    if (!botId) {
      showToast('Salve o robô antes de testar', 'info');
      return;
    }
    if (dirty) {
      showToast('Salve as alterações antes de testar', 'info');
      return;
    }
    setTestPhone('');
    setTestOpen(true);
  };

  const handleStart = async () => {
    if (!botId) return;
    const phone = testPhone.trim();
    if (!phone) {
      showToast('Informe o telefone com DDD', 'error');
      return;
    }
    try {
      const result = await start.mutateAsync({ id: botId, phone });
      if (result.ok === false) throw new Error(result.error || 'Falha ao iniciar o robô');
      showToast('Robô iniciado. Acompanhe em Execuções.', 'success');
      setTestOpen(false);
      setTestPhone('');
    } catch (err) {
      showToast(errorMessage(err, 'Falha ao iniciar o robô'), 'error');
    }
  };

  const connectionLabel =
    header.connection_ids.length === 1
      ? (connections.find((c) => c.id === header.connection_ids[0])?.label ?? 'número escolhido')
      : `${header.connection_ids.length} números`;
  const empty = !nodes.some(isBubbleNode);

  // Só existe no navegador (a lista carrega este componente sem SSR).
  if (typeof document === 'undefined') return null;

  // Camada modal: o foco por teclado fica preso nela (a lista de robôs continua
  // montada embaixo, invisível). Cliques fora (ex.: fechar uma notificação) seguem valendo.
  return createPortal(
    <CanvasContext.Provider value={ctx}>
      <FocusTrap active initialFocus={false} onEscape={keepTrapOnEscape} allowOutsideClick>
        <div
          ref={rootRef}
          role="dialog"
          aria-modal="true"
          aria-label={`Editor do robô ${header.name || 'novo'}`}
          tabIndex={-1}
          className={OVERLAY_CLASS}
          style={OVERLAY_STYLE}
        >
          <header className="shrink-0 flex flex-wrap items-center gap-2 px-3 py-2 min-h-14 border-b border-slate-200 dark:border-white/10 bg-white dark:bg-dark-card shadow-sm">
            <button
              type="button"
              className={BTN_ICON}
              onClick={handleCancel}
              aria-label="Voltar para a lista de robôs"
              title="Voltar (Esc)"
            >
              <ArrowLeft size={18} aria-hidden="true" />
            </button>
            <input
              ref={nameRef}
              id="bot-name"
              className={NAME_INPUT_CLASS}
              value={header.name}
              onChange={(e) => patchHeader({ name: e.target.value })}
              maxLength={120}
              placeholder="Nome do robô"
              aria-label="Nome do robô"
            />
            <div
              className="flex items-center gap-2 pl-1"
              title={header.enabled ? 'O robô dispara pelo gatilho' : 'Desligado: fica salvo como rascunho e não dispara'}
            >
              <span className="text-sm text-slate-600 dark:text-slate-300">{header.enabled ? 'Ligado' : 'Desligado'}</span>
              <Toggle checked={header.enabled} onChange={(enabled) => patchHeader({ enabled })} label="Robô ligado" />
            </div>
            <BotConnectionsPicker
              connections={connections}
              selected={header.connection_ids}
              onChange={(connection_ids) => patchHeader({ connection_ids })}
            />
            <div className="flex items-center gap-2 ml-auto">
              {dirty ? (
                <span className="hidden sm:inline text-xs font-medium text-amber-600 dark:text-amber-400">Não salvo</span>
              ) : null}
              <button type="button" className={BTN_SECONDARY} onClick={openTest} disabled={save.isPending}>
                <Play size={16} aria-hidden="true" />
                Testar
              </button>
              <button type="button" className={BTN_PRIMARY} onClick={handleSave} disabled={save.isPending}>
                {save.isPending ? (
                  <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                ) : (
                  <Save size={16} aria-hidden="true" />
                )}
                Salvar
              </button>
            </div>
          </header>

          {optionsQ.error ? (
            <div className="shrink-0 px-3 pt-3">
              <Notice tone="red">{errorMessage(optionsQ.error, 'Falha ao carregar as opções')}</Notice>
            </div>
          ) : null}

          <div className="relative flex-1 min-h-0 flex md:flex-row">
            <div ref={canvasRef} className="relative flex-1 min-h-0">
              <Palette
                onAdd={(type) => addStep(type)}
                collapsed={paletteCollapsed}
                onToggle={() => setPaletteCollapsed((v) => !v)}
              />
              <BotCanvas
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onDropStep={addStep}
                onPaneClick={() => setSelectedBlock(null)}
                empty={empty}
                onQuickStart={() => addStep('send_text')}
                showMinimap={showMinimap}
                onToggleMinimap={() => setShowMinimap((v) => !v)}
                darkMode={darkMode}
              />
            </div>
            {panelTarget ? (
              <BlockPanel
                bubble={panelTarget.bubble}
                block={panelTarget.block}
                index={panelTarget.index}
                update={(block) => updateBlock(panelTarget.bubble.id, block)}
                onClose={() => setSelectedBlock(null)}
                onRemove={() => removeBlock({ bubbleId: panelTarget.bubble.id, blockId: panelTarget.block.id })}
              />
            ) : null}
          </div>

          <ConfirmModal
            isOpen={confirmLeave}
            onClose={() => setConfirmLeave(false)}
            onConfirm={() => {
              setConfirmLeave(false);
              onClose();
            }}
            title="Descartar alterações"
            message="Há alterações não salvas neste robô. Sair sem salvar?"
            confirmText="Sair sem salvar"
            variant="danger"
          />

          <ConfirmModal
            isOpen={!!pending}
            onClose={() => setPending(null)}
            onConfirm={() => {
              const p = pending;
              setPending(null);
              if (p) void persist(p.payload);
            }}
            title="Salvar mesmo assim?"
            message={
              <ul className="list-disc pl-5 space-y-1">
                {(pending?.warnings ?? []).map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            }
            confirmText="Salvar mesmo assim"
            variant="primary"
          />

          <Modal
            isOpen={testOpen}
            onClose={() => setTestOpen(false)}
            title={`Testar: ${header.name || 'robô'}`}
            size="md"
            initialFocus="#bot-test-phone"
          >
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                void handleStart();
              }}
            >
              <p className="text-sm text-slate-600 dark:text-slate-300">
                O robô vai enviar as mensagens de verdade para este telefone pelo número <strong>{connectionLabel}</strong>.
                Use um número seu para testar.
              </p>
              <Field label="Telefone com DDD" htmlFor="bot-test-phone" help="Ex.: (11) 99999-9999 ou +5511999999999">
                <input
                  id="bot-test-phone"
                  type="tel"
                  className={INPUT_CLASS}
                  value={testPhone}
                  onChange={(e) => setTestPhone(e.target.value)}
                  placeholder="+55 11 99999-9999"
                  autoComplete="off"
                />
              </Field>
              <div className="flex justify-end gap-2">
                <button type="button" className={BTN_SECONDARY} onClick={() => setTestOpen(false)} disabled={start.isPending}>
                  Cancelar
                </button>
                <button type="submit" className={BTN_PRIMARY} disabled={start.isPending || !testPhone.trim()}>
                  {start.isPending ? (
                    <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                  ) : (
                    <Play size={16} aria-hidden="true" />
                  )}
                  Iniciar robô
                </button>
              </div>
            </form>
          </Modal>
        </div>
      </FocusTrap>
    </CanvasContext.Provider>,
    document.body
  );
};

/**
 * Componente React `BotEditor`: camada de tela cheia com o quadro do robô.
 * Renderiza num portal em document.body, por isso pode ficar montado ao lado da
 * lista de robôs (a lista continua embaixo e reaparece ao fechar).
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export const BotEditor: React.FC<{ bot: BotRow | null; onClose: () => void }> = ({ bot, onClose }) => (
  <ReactFlowProvider>
    <BotEditorInner bot={bot} onClose={onClose} />
  </ReactFlowProvider>
);

export default BotEditor;
