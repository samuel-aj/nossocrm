'use client';

/**
 * Camada flutuante (menu, balão) ancorada num elemento, renderizada num
 * portal no <body> com `position: fixed`: nunca é cortada por modal,
 * `overflow` ou rolagem. Reposiciona sozinha (abre para cima quando não há
 * espaço embaixo, cola nas bordas da tela) e limita a altura ao espaço
 * disponível, com rolagem interna. Clique fora e Esc fecham.
 *
 * Dentro de um Modal, avisa o modal (useModalOverlay) para o foco preso ser
 * pausado enquanto a camada estiver aberta.
 */
import React, { useEffect, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useModalOverlay } from '@/components/ui/Modal';

type Pos = { top?: number; bottom?: number; left: number; maxHeight: number; width: number };

const GAP = 6;
const MARGIN = 8;

export function FloatingLayer({
  open,
  anchorRef,
  onClose,
  children,
  width = 320,
  align = 'end',
  maxHeight = 360,
  className,
  role,
  ariaLabel,
}: {
  open: boolean;
  anchorRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  children: React.ReactNode;
  /** Largura desejada (px); encolhe em telas estreitas */
  width?: number;
  /** Alinhamento horizontal em relação à âncora */
  align?: 'start' | 'end';
  /** Altura máxima desejada (px); limitada ao espaço disponível */
  maxHeight?: number;
  className?: string;
  role?: string;
  ariaLabel?: string;
}) {
  const [pos, setPos] = useState<Pos | null>(null);
  useModalOverlay(open);

  const measure = () => {
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = Math.min(width, vw - MARGIN * 2);
    let left = align === 'end' ? r.right - w : r.left;
    left = Math.max(MARGIN, Math.min(left, vw - w - MARGIN));
    const below = vh - r.bottom - GAP - MARGIN;
    const above = r.top - GAP - MARGIN;
    if (below >= Math.min(maxHeight, 200) || below >= above) {
      setPos({ top: r.bottom + GAP, left, width: w, maxHeight: Math.max(120, Math.min(maxHeight, below)) });
    } else {
      setPos({ bottom: vh - r.top + GAP, left, width: w, maxHeight: Math.max(120, Math.min(maxHeight, above)) });
    }
  };

  useLayoutEffect(() => {
    if (!open) return;
    measure();
    const onScroll = () => measure();
    window.addEventListener('resize', onScroll);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('resize', onScroll);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open, width, align, maxHeight]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <>
      <div className="fixed inset-0 z-[10000]" onMouseDown={onClose} aria-hidden="true" />
      <div
        role={role}
        aria-label={ariaLabel}
        className={`fixed z-[10001] overflow-y-auto scrollbar-custom rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-dark-card shadow-xl ${
          pos ? 'opacity-100' : 'opacity-0'
        } ${className ?? ''}`}
        style={pos ? { top: pos.top, bottom: pos.bottom, left: pos.left, width: pos.width, maxHeight: pos.maxHeight } : { left: -9999, top: 0 }}
      >
        {children}
      </div>
    </>,
    document.body
  );
}

export default FloatingLayer;
