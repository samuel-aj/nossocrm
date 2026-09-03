/**
 * Reusable Modal component with consistent styling
 * 
 * Accessibility Features:
 * - role="dialog" and aria-modal="true" for screen readers
 * - aria-labelledby pointing to modal title
 * - Focus trap to keep keyboard focus within modal
 * - Focus returns to trigger element on close
 * - Escape key closes modal
 */
import React, { useId, useCallback, useEffect } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { FocusTrap, useFocusReturn } from '@/lib/a11y';

/**
 * Camadas flutuantes (menus, balões) abertas num portal FORA do modal avisam
 * por aqui: enquanto houver uma aberta, o foco preso fica pausado (senão o
 * trap devolve o foco e a camada fecha na hora).
 */
const ModalOverlayContext = React.createContext<((open: boolean) => void) | null>(null);

export function useModalOverlay(open: boolean) {
  const notify = React.useContext(ModalOverlayContext);
  React.useEffect(() => {
    if (!notify || !open) return;
    notify(true);
    return () => notify(false);
  }, [notify, open]);
}
import {
  MODAL_BODY_CLASS,
  MODAL_CLOSE_BUTTON_CLASS,
  MODAL_HEADER_CLASS,
  MODAL_OVERLAY_CLASS,
  MODAL_PANEL_BASE_CLASS,
  MODAL_TITLE_CLASS,
  MODAL_VIEWPORT_CAP_CLASS,
} from './modalStyles';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Optional extra classes for the dialog container */
  className?: string;
  /** Optional extra classes for the body wrapper (useful for scroll/height) */
  bodyClassName?: string;
  /** Optional ID for aria-labelledby (auto-generated if not provided) */
  labelledById?: string;
  /** Optional ID for aria-describedby */
  describedById?: string;
  /** Initial element to focus (CSS selector or false to disable) */
  initialFocus?: string | false;
  /**
   * When embedding another modal inside (nested modal), you may want to disable
   * the focus trap temporarily to avoid trapping focus behind the nested dialog.
   */
  focusTrapEnabled?: boolean;
}

const sizeClasses = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
};

/**
 * Componente React `Modal`.
 *
 * @param {ModalProps} { 
  isOpen, 
  onClose, 
  title, 
  children, 
  size = 'md',
  className,
  bodyClassName,
  labelledById,
  describedById,
  initialFocus,
  focusTrapEnabled = true,
} - Parâmetro `{ 
  isOpen, 
  onClose, 
  title, 
  children, 
  size = 'md',
  className,
  bodyClassName,
  labelledById,
  describedById,
  initialFocus,
  focusTrapEnabled = true,
}`.
 * @returns {Element | null} Retorna um valor do tipo `Element | null`.
 */
export const Modal: React.FC<ModalProps> = ({ 
  isOpen, 
  onClose, 
  title, 
  children, 
  size = 'md',
  className,
  bodyClassName,
  labelledById,
  describedById,
  initialFocus,
  focusTrapEnabled = true,
}) => {
  // Generate unique ID for title if not provided
  const generatedId = useId();
  const titleId = labelledById || `modal-title-${generatedId}`;
  
  // Restore focus to trigger element on close
  useFocusReturn({ enabled: isOpen });
  // Quantas camadas flutuantes (menus/balões em portal) estão abertas por cima
  const [overlays, setOverlays] = React.useState(0);
  const notifyOverlay = useCallback((open: boolean) => setOverlays((n) => Math.max(0, n + (open ? 1 : -1))), []);

  // Handle Escape key
  const handleEscape = useCallback(() => {
    onClose();
  }, [onClose]);

  // Handle backdrop click
  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }, [onClose]);

  if (!isOpen) return null;

  const content = (
    <div
      className={MODAL_OVERLAY_CLASS}
      onClick={handleBackdropClick}
      aria-hidden="false"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={describedById}
        className={cn(
          MODAL_PANEL_BASE_CLASS,
          MODAL_VIEWPORT_CAP_CLASS,
          'animate-in zoom-in-95 duration-200',
          sizeClasses[size],
          className
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={MODAL_HEADER_CLASS}>
          <h2 id={titleId} className={MODAL_TITLE_CLASS}>
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar modal"
            className={MODAL_CLOSE_BUTTON_CLASS}
          >
            <X size={20} className="text-slate-500" aria-hidden="true" />
          </button>
        </div>
        <div className={cn(MODAL_BODY_CLASS, bodyClassName)}>{children}</div>
      </div>
    </div>
  );

  // O FocusTrap envolve o conteúdo SEMPRE: trocar entre "com" e "sem" wrapper
  // muda a árvore e o React remonta o conteúdo inteiro (estado interno perdido:
  // o modal da etapa do board abria e fechava na hora, o menu "..." sumia).
  // Com `focusTrapEnabled=false` o trap só fica PAUSADO (menus/modais por cima,
  // em portais fora daqui, recebem foco e cliques), sem desmontar nada.
  return (
    <FocusTrap
      active={isOpen}
      paused={!focusTrapEnabled || overlays > 0}
      onEscape={handleEscape}
      initialFocus={initialFocus}
      returnFocus={true}
    >
      <ModalOverlayContext.Provider value={notifyOverlay}>{content}</ModalOverlayContext.Provider>
    </FocusTrap>
  );
};

// ============ MODAL FORM WRAPPER ============

interface ModalFormProps extends React.FormHTMLAttributes<HTMLFormElement> {
  children: React.ReactNode;
}

/**
 * Componente React `ModalForm`.
 *
 * @param {ModalFormProps} { children, className, ...props } - Parâmetro `{ children, className, ...props }`.
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export const ModalForm: React.FC<ModalFormProps> = ({ children, className, ...props }) => (
  <form className={cn('space-y-4', className)} {...props}>
    {children}
  </form>
);
