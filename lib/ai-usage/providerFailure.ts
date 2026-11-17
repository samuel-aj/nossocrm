import { APICallError } from 'ai';

const OPENAI_BILLING_CODES = new Set([
  'insufficient_quota',
  'credit_balance_exhausted',
  'organization_usage_limit_exceeded',
]);

export type ProviderBillingRejection = {
  reason: 'provider_insufficient_quota';
  evidenceVersion: 'openai-quota-v1';
  providerStatusCode: 429;
  providerErrorCode?: string;
  providerErrorType?: string;
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

/** Only an explicit HTTP billing rejection proves that this request was refused.
 * A timeout, generic 429, or matching text in an ordinary Error is not evidence.
 * OpenAI SDK 3 preserves the parsed error in data; responseBody covers its
 * fallback response handler. Never persist either payload, headers or prompts.
 */
export function providerBillingRejection(error: unknown, provider: string): ProviderBillingRejection | null {
  if (provider !== 'openai' || !APICallError.isInstance(error) || error.statusCode !== 429) return null;
  let data = record(error.data);
  if (!data && error.responseBody && error.responseBody.length <= 16_384) {
    try { data = record(JSON.parse(error.responseBody)); } catch { return null; }
  }
  const detail = record(data?.error);
  if (!detail) return null;
  const code = detail.code;
  const type = detail.type;
  if (code != null) {
    if (typeof code !== 'string' || !OPENAI_BILLING_CODES.has(code)) return null;
  } else if (type !== 'insufficient_quota') return null;
  return {
    reason: 'provider_insufficient_quota', evidenceVersion: 'openai-quota-v1', providerStatusCode: 429,
    ...(typeof code === 'string' ? { providerErrorCode: code } : {}),
    // Only the understood type is useful evidence; never copy an arbitrary provider value.
    ...(type === 'insufficient_quota' ? { providerErrorType: type } : {}),
  };
}
