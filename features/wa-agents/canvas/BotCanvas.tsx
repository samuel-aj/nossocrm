'use client';

/**
 * Área do quadro: React Flow com os nós do robô, fundo pontilhado, controles de
 * zoom e minimapa. Recebe o estado (nós/arestas) do editor e devolve as mudanças.
 * Ocupa todo o contêiner pai (sem moldura própria: o editor em tela cheia é a moldura).
 * Precisa estar dentro de um ReactFlowProvider.
 */
import React, { useCallback } from 'react';
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
  type Connection,
  type DefaultEdgeOptions,
  type Edge,
  type OnBeforeDelete,
  type OnEdgesChange,
  type OnNodesChange,
  type XYPosition,
} from '@xyflow/react';
import { minimapColor, nodeTypes } from './nodes';
import { DND_MIME, NODE_WIDTH, TRIGGER_NODE_ID, isStepType, type FlowEdge, type FlowNode, type StepType } from './types';

export type BotCanvasProps = {
  nodes: FlowNode[];
  edges: FlowEdge[];
  onNodesChange: OnNodesChange<FlowNode>;
  onEdgesChange: OnEdgesChange<FlowEdge>;
  onConnect: (connection: Connection) => void;
  /** Passo solto no quadro pela paleta (posição já em coordenadas do quadro). */
  onDropStep: (type: StepType, position: XYPosition) => void;
  darkMode: boolean;
};

const DEFAULT_EDGE_OPTIONS: DefaultEdgeOptions = {
  type: 'default',
  markerEnd: { type: MarkerType.ArrowClosed, width: 20, height: 20 },
};
const FIT_VIEW_OPTIONS = { padding: 0.2, maxZoom: 1 };
const DELETE_KEYS = ['Backspace', 'Delete'];
const SNAP_GRID: [number, number] = [10, 10];
const CANVAS_STYLE: React.CSSProperties = { position: 'absolute', inset: 0, width: '100%', height: '100%' };
/** Referência estável: o minimapa não precisa recalcular a cada render do quadro. */
const minimapNodeColor = (node: FlowNode): string => minimapColor(node.type);

export function BotCanvas({ nodes, edges, onNodesChange, onEdgesChange, onConnect, onDropStep, darkMode }: BotCanvasProps) {
  const { screenToFlowPosition } = useReactFlow<FlowNode, FlowEdge>();

  const onDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes(DND_MIME)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      const type = event.dataTransfer.getData(DND_MIME);
      if (!isStepType(type)) return;
      event.preventDefault();
      const point = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      onDropStep(type, { x: Math.round(point.x - NODE_WIDTH / 2), y: Math.round(point.y - 20) });
    },
    [onDropStep, screenToFlowPosition]
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
      nodeTypes={nodeTypes}
      colorMode={darkMode ? 'dark' : 'light'}
      className="wa-bot-canvas"
      style={CANVAS_STYLE}
      fitView
      fitViewOptions={FIT_VIEW_OPTIONS}
      minZoom={0.2}
      maxZoom={1.75}
      deleteKeyCode={DELETE_KEYS}
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
      <MiniMap pannable zoomable nodeColor={minimapNodeColor} nodeStrokeWidth={0} ariaLabel="Mapa do quadro" />
      <Panel
        position="bottom-center"
        className="pointer-events-none select-none text-[11px] text-slate-500 dark:text-slate-400"
      >
        Roda do mouse move o quadro. Ctrl + roda para zoom.
      </Panel>
    </ReactFlow>
  );
}

export default BotCanvas;
