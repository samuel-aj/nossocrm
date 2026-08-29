/**
 * POST /api/wa-agents/agents/[id]/test  (admin)
 * body { messages: [{ role: 'user'|'assistant', text }], state?, draft? }
 *
 * Gera a resposta do agente em modo de teste: nada é enviado pelo WhatsApp e
 * nenhuma ação de encerramento é executada -> { text, lines, toolCalls, usage }
 *
 * `draft` é a configuração que está NA TELA (roteiro, modelo, regras, ações):
 * o teste roda com ela por cima da linha salva, para o admin experimentar antes
 * de salvar. Só o que veio no corpo é aplicado; id, organização e a chave da API
 * salva continuam vindo do banco.
 */
import { z } from 'zod';
import { json } from '@/lib/whatsapp/api';
import { isValidUUID } from '@/lib/supabase/utils';
import { loadAgent } from '@/lib/wa-agents/context';
import { WaAgentError } from '@/lib/wa-agents/errors';
import { agentWithDraft, testAgentReply } from '@/lib/wa-agents/test';
import { AgentInputSchema, type AgentRow } from '@/lib/wa-agents/types';
import {
  getErrorMessage,
  guardRoute,
  normalizeApiKeyInput,
  pickPresentKeys,
  readJsonBody,
  restoreMaskedSecrets,
  validationError,
} from '../../../_shared';

export const runtime = 'nodejs';
/** Resposta com auxiliares (cada um é outra chamada ao modelo) e conhecimento passa de 60 s */
export const maxDuration = 120;

const BodySchema = z.object({
  messages: z
    .array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().max(8000) }))
    .max(200)
    .default([]),
  state: z.record(z.string(), z.unknown()).optional(),
  /** Configuração que está na tela (ainda não salva) */
  draft: AgentInputSchema.partial().optional(),
});

/** Rascunho da tela por cima do agente salvo (segredos mascarados voltam ao salvo). */
function withDraft(saved: AgentRow, rawBody: unknown, draft: Partial<AgentRow> | undefined): AgentRow {
  if (!draft) return saved;
  const raw = rawBody && typeof rawBody === 'object' ? (rawBody as { draft?: unknown }).draft : undefined;
  const present = pickPresentKeys(raw, draft as Record<string, unknown>);
  const restored = restoreMaskedSecrets(present, saved) as Partial<AgentRow>;
  const apiKey = 'api_key' in present ? normalizeApiKeyInput(present.api_key as string | null | undefined) : undefined;
  return agentWithDraft(saved, restored, { presentKeys: Object.keys(present), apiKey });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await guardRoute({ req, admin: true });
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;
  if (!isValidUUID(id)) return json({ error: 'ID inválido' }, 400);
  const orgId = auth.user.organizationId;

  const rawBody = await readJsonBody(req);
  const parsed = BodySchema.safeParse(rawBody);
  if (!parsed.success) return validationError(parsed.error);

  // loadAgent normaliza a linha (jsonb validado, números coeridos)
  const saved = await loadAgent(auth.admin, orgId, id);
  if (!saved) return json({ error: 'Agente não encontrado' }, 404);
  const agent = withDraft(saved, rawBody, parsed.data.draft as Partial<AgentRow> | undefined);

  try {
    const result = await testAgentReply(auth.admin, {
      organizationId: orgId,
      agent,
      messages: parsed.data.messages,
      state: parsed.data.state,
    });
    return json(result);
  } catch (err) {
    if (err instanceof WaAgentError) return json({ error: err.message, code: err.code }, 400);
    console.error('[wa-agents/test]', err);
    return json({ error: getErrorMessage(err, 'Falha ao testar o agente') }, 500);
  }
}
