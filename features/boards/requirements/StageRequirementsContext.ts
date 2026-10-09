import { createContext, useContext } from 'react';
import type { BoardStage, Deal } from '@/types';
import type { StageRequirementValues } from '@/lib/deals/stageRequirements';

export type StageCompletionRequest = {
  deal: Deal;
  stage: BoardStage;
  persist: (values: StageRequirementValues) => Promise<Deal>;
};
export const StageRequirementsContext = createContext<((request: StageCompletionRequest) => Promise<Deal | null>) | null>(null);
export const useStageRequirements = () => useContext(StageRequirementsContext);
