import type { SupabaseClient } from '@supabase/supabase-js';
import type { ModelMessage } from 'ai';
import { loadConfirmedOabRegistrations } from './oabRegistry';
import { needsOabCheck, protectOabReply } from './oabReply';
import { segmentText, type ReplySegment } from './replyOutput';
import type { GeneratedReply } from './replyGeneration';

export function lastCustomerText(messages: readonly ModelMessage[]): string | null {
  const turn = messages.findLast(message => message.role === 'user');
  if (turn?.role !== 'user') return null;
  return typeof turn.content === 'string' ? turn.content
    : turn.content.flatMap(part => part.type === 'text' ? [part.text] : []).join('\n');
}

export function oabQuestionContext(messages: readonly ModelMessage[], current = lastCustomerText(messages)): string | null {
  if (!current || needsOabCheck([], current)) return current;
  // “E qual é o número dela?” can refer to the preceding OAB exchange.
  if (!/\b(?:qual|n[uú]mero|mesm[oa]|d[ae]l[ae]|inscri[çc][ãa]o|registro|confirma|confere|\d{3,})\b/i.test(current)
    || /\b(?:telefone|whatsapp|celular|cpf|cep|casa|processo|contrato|horas?|pix)\b/i.test(current)) return current;
  for (const message of messages.slice(-4).reverse()) {
    if ((message.role !== 'user' && message.role !== 'assistant') || typeof message.content !== 'string') continue;
    if (message.content === current) continue;
    if (needsOabCheck([], message.content)) return message.content + '\n' + current;
    if (message.role === 'assistant' && /\b(?:foto|imagem|m[ií]dia|carteirinha)\b/i.test(message.content)) continue;
    break;
  }
  return current;
}

async function registrationsForReply(db: SupabaseClient, organizationId: string) {
  try {
    return await loadConfirmedOabRegistrations(db, organizationId);
  } catch {
    console.warn('[wa-agents/oab] Cadastro indisponível para conferência da inscrição.');
    return [];
  }
}

export async function oabSystemContext(db: SupabaseClient, organizationId: string, lastInbound: string | null) {
  if (!needsOabCheck([], lastInbound ?? undefined)) return '';
  const entries = await registrationsForReply(db, organizationId);
  return '\n\nInforme uma inscrição da OAB somente a partir do cadastro confirmado deste escritório. ' +
    'Use a inscrição do titular solicitado. Se não puder identificá-la, diga que precisa de confirmação. ' +
    'Inscrições confirmadas: ' + JSON.stringify(entries.map(({ professionalName, state, number }) => ({ professionalName, state, number })));
}

/** Applies after generation and again to previously queued text that is about to be delivered. */
export async function enforceOabForDelivery(
  db: SupabaseClient, organizationId: string, segments: ReplySegment[], lastInbound?: string | null,
) {
  if (!segments.length || !needsOabCheck(segments, lastInbound ?? undefined)) return { segments, adjusted: false };
  const registrations = await registrationsForReply(db, organizationId);
  return protectOabReply(segments, registrations, lastInbound ?? undefined);
}

export async function checkGeneratedOab(db: SupabaseClient, organizationId: string, reply: GeneratedReply, lastInbound: string | null): Promise<GeneratedReply> {
  if (reply.outputSafety.status === 'blocked') return reply;
  // A failed media call has no outgoing media segment. Its text fallback can
  // still be a registration claim ("o número dela é ...").
  const attemptedOabMedia = reply.toolCalls.some(call => {
    if (call.tool !== 'enviar_midia' || !call.input || typeof call.input !== 'object' || !('nome' in call.input)) return false;
    return typeof call.input.nome === 'string' && needsOabCheck([{ kind: 'media', name: call.input.nome }]);
  });
  const context = attemptedOabMedia ? [lastInbound, 'OAB'].filter(Boolean).join('\n') : lastInbound;
  const checked = await enforceOabForDelivery(db, organizationId, reply.segments, context);
  if (!checked.adjusted) return reply;
  return { ...reply, segments: checked.segments, text: checked.segments.map(segmentText).filter(Boolean).join('\n'),
    outputSafety: { ...reply.outputSafety, status: 'repaired', oabReplyAdjusted: true } };
}
