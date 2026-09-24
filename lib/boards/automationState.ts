/** Projection of live automation, shared by the board indicator and its filter. */
export type DealAutomation = {
  kind: 'bot' | 'ai';
  name: string;
  state: 'running' | 'waiting_reply' | 'waiting_timer' | 'active';
};
export type AutomationFilter = 'all' | 'bot' | 'ai' | 'none';
export type AutomationMap = Record<string, DealAutomation | null>;

export function matchesAutomation(value: DealAutomation | null | undefined, filter: AutomationFilter = 'all') {
  if (filter === 'all') return true;
  // Undefined means not loaded / inaccessible, never infer that automation has stopped.
  if (value === undefined) return false;
  return filter === 'none' ? value === null : value?.kind === filter;
}

export function automationLabel(value: DealAutomation) {
  if (value.kind === 'ai') return `IA ativa: ${value.name}`;
  const state = value.state === 'waiting_reply' ? 'aguardando resposta'
    : value.state === 'waiting_timer' ? 'aguardando prazo' : 'em execução';
  return `Robô ${state}: ${value.name}`;
}

export type AutomationConversation = {
  id: string; deal_id: string | null; contact_id: string | null;
  ai_status: string | null; ai_agent_id: string | null;
};
export type AutomationRun = {
  id: string; deal_id: string | null; contact_id: string | null; conversation_id: string | null;
  bot_id: string; status: string; wake_at: string | null;
};

/** Explicit targets take precedence over contact fallback, which is resolved across ALL boards. */
export function buildAutomationMap(input: {
  dealIds: string[];
  conversations: AutomationConversation[];
  runs: AutomationRun[];
  latestOpenDealByContact: Map<string, string>;
  botNames: Map<string, string>;
  agentNames: Map<string, string>;
  now?: number;
}): AutomationMap {
  const result: AutomationMap = Object.fromEntries(input.dealIds.map(id => [id, null]));
  const conversations = new Map(input.conversations.map(c => [c.id, c]));
  const fallback = (contact: string | null) => contact ? input.latestOpenDealByContact.get(contact) : undefined;
  for (const conv of input.conversations) {
    if (conv.ai_status !== 'active') continue;
    const target = conv.deal_id || fallback(conv.contact_id);
    if (!target || !(target in result)) continue;
    result[target] = { kind: 'ai', state: 'active', name: input.agentNames.get(conv.ai_agent_id || '') || (conv.ai_agent_id ? 'Agente de IA' : 'Agente externo') };
  }
  // Input is newest-first. A robot takes the slot when multiple channels are active for one lead.
  for (const run of input.runs) {
    if (run.status !== 'running' && run.status !== 'waiting_reply') continue;
    const conv = run.conversation_id ? conversations.get(run.conversation_id) : undefined;
    if (run.conversation_id && !conv) continue; // Hidden/unavailable conversation.
    const target = run.deal_id || conv?.deal_id || fallback(run.contact_id || conv?.contact_id || null);
    if (!target || !(target in result) || result[target]?.kind === 'bot') continue;
    result[target] = {
      kind: 'bot', name: input.botNames.get(run.bot_id) || 'Robô',
      state: run.status === 'waiting_reply' ? 'waiting_reply'
        : run.wake_at && Date.parse(run.wake_at) > (input.now ?? Date.now()) ? 'waiting_timer' : 'running',
    };
  }
  return result;
}
