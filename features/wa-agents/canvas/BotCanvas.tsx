'use client';

/**
 * Área do quadro: React Flow com os nós do robô (gatilho e balões), fundo
 * pontilhado, controles de zoom/ajustar à tela, minimapa opcional, atalhos
 * ("?") e estado vazio. Recebe o estado (nós/arestas) do editor e devolve as
 * mudanças. Ocupa todo o contêiner pai (o editor em tela cheia é a moldura).
 * Precisa estar dentro de um ReactFlowProvider.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  ConnectionLineType,
  Controls,
  MarkerType,
  MiniMap,
  Panel,
  ReactFlow,
  useReactFlow,
  useStoreApi,
  type Connection,
  type DefaultEdgeOptions,
  type Edge,
  type OnBeforeDelete,
  type OnEdgesChange,
  type OnNodesChange,
  type XYPosition,
} from '@xyflow/react';
import { CircleHelp, Map as MapIcon, Maximize, Plus } from 'lucide-react';
import { edgeTypes } from './edges';
import { minimapColor, nodeTypes } from './nodes';
import { DND_BLOCK_MIME, DND_MIME, NODE_WIDTH, TRIGGER_NODE_ID, isStepType, type BlockRef, type FlowEdge, type FlowNode, type StepType } from './types';
import { endDragSession } from './dragSession';

export type BotCanvasProps = {
  nodes: FlowNode[];
  edges: FlowEdge[];
  onNodesChange: OnNodesChange<FlowNode>;
  onEdgesChange: OnEdgesChange<FlowEdge>;
  onConnect: (connection: Connection) => void;
  /** Bloco solto no quadro vazio pela paleta (posição já em coordenadas do quadro): vira um balão novo. */
  onDropStep: (type: StepType, position: XYPosition) => void;
  /** Bloco existente solto no fundo do quadro: vira um balão novo */
  onDropBlock: (from: BlockRef, position: XYPosition) => void;
  /** Clique no fundo do quadro (fecha o painel do bloco). */
  onPaneClick: () => void;
  /** Quadro sem balões: mostra o estado vazio com o botão de começar. */
  empty: boolean;
  onQuickStart: () => void;
  showMinimap: boolean;
  onToggleMinimap: () => void;
  darkMode: boolean;
};

const DEFAULT_EDGE_OPTIONS: DefaultEdgeOptions = {
  type: 'default',
  markerEnd: { type: MarkerType.ArrowClosed, width: 20, height: 20 },
};
const FIT_VIEW_OPTIONS = { padding: 0.2, maxZoom: 1 };
const DELETE_KEYS = ['Backspace', 'Delete'];
/** Shift+clique (além de Ctrl/Cmd) soma à seleção; Shift+arrastar no fundo desenha a caixa de seleção. */
const MULTI_SELECT_KEYS = ['Shift', 'Meta', 'Control'];
const SNAP_GRID: [number, number] = [10, 10];
const CANVAS_STYLE: React.CSSProperties = { position: 'absolute', inset: 0, width: '100%', height: '100%' };
/** Referência estável: o minimapa não precisa recalcular a cada render do quadro. */
const minimapNodeColor = (node: FlowNode): string => minimapColor(node);

const TOOL_BTN =
  'p-1.5 rounded-md text-slate-500 hover:text-slate-800 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-white dark:hover:bg-white/10 transition-colors';

const SHORTCUTS: Array<[string, string]> = [
  ['Clique no bloco', 'abre as propriedades'],
  ['Duplo clique no título', 'renomeia o balão'],
  ['Shift + arrastar no fundo', 'seleciona vários balões'],
  ['Shift + clique', 'soma à seleção'],
  ['Ctrl/Cmd + C', 'copia os balões selecionados'],
  ['Ctrl/Cmd + V', 'cola (com deslocamento)'],
  ['Ctrl/Cmd + D', 'duplica os balões selecionados'],
  ['Delete / Backspace', 'exclui a seleção'],
  ['× no meio da seta', 'desconecta os balões (nenhum é excluído)'],
  ['Clique na seta + Delete', 'também desconecta'],
  ['Roda do mouse', 'move o quadro'],
  ['Ctrl/Cmd + roda', 'zoom'],
  ['Esc', 'fecha o painel / sai do editor'],
];

export function BotCanvas({
  nodes,
  edges,
  onNodesChange,
  onEdgesChange,
  onConnect,
  onDropStep,
  onDropBlock,
  onPaneClick,
  empty,
  onQuickStart,
  showMinimap,
  onToggleMinimap,
  darkMode,
}: BotCanvasProps) {
  const { screenToFlowPosition, fitView } = useReactFlow<FlowNode, FlowEdge>();
  const store = useStoreApi();
  const [helpOpen, setHelpOpen] = useState(false);

  /**
   * Shift + arrastar = caixa de seleção. A tecla é acompanhada AQUI (e não pelo
   * `selectionKeyCode` do React Flow) porque a biblioteca ignora o Shift quando
   * o foco está num campo de texto: com o painel de um bloco aberto, o arrasto
   * movia o quadro em vez de selecionar, e o navegador ainda estendia a seleção
   * de texto da página até o ponto clicado.
   */
  const [shiftDown, setShiftDown] = useState(false);
  const cancelBoxSelection = useCallback(() => {
    const { userSelectionRect, userSelectionActive, resetSelectedElements } = store.getState();
    if (!userSelectionRect && !userSelectionActive) return false;
    resetSelectedElements();
    store.setState({ userSelectionActive: false, userSelectionRect: null, nodesSelectionActive: false });
    return true;
  }, [store]);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') setShiftDown(true);
      // Esc cancela a caixa em andamento (e não fecha o editor nesse caso)
      if (e.key === 'Escape' && cancelBoxSelection()) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') setShiftDown(false);
    };
    // Janela perdeu o foco (Alt+Tab) no meio do arrasto: sem isto a caixa ficava presa na tela
    const onBlur = () => {
      setShiftDown(false);
      cancelBoxSelection();
    };
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('blur', onBlur);
    };
  }, [cancelBoxSelection]);

  // Shift + clique no quadro: tira o foco do campo de texto e impede o navegador de
  // estender a seleção de texto da página (os eventos de ponteiro seguem normalmente)
  const onMouseDownCapture = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!event.shiftKey || event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest('input, textarea, select, [contenteditable="true"]')) return;
    event.preventDefault();
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body && active.matches('input, textarea, select')) active.blur();
    window.getSelection()?.removeAllRanges();
    if (!shiftDown) setShiftDown(true);
  }, [shiftDown]);
  const helpRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!helpOpen) return;
    const onDown = (e: MouseEvent) => {
      if (helpRef.current && !helpRef.current.contains(e.target as Node)) setHelpOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [helpOpen]);

  const onDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    const types = event.dataTransfer.types;
    if (!types.includes(DND_MIME) && !types.includes(DND_BLOCK_MIME)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = types.includes(DND_BLOCK_MIME) ? 'move' : 'copy';
  }, []);

  // Solto no fundo do quadro (os balões tratam o próprio drop e param a propagação).
  const onDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      endDragSession();
      const point = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      const position = { x: Math.round(point.x - NODE_WIDTH / 2), y: Math.round(point.y - 20) };
      const raw = event.dataTransfer.getData(DND_BLOCK_MIME);
      if (raw) {
        event.preventDefault();
        try {
          const from = JSON.parse(raw) as BlockRef;
          if (from && typeof from.bubbleId === 'string' && typeof from.blockId === 'string') onDropBlock(from, position);
        } catch {
          // conteúdo inesperado no arrasto: ignora
        }
        return;
      }
      const type = event.dataTransfer.getData(DND_MIME);
      if (!isStepType(type)) return;
      event.preventDefault();
      onDropStep(type, position);
    },
    [onDropBlock, onDropStep, screenToFlowPosition]
  );

  // O gatilho nunca é apagado, nem em seleção múltipla.
  const onBeforeDelete = useCallback<OnBeforeDelete<FlowNode, FlowEdge>>(
    async ({ nodes: toDelete, edges: edgesToDelete }) => ({
      nodes: toDelete.filter((n) => n.id !== TRIGGER_NODE_ID),
      edges: edgesToDelete,
    }),
    []
  );

  const isValidConnection = useCallback(
    (c: Edge | Connection) => c.source !== c.target && c.target !== TRIGGER_NODE_ID,
    []
  );

  return (
    <ReactFlow<FlowNode, FlowEdge>
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      onPaneClick={onPaneClick}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      colorMode={darkMode ? 'dark' : 'light'}
      className="wa-bot-canvas"
      style={CANVAS_STYLE}
      fitView
      fitViewOptions={FIT_VIEW_OPTIONS}
      minZoom={0.2}
      maxZoom={1.75}
      deleteKeyCode={DELETE_KEYS}
      multiSelectionKeyCode={MULTI_SELECT_KEYS}
      // Caixa de seleção controlada pelo Shift acompanhado acima: só começa no FUNDO do
      // quadro (em cima de um balão o Shift soma à seleção ou arrasta o grupo) e, enquanto
      // o Shift está apertado, arrastar o fundo não move o quadro
      selectionKeyCode={null}
      selectionOnDrag={shiftDown}
      panOnDrag={!shiftDown}
      onMouseDownCapture={onMouseDownCapture}
      onBeforeDelete={onBeforeDelete}
      isValidConnection={isValidConnection}
      defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
      connectionLineType={ConnectionLineType.Bezier}
      connectionRadius={28}
      snapToGrid
      snapGrid={SNAP_GRID}
      zoomOnDoubleClick={false}
      // A roda do mouse move o quadro (como rolar a página); zoom só com Ctrl + roda ou pinça.
      panOnScroll
      zoomOnScroll
      zoomActivationKeyCode="Control"
      nodeDragThreshold={2}
      onDragOver={onDragOver}
      onDrop={onDrop}
      aria-label="Quadro do robô"
    >
      <Background variant={BackgroundVariant.Dots} gap={20} size={1.5} />
      <Controls showInteractive={false} aria-label="Controles do quadro" />
      {showMinimap ? (
        <MiniMap pannable zoomable nodeColor={minimapNodeColor} nodeStrokeWidth={0} ariaLabel="Mapa do quadro" />
      ) : null}

      <Panel position="top-right" className="flex items-center gap-0.5 p-1 rounded-lg bg-white/95 dark:bg-dark-card/95 backdrop-blur border border-slate-200 dark:border-white/10 shadow">
        <button
          type="button"
          className={TOOL_BTN}
          onClick={() => void fitView({ padding: 0.2, maxZoom: 1, duration: 300 })}
          aria-label="Ajustar o quadro à tela"
          title="Ajustar à tela"
        >
          <Maximize size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={`${TOOL_BTN} hidden md:inline-flex ${showMinimap ? 'text-primary-600 dark:text-primary-300' : ''}`}
          onClick={onToggleMinimap}
          aria-pressed={showMinimap}
          aria-label={showMinimap ? 'Esconder o minimapa' : 'Mostrar o minimapa'}
          title={showMinimap ? 'Esconder o minimapa' : 'Mostrar o minimapa'}
        >
          <MapIcon size={16} aria-hidden="true" />
        </button>
        <div ref={helpRef} className="relative">
          <button
            type="button"
            className={`${TOOL_BTN} ${helpOpen ? 'text-primary-600 dark:text-primary-300' : ''}`}
            onClick={() => setHelpOpen((v) => !v)}
            aria-expanded={helpOpen}
            aria-label="Atalhos e dicas"
            title="Atalhos e dicas"
          >
            <CircleHelp size={16} aria-hidden="true" />
          </button>
          {helpOpen ? (
            <div className="absolute right-0 top-full mt-1 w-72 max-w-[calc(100vw-2rem)] p-3 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-800 shadow-lg text-xs text-slate-700 dark:text-slate-200">
              <p className="font-semibold mb-2">Atalhos</p>
              <dl className="space-y-1">
                {SHORTCUTS.map(([keys, what]) => (
                  <div key={keys} className="flex gap-2">
                    <dt className="shrink-0 w-32 font-mono text-[11px] text-slate-500 dark:text-slate-400">{keys}</dt>
                    <dd>{what}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}
        </div>
      </Panel>

      {empty ? (
        <Panel position="top-center" className="pointer-events-none mt-3">
          <div className="pointer-events-auto max-w-xs px-4 py-3 rounded-xl border border-dashed border-primary-300 dark:border-primary-500/50 bg-white/95 dark:bg-dark-card/95 backdrop-blur shadow text-center">
            <p className="text-sm font-medium text-slate-800 dark:text-white">O quadro está vazio</p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Arraste um bloco da paleta ou clique em + para começar. O primeiro balão já sai ligado ao gatilho.
            </p>
            <button
              type="button"
              className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-primary-600 hover:bg-primary-700 text-white transition-colors"
              onClick={onQuickStart}
            >
              <Plus size={14} aria-hidden="true" />
              Começar com uma mensagem
            </button>
          </div>
        </Panel>
      ) : null}

      <Panel
        position="bottom-center"
        className="wa-canvas-hint pointer-events-none select-none text-[11px] text-slate-500 dark:text-slate-400"
      >
        Roda do mouse move o quadro. Ctrl + roda para zoom. Shift + arrastar seleciona vários.
      </Panel>
    </ReactFlow>
  );
}

export default BotCanvas;
