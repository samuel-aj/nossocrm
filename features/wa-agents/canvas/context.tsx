'use client';

/**
 * Contexto do quadro: opções (números, quadros/etapas, rótulos), agentes,
 * ações sobre balões e blocos, bloco selecionado, problemas de validação e
 * ligações existentes. Lido pelos nós sem precisar passar props pelo React Flow.
 */
import { createContext, useContext } from 'react';
import type { WaAgentListItem, WaAgentOptions } from '../useWaAgents';
import type { BlockRef, StepType } from './types';

/** Ações do editor disponíveis para os nós (referência estável). */
export type CanvasActions = {
  /** Aponta um bloco (abre o painel de propriedades); null fecha o painel. */
  selectBlock: (ref: BlockRef | null) => void;
  /** Adiciona um bloco novo ao balão, no fim ou na posição `index`. */
  addBlock: (bubbleId: string, type: StepType, index?: number) => void;
  /** Move um bloco (dentro do mesmo balão ou para outro) para a posição `index` do balão de destino. */
  moveBlock: (from: BlockRef, toBubbleId: string, index: number) => void;
  removeBlock: (ref: BlockRef) => void;
  renameBubble: (bubbleId: string, name: string) => void;
  duplicateBubbles: (ids: string[]) => void;
  copyBubbles: (ids: string[]) => void;
  deleteBubbles: (ids: string[]) => void;
};

/** Resumo dos problemas de um balão ou bloco (validação inline). */
export type IssueSummary = { errors: string[]; warnings: string[] };

export type CanvasIssues = {
  byNode: ReadonlyMap<string, IssueSummary>;
  byBlock: ReadonlyMap<string, IssueSummary>;
};

export type CanvasContextValue = {
  options: WaAgentOptions | undefined;
  agents: WaAgentListItem[];
  actions: CanvasActions;
  selectedBlock: BlockRef | null;
  issues: CanvasIssues;
  /** Ids de aresta ("origem__saída") que têm ligação: a saída sem ligação é marcada no balão. */
  connected: ReadonlySet<string>;
};

const noop = () => {};

export const EMPTY_ISSUES: CanvasIssues = { byNode: new Map(), byBlock: new Map() };

export const NOOP_ACTIONS: CanvasActions = {
  selectBlock: noop,
  addBlock: noop,
  moveBlock: noop,
  removeBlock: noop,
  renameBubble: noop,
  duplicateBubbles: noop,
  copyBubbles: noop,
  deleteBubbles: noop,
};

export const CanvasContext = createContext<CanvasContextValue>({
  options: undefined,
  agents: [],
  actions: NOOP_ACTIONS,
  selectedBlock: null,
  issues: EMPTY_ISSUES,
  connected: new Set(),
});

export function useCanvasContext(): CanvasContextValue {
  return useContext(CanvasContext);
}
