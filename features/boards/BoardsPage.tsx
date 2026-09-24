import { BoardAutomationsContext } from './hooks/useBoardAutomations';
import React, { useEffect } from 'react';
import { useBoardsController } from './hooks/useBoardsController';
import { PipelineView } from './components/PipelineView';
import { OnboardingModal } from '@/components/OnboardingModal';
import { useFirstVisit } from '@/hooks/useFirstVisit';

/**
 * Componente React `BoardsPage`.
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export const BoardsPage: React.FC = () => {
    const controller = useBoardsController();
    const { isFirstVisit, completeOnboarding } = useFirstVisit();
    const [showOnboarding, setShowOnboarding] = React.useState(false);

    // Show onboarding modal on first visit IF there are no boards
    // Only decide after boards have been fetched at least once
    useEffect(() => {
        // Wait until boards query has completed at least once
        if (!controller.boardsFetched) return;

        if (isFirstVisit && controller.boards.length === 0) {
            const timer = setTimeout(() => {
                setShowOnboarding(true);
            }, 500);
            return () => clearTimeout(timer);
        } else if (isFirstVisit && controller.boards.length > 0) {
            // If first visit but has boards, mark as completed silently
            completeOnboarding();
        }
    }, [isFirstVisit, controller.boards.length, controller.boardsFetched, completeOnboarding]);

    const handleOnboardingStart = () => {
        setShowOnboarding(false);
        completeOnboarding();
        // Open wizard automatically
        controller.setIsWizardOpen(true);
    };

    const handleOnboardingSkip = () => {
        setShowOnboarding(false);
        completeOnboarding();
    };

    return (
        <BoardAutomationsContext.Provider value={controller.automations}>
            {controller.automations.error && <p role="status" className="px-6 py-2 text-sm text-amber-700 dark:text-amber-300">Não foi possível atualizar as automações. Tentando novamente…</p>}
            {controller.automations.loading && controller.filterControls.general.automation && controller.filterControls.general.automation !== 'all' && <p role="status" className="px-6 py-2 text-sm text-slate-500">Consultando automações…</p>}
            <PipelineView {...controller} />

            <OnboardingModal
                isOpen={showOnboarding}
                onStart={handleOnboardingStart}
                onSkip={handleOnboardingSkip}
            />
        </BoardAutomationsContext.Provider>
    );
};

// @deprecated - Use BoardsPage
export const PipelinePage = BoardsPage;
