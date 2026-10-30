'use client';

/**
 * Modal "para preencher" aberto por cima da tela do lead ou da configuração
 * da etapa (que já podem ser modais): vai para o body, fica acima e pausa o
 * foco preso do modal de baixo enquanto está aberto.
 */
import React from 'react';
import { createPortal } from 'react-dom';
import { Modal, useModalOverlay } from '@/components/ui/Modal';

export function FillModal({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  useModalOverlay(open);
  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <div className="relative z-[10030]">
      <Modal isOpen onClose={onClose} title={title} size="2xl" footer={footer}>
        <div data-esc-local="" className="space-y-4">
          {children}
        </div>
      </Modal>
    </div>,
    document.body
  );
}

/** Botão principal dos modais de preenchimento. */
export const FILL_PRIMARY_BTN = 'inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-2 text-sm font-bold text-white hover:bg-primary-500 disabled:opacity-50';
export const FILL_SECONDARY_BTN = 'rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/10';

export default FillModal;
