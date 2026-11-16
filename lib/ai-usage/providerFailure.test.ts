// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { APICallError } from 'ai';
import { providerBillingRejection } from './providerFailure';

const message = 'You have no credits remaining. Add credits to continue using the API at https://platform.openai.com/settings/organization/billing/.';
const apiError = (detail: Record<string, unknown>, statusCode = 429) => new APICallError({
  message, url: 'https://api.openai.com/v1/responses', requestBodyValues: { prompt: 'private fixture' },
  statusCode, data: { error: detail }, responseHeaders: { authorization: 'private fixture' },
});

describe('definitive provider billing rejection', () => {
  it.each(['insufficient_quota', 'credit_balance_exhausted', 'organization_usage_limit_exceeded'])('recognizes OpenAI HTTP 429 with code %s and emits only evidence', code => {
    expect(providerBillingRejection(apiError({ code, type: 'insufficient_quota', message }), 'openai')).toEqual({
      reason: 'provider_insufficient_quota', evidenceVersion: 'openai-quota-v1', providerStatusCode: 429,
      providerErrorCode: code, providerErrorType: 'insufficient_quota',
    });
  });

  it('supports a typed rejection without a code and the SDK raw-response fallback', () => {
    expect(providerBillingRejection(apiError({ type: 'insufficient_quota', code: null }), 'openai'))
      .toMatchObject({ providerErrorType: 'insufficient_quota' });
    const error = new APICallError({ message, url: 'https://api.openai.com/v1/responses', requestBodyValues: {},
      statusCode: 429, responseBody: JSON.stringify({ error: { code: 'credit_balance_exhausted' } }) });
    expect(providerBillingRejection(error, 'openai')).toMatchObject({ providerErrorCode: 'credit_balance_exhausted' });
  });

  it.each([
    apiError({ code: 'rate_limit_exceeded', type: 'insufficient_quota' }),
    apiError({ code: 'new_unknown_error', type: 'insufficient_quota' }),
    apiError({ code: 429, type: 'insufficient_quota' }),
    apiError({ type: 'rate_limit_exceeded', message }),
    apiError({ message }),
    apiError({ code: 'insufficient_quota' }, 500),
    apiError({ code: 'insufficient_quota' }, 503),
    apiError({ code: 'insufficient_quota' }, 200),
    new Error(message),
    new Error('timeout'),
  ])('does not interpret ambiguous failures or matching text as zero consumption', error => {
    expect(providerBillingRejection(error, 'openai')).toBeNull();
  });

  it('does not apply OpenAI evidence to another provider or override contradictory parsed data', () => {
    expect(providerBillingRejection(apiError({ code: 'insufficient_quota' }), 'google')).toBeNull();
    const error = new APICallError({ message, url: 'https://api.openai.com/v1/responses', requestBodyValues: {}, statusCode: 429,
      data: { error: { code: 'rate_limit_exceeded' } }, responseBody: JSON.stringify({ error: { code: 'insufficient_quota' } }) });
    expect(providerBillingRejection(error, 'openai')).toBeNull();
  });
});
