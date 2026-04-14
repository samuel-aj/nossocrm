import React, { useState, useEffect, useRef, useId } from 'react';
import { X, ThumbsDown, DollarSign, Users, Clock, HelpCircle, UserX, ShieldX, CheckCircle2 } from 'lucide-react';
import { FocusTrap, useFocusReturn } from '@/lib/a11y';

interface LossReasonModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (reason: string, category: 'qualified' | 'disqualified') => void;
  dealTitle?: string;
}

const QUALIFIED_REASONS = [
  { label: 'Preço', icon: DollarSign, value: 'Preço muito alto' },
  { label: 'Concorrência', icon: Users, value: 'Perdeu para concorrente' },
  { label: 'Timing', icon: Clock, value: 'Momento inadequado' },
  { label: 'Desistência', icon: X, value: 'Cliente desistiu' },
  { label: 'Outro', icon: HelpCircle, value: '' },
];

const DISQUALIFIED_REASONS = [
  { label: 'Sem orçamento', icon: DollarSign, value: 'Sem orçamento disponível' },
  { label: 'Sem perfil', icon: UserX, value: 'Fora do perfil ideal' },
  { label: 'Sem interesse', icon: ShieldX, value: 'Sem interesse real' },
  { label: 'Dados inválidos', icon: X, value: 'Dados de contato inválidos' },
  { label: 'Outro', icon: HelpCircle, value: '' },
];

type Step = 'category' | 'reason' | 'custom';

/**
 * LossReasonModal - Modal to capture deal loss reason with qualification step
 */
export const LossReasonModal: React.FC<LossReasonModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  dealTitle,
}) => {
  const [step, setStep] = useState<Step>('category');
  const [category, setCategory] = useState<'qualified' | 'disqualified' | null>(null);
  const [reason, setReason] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const generatedId = useId();
  const titleId = `loss-reason-title-${generatedId}`;
  const descId = `loss-reason-desc-${generatedId}`;
  const inputId = `loss-reason-input-${generatedId}`;

  useFocusReturn({ enabled: isOpen });

  useEffect(() => {
    if (isOpen) {
      setStep('category');
      setCategory(null);
      setReason('');
    }
  }, [isOpen]);

  useEffect(() => {
    if (step === 'custom' && inputRef.current) {
      inputRef.current.focus();
    }
  }, [step]);

  if (!isOpen) return null;

  const handleSelectCategory = (cat: 'qualified' | 'disqualified') => {
    setCategory(cat);
    setStep('reason');
  };

  const handleQuickReason = (value: string) => {
    if (value === '') {
      setStep('custom');
    } else {
      onConfirm(value, category!);
      onClose();
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (reason.trim() && category) {
      onConfirm(reason.trim(), category);
      onClose();
    }
  };

  const handleSkip = () => {
    onConfirm('Não informado', category || 'qualified');
    onClose();
  };

  const reasons = category === 'disqualified' ? DISQUALIFIED_REASONS : QUALIFIED_REASONS;

  const stepTitle = {
    category: 'Tipo de Perda',
    reason: category === 'disqualified' ? 'Motivo da Desqualificação' : 'Motivo da Perda',
    custom: category === 'disqualified' ? 'Motivo da Desqualificação' : 'Motivo da Perda',
  }[step];

  const stepDescription = {
    category: 'Esse lead era qualificado ou desqualificado?',
    reason: category === 'disqualified'
      ? 'Por que esse lead foi desqualificado?'
      : 'Qual foi o motivo da perda? Isso ajuda a melhorar suas estratégias.',
    custom: 'Digite o motivo personalizado.',
  }[step];

  return (
    <FocusTrap
      active={isOpen}
      onEscape={onClose}
      returnFocus={true}
    >
      <div
        className="fixed inset-0 md:left-[var(--app-sidebar-width,0px)] z-[9999] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-200"
        onClick={(e) => e.target === e.currentTarget && onClose()}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={descId}
          className="bg-white dark:bg-dark-card border border-slate-200 dark:border-white/10 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="px-6 py-4 border-b border-slate-200 dark:border-white/10 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center" aria-hidden="true">
                <ThumbsDown className="w-5 h-5 text-red-600 dark:text-red-400" />
              </div>
              <div>
                <h3
                  id={titleId}
                  className="font-bold text-slate-900 dark:text-white font-display"
                >
                  {stepTitle}
                </h3>
                {dealTitle && (
                  <p className="text-xs text-slate-500 dark:text-slate-400 truncate max-w-[200px]">
                    {dealTitle}
                  </p>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar modal"
              className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-white/5 transition-colors focus-visible-ring"
            >
              <X className="w-5 h-5 text-slate-400" aria-hidden="true" />
            </button>
          </div>

          {/* Content */}
          <div className="p-6">
            <p
              id={descId}
              className="text-sm text-slate-600 dark:text-slate-400 mb-4"
            >
              {stepDescription}
            </p>

            {/* Step Indicator */}
            <div className="flex items-center gap-2 mb-5">
              <div className={`h-1.5 flex-1 rounded-full transition-colors ${step === 'category' ? 'bg-red-500' : 'bg-red-500'}`} />
              <div className={`h-1.5 flex-1 rounded-full transition-colors ${step !== 'category' ? 'bg-red-500' : 'bg-slate-200 dark:bg-white/10'}`} />
            </div>

            {/* Step 1: Category Selection */}
            {step === 'category' && (
              <div className="space-y-3" role="group" aria-label="Tipo de lead">
                <button
                  type="button"
                  onClick={() => handleSelectCategory('qualified')}
                  className="w-full flex items-center gap-4 p-4 rounded-xl border border-slate-200 dark:border-white/10
                             hover:border-orange-300 dark:hover:border-orange-500/50 hover:bg-orange-50 dark:hover:bg-orange-900/10
                             transition-all group text-left focus-visible-ring"
                >
                  <div className="w-10 h-10 rounded-full bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center shrink-0">
                    <CheckCircle2 className="w-5 h-5 text-orange-600 dark:text-orange-400" />
                  </div>
                  <div>
                    <span className="text-sm font-bold text-slate-900 dark:text-white group-hover:text-orange-600 dark:group-hover:text-orange-400 block">
                      Lead Qualificado
                    </span>
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      O lead tinha perfil, mas não fechou por objeção ou outro motivo
                    </span>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => handleSelectCategory('disqualified')}
                  className="w-full flex items-center gap-4 p-4 rounded-xl border border-slate-200 dark:border-white/10
                             hover:border-red-300 dark:hover:border-red-500/50 hover:bg-red-50 dark:hover:bg-red-900/10
                             transition-all group text-left focus-visible-ring"
                >
                  <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center shrink-0">
                    <UserX className="w-5 h-5 text-red-600 dark:text-red-400" />
                  </div>
                  <div>
                    <span className="text-sm font-bold text-slate-900 dark:text-white group-hover:text-red-600 dark:group-hover:text-red-400 block">
                      Lead Desqualificado
                    </span>
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      O lead não tinha perfil ou condições para fechar
                    </span>
                  </div>
                </button>
              </div>
            )}

            {/* Step 2: Reason Selection */}
            {step === 'reason' && (
              <div>
                <div className="grid grid-cols-2 gap-2" role="group" aria-label="Motivos rápidos">
                  {reasons.map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      onClick={() => handleQuickReason(item.value)}
                      className="flex items-center gap-2 p-3 rounded-xl border border-slate-200 dark:border-white/10
                                 hover:border-red-300 dark:hover:border-red-500/50 hover:bg-red-50 dark:hover:bg-red-900/10
                                 transition-all group text-left focus-visible-ring"
                    >
                      <item.icon className="w-4 h-4 text-slate-400 group-hover:text-red-500 dark:group-hover:text-red-400 transition-colors" aria-hidden="true" />
                      <span className="text-sm font-medium text-slate-700 dark:text-slate-300 group-hover:text-red-600 dark:group-hover:text-red-400">
                        {item.label}
                      </span>
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => { setStep('category'); setCategory(null); }}
                  className="mt-4 w-full text-center text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors focus-visible-ring rounded p-1"
                >
                  ← Voltar
                </button>
              </div>
            )}

            {/* Step 3: Custom Reason Input */}
            {step === 'custom' && (
              <form onSubmit={handleSubmit}>
                <label htmlFor={inputId} className="sr-only">
                  {category === 'disqualified' ? 'Motivo da desqualificação' : 'Motivo da perda'}
                </label>
                <input
                  ref={inputRef}
                  id={inputId}
                  type="text"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder={category === 'disqualified' ? 'Motivo da desqualificação...' : 'Motivo da perda...'}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-white/10
                             bg-slate-50 dark:bg-white/5 text-slate-900 dark:text-white
                             placeholder:text-slate-400 dark:placeholder:text-slate-500
                             focus:outline-none focus:ring-2 focus:ring-red-500/50 focus:border-red-500
                             transition-all"
                  autoFocus
                />
                <div className="flex gap-2 mt-4">
                  <button
                    type="button"
                    onClick={() => setStep('reason')}
                    className="flex-1 px-4 py-2.5 rounded-lg text-sm font-medium text-slate-600 dark:text-slate-400
                               hover:bg-slate-100 dark:hover:bg-white/5 transition-colors focus-visible-ring"
                  >
                    Voltar
                  </button>
                  <button
                    type="submit"
                    disabled={!reason.trim()}
                    className="flex-1 px-4 py-2.5 rounded-lg text-sm font-bold text-white
                               bg-red-600 hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed
                               shadow-lg shadow-red-600/20 transition-all focus-visible-ring"
                  >
                    Confirmar
                  </button>
                </div>
              </form>
            )}
          </div>

          {/* Footer - Skip */}
          {step !== 'custom' && (
            <div className="px-6 pb-6">
              <button
                type="button"
                onClick={handleSkip}
                className="w-full text-center text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors focus-visible-ring rounded p-1"
              >
                Pular esta etapa
              </button>
            </div>
          )}
        </div>
      </div>
    </FocusTrap>
  );
};

export default LossReasonModal;
