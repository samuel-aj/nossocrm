import React from 'react';
import { ContactStage } from '@/types';
import { Users, UserCheck, Handshake, Crown, Archive, ChevronRight } from 'lucide-react';

interface StageCounts {
  LEAD: number;
  MQL: number;
  PROSPECT: number;
  CUSTOMER: number;
  OTHER: number;
}

interface ContactsStageTabs {
  activeStage: ContactStage | 'ALL';
  onStageChange: (stage: ContactStage | 'ALL') => void;
  counts: StageCounts;
}

const STAGE_CONFIG = {
  LEAD: {
    label: 'Leads',
    icon: Users,
    color: 'bg-slate-500',
    activeColor:
      'bg-slate-100 dark:bg-slate-500/20 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-500/30',
  },
  MQL: {
    label: 'MQL',
    icon: UserCheck,
    color: 'bg-blue-500',
    activeColor:
      'bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300 border-blue-300 dark:border-blue-500/30',
  },
  PROSPECT: {
    label: 'Prospects',
    icon: Handshake,
    color: 'bg-purple-500',
    activeColor:
      'bg-purple-100 dark:bg-purple-500/20 text-purple-700 dark:text-purple-300 border-purple-300 dark:border-purple-500/30',
  },
  CUSTOMER: {
    label: 'Clientes',
    icon: Crown,
    color: 'bg-green-500',
    activeColor:
      'bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-300 border-green-300 dark:border-green-500/30',
  },
  OTHER: {
    label: 'Outros / Perdidos',
    icon: Archive,
    color: 'bg-slate-500',
    activeColor:
      'bg-slate-100 dark:bg-slate-500/20 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-500/30',
  },
};

/**
 * Componente React `ContactsStageTabs`.
 *
 * @param {ContactsStageTabs} {
  activeStage,
  onStageChange,
  counts,
} - Parâmetro `{
  activeStage,
  onStageChange,
  counts,
}`.
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export const ContactsStageTabs: React.FC<ContactsStageTabs> = ({
  activeStage,
  onStageChange,
  counts,
}) => {
  const total = counts.LEAD + counts.MQL + counts.PROSPECT + counts.CUSTOMER + (counts.OTHER || 0);

  // Celular: dica visual de que a faixa desliza (degradê + seta na borda
  // direita, que some quando chega no fim da rolagem).
  const stripRef = React.useRef<HTMLDivElement>(null);
  const [hasMoreRight, setHasMoreRight] = React.useState(false);
  const updateScrollHint = React.useCallback(() => {
    const el = stripRef.current;
    if (!el) return;
    setHasMoreRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 8);
  }, []);
  React.useEffect(() => {
    updateScrollHint();
  }, [updateScrollHint, total]);

  return (
    <div className="relative">
    <div
      ref={stripRef}
      onScroll={updateScrollHint}
      className="flex items-center gap-2 flex-wrap max-md:flex-nowrap max-md:overflow-x-auto scrollbar-none max-md:gap-1.5 max-md:pb-1"
    >
      {/* All */}
      <button
        onClick={() => onStageChange('ALL')}
        className={`flex items-center gap-2 px-4 py-2 max-md:shrink-0 max-md:px-3 max-md:py-1.5 max-md:text-xs rounded-lg text-sm font-medium transition-all border ${
          activeStage === 'ALL'
            ? 'bg-primary-100 dark:bg-primary-500/20 text-primary-700 dark:text-primary-300 border-primary-300 dark:border-primary-500/30'
            : 'bg-white dark:bg-white/5 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/10'
        }`}
      >
        Todos
        <span
          className={`text-xs px-1.5 py-0.5 rounded-full ${
            activeStage === 'ALL'
              ? 'bg-primary-200 dark:bg-primary-500/30'
              : 'bg-slate-100 dark:bg-white/10'
          }`}
        >
          {total}
        </span>
      </button>

      {/* Stage Tabs */}
      {Object.entries(STAGE_CONFIG).map(([stage, config]) => {
        const Icon = config.icon;
        const count = counts[stage as keyof StageCounts];
        const isActive = activeStage === stage;

        return (
          <button
            key={stage}
            onClick={() => onStageChange(stage as ContactStage)}
            className={`flex items-center gap-2 px-4 py-2 max-md:shrink-0 max-md:px-3 max-md:py-1.5 max-md:text-xs rounded-lg text-sm font-medium transition-all border ${
              isActive
                ? config.activeColor
                : 'bg-white dark:bg-white/5 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/10'
            }`}
          >
            <Icon size={16} />
            {config.label}
            <span
              className={`text-xs px-1.5 py-0.5 rounded-full ${
                isActive ? 'bg-white/50 dark:bg-white/10' : 'bg-slate-100 dark:bg-white/10'
              }`}
            >
              {count}
            </span>
          </button>
        );
      })}
    </div>
    {hasMoreRight && (
      <div
        aria-hidden="true"
        className="md:hidden pointer-events-none absolute inset-y-0 right-0 flex items-center justify-end w-12 bg-gradient-to-l from-surface-bg via-surface-bg/60 to-transparent"
      >
        <ChevronRight size={16} className="text-slate-400" />
      </div>
    )}
    </div>
  );
};

// Badge de estágio para usar nas rows
/**
 * Componente React `StageBadge`.
 *
 * @param {{ stage: string; }} { stage } - Parâmetro `{ stage }`.
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export const StageBadge: React.FC<{ stage: ContactStage | string }> = ({ stage }) => {
  const config = STAGE_CONFIG[stage];

  if (!config) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400">
        {stage}
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${config.activeColor}`}
    >
      {config.label}
    </span>
  );
};
