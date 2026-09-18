/**
 * O que está sendo arrastado agora (bloco da paleta ou bloco existente).
 * O navegador não deixa ler o conteúdo do arrasto durante o "dragover", só no
 * "drop": sem isto o balão não sabia se a posição era permitida enquanto o
 * mouse passava e o erro só aparecia depois de soltar.
 */
import type { BlockRef, StepType } from './types';

export type DragSession = { kind: 'palette'; type: StepType } | { kind: 'block'; ref: BlockRef; type: StepType };

let current: DragSession | null = null;

export function startDragSession(session: DragSession): void {
  current = session;
}

export function endDragSession(): void {
  current = null;
}

export function getDragSession(): DragSession | null {
  return current;
}
