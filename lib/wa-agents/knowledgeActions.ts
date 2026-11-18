import type { AgentRow, CustomAction } from './types';

export function knowledgeLookups(action: CustomAction) {
  return (action.actions ?? []).filter(step => step.type === 'consult_knowledge');
}

/** Documents reserved for explicit rules must never enter the agent-wide search. */
export function configuredKnowledgeIds(agent: Pick<AgentRow, 'custom_actions'>): Set<string> {
  return new Set((agent.custom_actions ?? []).flatMap(action => knowledgeLookups(action).map(step => step.knowledgeId)));
}
