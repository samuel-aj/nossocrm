import { generateText, type ModelMessage } from 'ai';
import type { SupabaseClient } from '@supabase/supabase-js';
import { assertUsageHealthy } from '@/lib/ai-usage/context';
import { buildSystemPrompt, type ConversationContext } from '@/lib/wa-agents/context';
import { resolveAgentModel } from '@/lib/wa-agents/model';
import { internalOutputReason } from '@/lib/wa-agents/replyOutput';
import type { AgentRow } from '@/lib/wa-agents/types';

/** Runs inside the caller's metered conversation or simulation. No side-effect tools. */
export async function composeSignedReply(db: SupabaseClient, agent: AgentRow, ctx: ConversationContext, history: ModelMessage[], allSigned: boolean) {
  const model = await resolveAgentModel(db, agent.organization_id, agent, 'zapsign_signed');
  const fact = allSigned ? 'A ZapSign confirmou a assinatura completa do documento.' :
    'A ZapSign confirmou a assinatura do cliente. Ainda há outros signatários pendentes.';
  const result = await generateText({ model: model.model, maxRetries: 0, maxOutputTokens: 260, abortSignal: AbortSignal.timeout(30_000),
    system: buildSystemPrompt({ agent, ctx }) + '\nEvento confirmado da ZapSign: ' + fact +
      ' Escreva apenas uma mensagem curta ao cliente na voz deste agente. Parabenize pela assinatura e acompanhe o cliente. Oriente o próximo passo apenas se consta do roteiro ou da conversa. Não prometa prazos, não solicite nova assinatura nem inclua links.',
    messages: [...history, { role:'user',content:'[Evento interno do CRM: a ZapSign confirmou a assinatura do cliente. Redija o acompanhamento.]' }],
  });
  assertUsageHealthy();
  const text = result.text.trim();
  return text && !internalOutputReason(text) && !text.includes('[SEM_RESPOSTA]') && !/https?:\/\//i.test(text) ? text :
    'Parabéns pela assinatura! Recebi a confirmação da ZapSign. Posso ajudar com alguma dúvida sobre os próximos passos?';
}
