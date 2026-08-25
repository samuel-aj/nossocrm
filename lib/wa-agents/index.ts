/**
 * Ponto de entrada do motor de Agentes de IA e Robôs (SERVER).
 * Para o cliente, importe direto de './types', './catalog' ou './defaults'.
 */
export * from './types';
export * from './catalog';
export * from './defaults';
export * from './errors';
export { isWaAgentsBetaEnabled } from './beta';
export { verifyInternalSecret } from './internalAuth';
export { renderTemplate, renderJsonTemplate, getPath } from './template';
export { splitLines, isOnlySymbols, MAX_LINES } from './split';
export { resolveAgentModel, getOrganizationApiKey } from './model';
export {
  loadConversationContext,
  loadDealContext,
  loadAgent,
  loadAgentNames,
  normalizeAgentRow,
  buildHistoryMessages,
  buildSystemPrompt,
  buildPromptVars,
  formatDateTimePtBr,
  messageText,
  type ConversationContext,
  type ContextContact,
  type ContextDeal,
  type WaConversationFull,
  type WaMessageLite,
} from './context';
export { logRun, type LogRunInput } from './runs';
export { dispatchAgentEvent, buildWebhookPayload, type WebhookResult } from './webhooks';
export { executeOutcomeActions, addDealTag, type OutcomeActionsResult } from './actions';
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
  NO_REPLY_TOKEN,
  type RunResult,
  type RunAgentInput,
  type CollectedToolCall,
} from './engine';
export {
  startBotRun,
  createBotRun,
  runBotRunNow,
  processDueBotRuns,
  processBotRun,
  handleBotReply,
  normalizeKeyword,
  type StartBotRunInput,
} from './bots';
export { testAgentReply, type TestMessage, type TestAgentReplyResult } from './test';
