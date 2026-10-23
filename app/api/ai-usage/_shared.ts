import { z } from 'zod';
import { json } from '@/lib/whatsapp/api';
import { guardRoute as baseGuardRoute, type GuardOptions } from '@/app/api/wa-agents/_shared';
import { getExpectedOrigin } from '@/lib/security/sameOrigin';
export { conversationUsageAccess } from '@/lib/ai-usage/access';
export { readJsonBody, validationError } from '@/app/api/wa-agents/_shared';

export async function guardRoute(options: GuardOptions = {}) {
  if (options.req) {
    const origin = options.req.headers.get('origin');
    const expected = getExpectedOrigin(options.req) ?? new URL(options.req.url).origin;
    if ((origin && origin !== expected) || options.req.headers.get('sec-fetch-site') === 'cross-site') {
      return { ok: false as const, response: json({ error: 'Origem não permitida' }, 403) };
    }
  }
  return baseGuardRoute(options);
}

export const ConversationId = z.string().uuid();
export const GrantBody = z.object({
  tokens: z.number().int().min(0).max(100_000_000), seconds: z.number().int().min(0).max(86400).optional(),
  reason: z.string().trim().min(5).max(500), idempotencyKey: z.string().uuid(),
}).strict().refine(v => v.tokens > 0 || (v.seconds ?? 0) > 0, { message: 'Informe uma quota adicional positiva', path: ['tokens'] });

export function usageError() { return json({ error: 'Não foi possível consultar ou atualizar o consumo. Tente novamente.' }, 503); }
