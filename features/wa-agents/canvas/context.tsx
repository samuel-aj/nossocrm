'use client';

/**
 * Contexto do quadro: opções (números, quadros/etapas, rótulos) e agentes,
 * lidos pelos nós sem precisar passar props pelo React Flow.
 */
import { createContext, useContext } from 'react';
import type { WaAgentListItem, WaAgentOptions } from '../useWaAgents';

export type CanvasContextValue = {
  options: WaAgentOptions | undefined;
  agents: WaAgentListItem[];
};

export const CanvasContext = createContext<CanvasContextValue>({ options: undefined, agents: [] });

export function useCanvasContext(): CanvasContextValue {
  return useContext(CanvasContext);
}
