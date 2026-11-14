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
import { createUsageContext } from '@/lib/ai-usage/budget';
import { runWithUsageContext } from '@/lib/ai-usage/context';
import { synthesizeVoice } from '@/lib/wa-agents/voice';
import { json } from '@/lib/whatsapp/api';
import { isValidUUID } from '@/lib/supabase/utils';
import { loadAgent, normalizeAgentRow } from '@/lib/wa-agents/context';
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
  // true requests the editor's fixed voice sample; a string previews the exact simulator line.
  previewVoice: z.union([z.literal(true), z.string().trim().min(1).max(8000)]).optional(),
  signatureEvent: z.literal('signed').optional(),
  contractState: z.enum(['invited','signed']).optional(),
  messages: z
    .array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().max(8000), audio: z.boolean().optional(), contractReviewKey: z.string().regex(/^[a-f0-9]{64}$/).optional(), media: z.array(z.string().min(1).max(80)).max(100).optional() }))
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
  const auth = await guardRoute({ req, admin: true, agents: true });
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;
  const newAgent = id === 'new';
  if (!newAgent && !isValidUUID(id)) return json({ error: 'ID inválido' }, 400);
  const orgId = auth.user.organizationId;

  const rawBody = await readJsonBody(req);
  const parsed = BodySchema.safeParse(rawBody);
  if (!parsed.success) return validationError(parsed.error);

  // loadAgent normaliza a linha (jsonb validado, números coeridos)
  if (newAgent && !parsed.data.previewVoice) return json({ error: 'Salve o agente para testar a conversa.' }, 400);
  const saved = newAgent ? normalizeAgentRow({ id, organization_id: orgId }) : await loadAgent(auth.admin, orgId, id);
  if (!saved) return json({ error: 'Agente não encontrado' }, 404);
  const agent = withDraft(saved, rawBody, parsed.data.draft as Partial<AgentRow> | undefined);

  try {
    if (parsed.data.previewVoice) {
      const script = parsed.data.previewVoice === true ? null : parsed.data.previewVoice;
      const scope = await createUsageContext(auth.admin, { organizationId: orgId, agentId: newAgent ? null : id, scope: 'test' });
      const audio = await runWithUsageContext(scope, () => synthesizeVoice(auth.admin, agent, script));
      if (!audio.bytes) return json({ error: audio.reason }, 422);
      return Response.json({ audio: audio.bytes.toString('base64') }, { headers: { 'Cache-Control': 'no-store' } });
    }
    const result = await testAgentReply(auth.admin, {
      organizationId: orgId,
      agent,
      messages: parsed.data.messages,
      state: parsed.data.state,
      signatureEvent: parsed.data.signatureEvent,
      contractState: parsed.data.contractState,
    });
    return json(result);
  } catch (err) {
    if (err instanceof WaAgentError) return json({ error: err.message, code: err.code }, 400);
    console.error('[wa-agents/test]', err);
    return json({ error: getErrorMessage(err, 'Falha ao testar o agente') }, 500);
  }
}
