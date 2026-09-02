import React from 'react';
import FocusTrapReact from 'focus-trap-react';

export interface FocusTrapProps {
  /** Whether the trap is active */
  active: boolean;
  /** Element(s) to trap focus within */
  children: React.ReactNode;
  /** Callback when user presses Escape */
  onEscape?: () => void;
  /** Initial focus target (selector or ref) */
  initialFocus?: string | React.RefObject<HTMLElement> | false;
  /** Return focus to this element on deactivate */
  returnFocus?: boolean;
  /** Allow clicks outside the trap */
  clickOutsideDeactivates?: boolean;
  /**
   * Permite CLIQUES fora do trap sem desativá-lo (ex.: navegar pela sidebar
   * com o modal aberto). O foco por teclado continua preso no modal.
   */
  allowOutsideClick?: boolean;
}

/**
 * FocusTrap - Traps keyboard focus within children
 * 
 * Wraps focus-trap-react for consistent modal/dialog accessibility.
 * When active, Tab/Shift+Tab cycles only through focusable elements
 * within the trap.
 * 
 * @example
 * ```tsx
 * <FocusTrap active={isOpen} onEscape={onClose}>
 *   <dialog>
 *     <button>First focusable</button>
 *     <button>Last focusable</button>
 *   </dialog>
 * </FocusTrap>
 * ```
 */
export const FocusTrap: React.FC<FocusTrapProps> = ({
  active,
  children,
  onEscape,
  initialFocus,
  returnFocus = true,
  clickOutsideDeactivates = false,
  // true por padrão: menus e balões do radix vivem num portal FORA do modal;
  // com false o focus-trap engolia o clique neles (menu "..." dentro de modal).
  allowOutsideClick = true,
}) => {
  const getInitialFocus = (): string | HTMLElement | (() => HTMLElement | null) | false | undefined => {
    if (initialFocus === false) {
      return false;
    }
    if (typeof initialFocus === 'string') {
      return initialFocus;
    }
    if (initialFocus && 'current' in initialFocus) {
      return () => initialFocus.current;
    }
    return undefined;
  };

  return (
    <FocusTrapReact
      active={active}
      focusTrapOptions={{
        initialFocus: getInitialFocus(),
        returnFocusOnDeactivate: returnFocus,
        escapeDeactivates: onEscape ? () => {
          onEscape();
          return false; // Don't deactivate, let parent handle it
        } : true,
        clickOutsideDeactivates,
        allowOutsideClick: clickOutsideDeactivates || allowOutsideClick,
        // Fallback to container if no focusable elements found
        fallbackFocus: () => {
          const container = document.querySelector('[data-focus-trap-fallback]');
          return (container as HTMLElement) || document.body;
        },
      }}
    >
      <div data-focus-trap-fallback tabIndex={-1}>
        {children}
      </div>
    </FocusTrapReact>
  );
};

export default FocusTrap;
