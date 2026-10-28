import { createContext, useContext } from 'react';
import type { Board, BoardStage, Deal } from '@/types';

/**
 * Pedido de conferência do contrato ao mover um lead para uma etapa que tem
 * "contrato ao entrar". O modal mostra o que vai no documento; a pessoa
 * ajusta e decide. Nada é enviado sem essa confirmação.
 */
export type SignatureReviewRequest = {
  deal: Deal;
  stage: BoardStage;
  board: Board;
  /** nome do modelo da regra (para o cabeçalho enquanto os dados carregam) */
  templateName: string | null;
  /**
   * O lead JÁ está na etapa (as pendências da etapa o moveram antes): o modal
   * só confere e envia; cancelar deixa o contrato aguardando na aba Contrato.
   */
  moved: boolean;
  /** Executa o movimento (quando `moved` é false). Devolve o que o banco confirmou. */
  persistMove?: () => Promise<Partial<Deal> | undefined>;
};

export type SignatureReviewResult = { cancelled: true } | { cancelled: false; confirmed?: Partial<Deal>; sent: boolean };

export const SignatureReviewContext = createContext<((request: SignatureReviewRequest) => Promise<SignatureReviewResult>) | null>(null);
export const useSignatureReview = () => useContext(SignatureReviewContext);
