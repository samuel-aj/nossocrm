import React from 'react';
import { BoardStage } from '@/types';

interface StageProgressBarProps {
    stages: BoardStage[];
    currentStatus: string;
    onStageClick: (stageId: string) => void;
    /**
     * UI variant.
     * - segmented (default): old "menu-like" segmented bar
     * - timeline: low-contrast, compact "status timeline" (still clickable)
     */
    variant?: 'segmented' | 'timeline';
    className?: string;
}

/**
 * Componente React `StageProgressBar`.
 *
 * @param {StageProgressBarProps} {
    stages,
    currentStatus,
    onStageClick,
    variant = 'segmented',
    className,
} - Parâmetro `{
    stages,
    currentStatus,
    onStageClick,
    variant = 'segmented',
    className,
}`.
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export const StageProgressBar: React.FC<StageProgressBarProps> = ({
    stages,
    currentStatus,
    onStageClick,
    variant = 'segmented',
    className,
}) => {
    const currentIndex = Math.max(0, stages.findIndex((s) => s.id === currentStatus));

    if (variant === 'timeline') {
        // Jobs-style: show stages as a compact status timeline (not a second header/menu).
        // Design goals:
        // - Low height, clear labels (no "faded/disabled" look)
        // - A continuous line with connectors, so it reads as "status/progress"
        // - Still clickable to change stage
        return (
            <div className={`w-full ${className ?? ''}`}>
                {/* Celular: as etapas quebram linha (todas visíveis de uma vez,
                    sem conectores nem scroll escondido); desktop igual. */}
                <div className="overflow-x-auto">
                    <div className="min-w-max max-md:min-w-0 py-1">
                        <div className="flex items-center gap-2 max-md:flex-wrap max-md:gap-1.5">
                            {stages.map((stage, index) => {
                                const isCurrent = currentStatus === stage.id;
                                const isPast = index < currentIndex;
                                const isWonStage = stage.linkedLifecycleStage === 'CUSTOMER';
                                const isLostStage = stage.linkedLifecycleStage === 'OTHER';

                                // Jony-style: only the *current* step carries color.
                                // Everything else is neutral, with consistent hierarchy.
                                const dotSize = isCurrent ? 'h-3 w-3' : 'h-2.5 w-2.5';
                                const currentDotColor = isLostStage
                                    ? 'bg-red-500'
                                    : isWonStage
                                        ? 'bg-green-500'
                                        : (stage.color || 'bg-primary-500');

                                const dotClass = isCurrent
                                    ? `${dotSize} ${currentDotColor} ring-4 ring-primary-500/20 dark:ring-primary-400/20`
                                    : isPast
                                        ? `${dotSize} bg-primary-400 dark:bg-primary-500/60`
                                        : `${dotSize} bg-slate-300/70 dark:bg-white/10`;

                                const labelClass = isCurrent
                                    ? 'text-primary-700 dark:text-primary-300 font-bold'
                                    : isPast
                                        ? 'text-slate-700 dark:text-slate-200 font-medium'
                                        : 'text-slate-400 dark:text-slate-500 font-medium';

                                // Neutral connectors (past slightly stronger, but never colored).
                                const connectorClass = index < currentIndex
                                    ? 'bg-primary-300 dark:bg-primary-500/30'
                                    : 'bg-slate-200 dark:bg-white/10';

                                return (
                                    <React.Fragment key={stage.id}>
                                        <button
                                            type="button"
                                            onClick={() => onStageClick(stage.id)}
                                            aria-current={isCurrent ? 'step' : undefined}
                                            // "Invisible" affordance: clickable but not a chip.
                                            className={`group inline-flex items-center gap-2 max-md:gap-1.5 rounded-md px-2 py-1 max-md:border max-md:border-slate-200 max-md:dark:border-white/10 max-md:rounded-full outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary-500/40 ${isCurrent ? 'bg-primary-50 dark:bg-primary-500/10 max-md:border-primary-300 max-md:dark:border-primary-500/40' : ''}`}
                                            title={stage.label}
                                        >
                                            <span className={`rounded-full ${dotClass}`} />
                                            <span
                                                className={`text-xs whitespace-nowrap ${labelClass} underline-offset-4 group-hover:underline`}
                                            >
                                                {stage.label}
                                            </span>
                                        </button>

                                        {index < stages.length - 1 && (
                                            // Celular: conector curto entre os chips mantém a ideia
                                            // de sequência ligada mesmo com as etapas quebrando linha
                                            <span
                                                aria-hidden="true"
                                                className={`h-px w-7 max-md:w-2.5 max-md:shrink-0 ${connectorClass}`}
                                            />
                                        )}
                                    </React.Fragment>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // Default (legacy): segmented bar (more "menu-like")
    return (
        <div className={`flex items-center w-full overflow-hidden rounded-lg border border-slate-200 dark:border-white/10 ${className ?? ''}`}>
            {stages.map((stage, index, arr) => {
                const isCurrent = currentStatus === stage.id;
                const isPast = currentIndex > index;
                const isWonStage = stage.linkedLifecycleStage === 'CUSTOMER';
                const isLostStage = stage.linkedLifecycleStage === 'OTHER';

                // Determine colors based on stage type
                let activeColor = 'bg-green-500 text-white';
                let inactiveColor =
                    'bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-300 dark:hover:bg-slate-600';

                if (isWonStage) {
                    activeColor = 'bg-green-500 text-white';
                    inactiveColor =
                        'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 hover:bg-green-200 dark:hover:bg-green-900/50';
                } else if (isLostStage) {
                    activeColor = 'bg-red-500 text-white';
                    inactiveColor =
                        'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-900/50';
                }

                return (
                    <button
                        key={stage.id}
                        type="button"
                        onClick={() => onStageClick(stage.id)}
                        className={`flex-1 w-0 py-2 px-2 text-xs font-bold uppercase tracking-wider border-r border-white/20 relative transition-colors outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-1 dark:focus:ring-offset-slate-900 whitespace-nowrap overflow-hidden text-ellipsis
                        ${isCurrent || isPast ? activeColor : inactiveColor}`}
                    >
                        {stage.label}
                    </button>
                );
            })}
        </div>
    );
};
