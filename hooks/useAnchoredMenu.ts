'use client';

/**
 * Menu flutuante ancorado num botão, renderizado por PORTAL.
 *
 * Serve pra menu que nasce dentro de um contêiner com rolagem ou
 * `overflow-hidden`: como o portal joga o menu pro body, ele não é recortado
 * pelo contêiner (era o que acontecia com os filtros do Chats, que ficavam
 * invisíveis dentro da faixa rolável).
 *
 * Fecha ao clicar fora ou apertar Esc, e reposiciona em resize/scroll.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export interface AnchoredMenuOptions {
  /** Largura do menu, usada pra não deixar passar da borda da tela. */
  width?: number;
  /** Altura máxima esperada: define se ele abre pra cima ou pra baixo. */
  maxHeight?: number;
  /** Distância entre o botão e o menu. */
  gap?: number;
}

export function useAnchoredMenu(open: boolean, onClose: () => void, opts: AnchoredMenuOptions = {}) {
  const { width = 220, maxHeight = 280, gap = 6 } = opts;
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const place = () => {
      const btn = triggerRef.current;
      if (!btn) return;
      const rect = btn.getBoundingClientRect();

      let left = rect.left;
      if (left + width > window.innerWidth - 8) left = window.innerWidth - 8 - width;
      if (left < 8) left = 8;

      const espacoAbaixo = window.innerHeight - rect.bottom;
      const abrirPraCima = espacoAbaixo < maxHeight + gap;
      const top = abrirPraCima ? rect.top - maxHeight - gap : rect.bottom + gap;

      setPos({ top: Math.max(8, top), left });
    };
    place();

    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, width, maxHeight, gap]);

  useEffect(() => {
    if (!open) return;
    const handleDown = (e: MouseEvent) => {
      const alvo = e.target as Node;
      if (menuRef.current?.contains(alvo)) return;
      if (triggerRef.current?.contains(alvo)) return;
      onClose();
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleDown);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleDown);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open, onClose]);

  return { triggerRef, menuRef, pos, width };
}
