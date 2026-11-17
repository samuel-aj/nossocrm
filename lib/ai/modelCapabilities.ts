/** Client-safe capabilities verified for the agent model catalog. */
export const OPENAI_REASONING_MODEL_IDS = [
  'gpt-6-luna',
  'gpt-6.1-terra',
  'gpt-6-astra',
  'gpt-6.1-sol',
] as const;

/** Exact IDs needing the reasoning override in the installed OpenAI SDK. */
export function isOpenAIReasoningModel(model: string): boolean {
  return OPENAI_REASONING_MODEL_IDS.some(id => id === model);
}

/** These agent models use the provider's reasoning defaults, without temperature. */
export function supportsModelTemperature(provider: string, model: string): boolean {
  if (provider !== 'openai') return true;
  const id = model.trim();
  return !/^(gpt-5|o\d)/i.test(id) && !isOpenAIReasoningModel(id);
}
