'use client';

/**
 * Seta entre balões com um botão × no meio: desconecta os dois balões sem
 * excluir nenhum deles (só a ligação sai). A mesma coisa que selecionar a seta
 * e apertar Delete, mas visível e funcional no toque.
 */
import React, { useCallback } from 'react';
import { BaseEdge, EdgeLabelRenderer, getBezierPath, useReactFlow, type EdgeProps } from '@xyflow/react';
import { X } from 'lucide-react';

export function DisconnectableEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
  selected,
}: EdgeProps) {
  const { deleteElements } = useReactFlow();
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });

  const onDisconnect = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      void deleteElements({ edges: [{ id }] });
    },
    [deleteElements, id]
  );

  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />
      <EdgeLabelRenderer>
        <button
          type="button"
          className={`wa-edge-disconnect nodrag nopan${selected ? ' is-selected' : ''}`}
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          onClick={onDisconnect}
          aria-label="Desconectar os balões"
          title="Desconectar (remove só a seta; os balões ficam)"
        >
          <X size={12} aria-hidden="true" />
        </button>
      </EdgeLabelRenderer>
    </>
  );
}

/** Referência estável: substitui a seta padrão do React Flow em todo o quadro. */
export const edgeTypes = { default: DisconnectableEdge };
