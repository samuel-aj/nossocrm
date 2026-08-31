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
export { evaluateExpression, formatCalcResult, CALC_FUNCTIONS, CALC_MAX_LENGTH } from './calc';
export {
  sanitizeStorageFileName,
  originalFileName,
  agentFilePrefix,
  agentFilePath,
  isAgentFilePath,
} from './files';
export { isAiAgentsApproved, isWaAgentsBetaEnabled } from './beta';
export { verifyInternalSecret } from './internalAuth';
export {
  sanitizeSavedData,
  sanitizeSavedValue,
  sanitizeSavedText,
  normalizeSavedKey,
  mergeSavedDataInto,
  SAVED_DATA_MAX_KEYS,
  SAVED_DATA_KEY_MAX_CHARS,
  SAVED_DATA_VALUE_MAX_CHARS,
  SAVED_DATA_MAX_CHARS,
  type SavedValue,
} from './savedData';
export { getAgentFileInfo, isGenericMime, type StoredFileInfo } from './storage';
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
  normalizeTools,
  normalizeHelperIds,
  buildHistoryMessages,
  buildSystemPrompt,
  buildPromptVars,
  buildLeadDataBlock,
  buildCustomActionsBlock,
  buildContextBlock,
  buildMediaBlock,
  buildHelpersBlock,
  buildKnowledgeBlock,
  replaceScriptMarkers,
  hasScriptMarkers,
  helperPurpose,
  formatDateTimePtBr,
  messageText,
  LEAD_DATA_MAX_CHARS,
  type ConversationContext,
  type ContextContact,
  type ContextDeal,
  type WaConversationFull,
  type WaMessageLite,
} from './context';
export {
  extractDocumentText,
  chunkText,
  cleanExtractedText,
  resolveDocumentMime,
  embedTexts,
  resolveEmbeddingModel,
  embeddingProviderOf,
  processDocument,
  searchKnowledge,
  formatKnowledgeHits,
  loadDocument,
  loadAgentDocuments,
  loadReadyDocuments,
  deleteDocumentChunks,
  isProcessingStale,
  DOCUMENT_COLUMNS,
  MAX_DOCUMENT_TEXT_CHARS,
  MAX_TEXT_FILE_BYTES,
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL_IDS,
  MIN_SIMILARITY,
  PROCESS_TIMEOUT_MS,
  PROCESSING_STALE_MS,
  PROCESSING_STALE_ERROR,
  type ChunkOptions,
  type ProcessDocumentResult,
  type EmbedTextsResult,
  type EmbeddingModelId,
  type EmbeddingProvider,
} from './knowledge';
export { loadAgentResources, loadAgentMedia, loadHelperAgents, MEDIA_COLUMNS } from './resources';
export {
  buildAgentTools,
  buildUtilityTools,
  findByName,
  uniqueNames,
  helperDisplayName,
  type AgentToolRuntime,
  type MediaSendResult,
} from './tools';
export {
  sendAgentMedia,
  copyAgentMediaToOutbox,
  ensureAgentMediaOutbox,
  WA_MEDIA_BUCKET,
  type SendAgentMediaInput,
  type SendAgentMediaResult,
} from './media';
export { consultHelperAgent, buildHelperSystemPrompt, type ConsultHelperInput } from './helpers';
export { logRun, type LogRunInput } from './runs';
export {
  dispatchAgentEvent,
  buildWebhookPayload,
  postWebhook,
  resolvesToPrivateAddress,
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
  lockSecondsFor,
  dailyTokenLimit,
  generateAgentReply,
  segmentText,
  findOutcome,
  findCustomAction,
  NO_REPLY_TOKEN,
  MAX_HELPER_CALLS_PER_RUN,
  MAX_KNOWLEDGE_CALLS_PER_RUN,
  RATE_WINDOW_MINUTES,
  RATE_MAX_RUNS,
  DEFAULT_DAILY_TOKEN_LIMIT,
  type RunResult,
  type RunAgentInput,
  type CollectedToolCall,
  type GeneratedReply,
  type ReplySegment,
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
  adjustInstruction,
  formatAssistExamples,
} from './assist';
