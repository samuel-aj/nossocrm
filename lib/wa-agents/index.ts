/**
 * Ponto de entrada do motor de Agentes de IA e Robôs (SERVER).
 * Para o cliente, importe direto de './types', './catalog', './defaults',
 * './text' ou './triggers'.
 */
export * from './types';
export * from './catalog';
export * from './defaults';
export * from './errors';
export { normalizeKeyword, findKeyword } from './text';
export { pickInboundAgent } from './triggers';
export { isWaAgentsBetaEnabled } from './beta';
export { verifyInternalSecret } from './internalAuth';
export { renderTemplate, renderJsonTemplate, getPath } from './template';
export { splitLines, isOnlySymbols, MAX_LINES } from './split';
export { resolveAgentModel, getOrganizationApiKey, supportsTemperature } from './model';
export {
  loadConversationContext,
  loadDealContext,
  loadAgent,
  loadAgentNames,
  normalizeAgentRow,
  normalizeTriggers,
  buildHistoryMessages,
  buildSystemPrompt,
  buildPromptVars,
  buildLeadDataBlock,
  buildCustomActionsBlock,
  formatDateTimePtBr,
  messageText,
  LEAD_DATA_MAX_CHARS,
  type ConversationContext,
  type ContextContact,
  type ContextDeal,
  type WaConversationFull,
  type WaMessageLite,
} from './context';
export { logRun, type LogRunInput } from './runs';
export {
  dispatchAgentEvent,
  buildWebhookPayload,
  postWebhook,
  type WebhookResult,
  type WebhookEventName,
  type PostWebhookInput,
} from './webhooks';
export {
  executeOutcomeActions,
  executeCustomAction,
  executeActions,
  addDealTag,
  type OutcomeActionsResult,
  type ActionSource,
} from './actions';
export {
  getConversationAiInfo,
  applyConversationAction,
  parseApproval,
  type ApplyConversationActionResult,
  type RunAfter,
} from './conversation';
export {
  handleInboundMessage,
  runAgentOnConversation,
  resumeDueConversations,
  sleep,
  buildAgentTools,
  generateAgentReply,
  findOutcome,
  findCustomAction,
  NO_REPLY_TOKEN,
  type RunResult,
  type RunAgentInput,
  type CollectedToolCall,
} from './engine';
export { processDealStarts, type ProcessDealStartsResult } from './dealStarts';
export {
  startBotRun,
  createBotRun,
  runBotRunNow,
  processDueBotRuns,
  processBotRun,
  handleBotReply,
  nextStepIndex,
  type StartBotRunInput,
} from './bots';
export { testAgentReply, type TestMessage, type TestAgentReplyResult } from './test';
export {
  assistAgentConfig,
  resolveAssistModel,
  validateAssistInput,
  buildAssistSystemPrompt,
  normalizeSuggestions,
  slugifyKey,
} from './assist';
