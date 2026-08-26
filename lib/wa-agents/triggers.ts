/**
 * Gatilho por mensagem recebida: escolha do agente de entrada de um número
 * (conversa sem estado: qualquer modo; conversa parada: só por palavra-chave).
 *
 * CLIENT-SAFE: só funções puras sobre AgentRow.
 */
import { findKeyword } from './text';
import { DEFAULT_AGENT_TRIGGERS, type AgentRow } from './types';

/**
 * Escolhe o agente de entrada para a mensagem recebida, segundo
 * `triggers.inbound` de cada candidato (já filtrados por número e ligados):
 * - 'none': nunca por mensagem;
 * - 'keywords': só se o texto contiver alguma palavra-chave (sem acento/caixa); tem preferência;
 * - 'any': reserva, na ordem recebida (o mais antigo primeiro).
 * Com `keywordsOnly` (conversa parada) o modo 'any' é ignorado: só a palavra-chave,
 * gatilho explícito, reabre o atendimento.
 * null quando nenhum candidato serve para esta mensagem.
 */
export function pickInboundAgent(
  agents: AgentRow[],
  text: string,
  opts: { keywordsOnly?: boolean } = {}
): AgentRow | null {
  let fallback: AgentRow | null = null;
  for (const agent of agents) {
    const inbound = agent.triggers?.inbound ?? DEFAULT_AGENT_TRIGGERS.inbound;
    if (inbound.mode === 'none') continue;
    if (inbound.mode === 'keywords') {
      if (inbound.keywords.length > 0 && findKeyword(text, inbound.keywords)) return agent;
      continue;
    }
    if (!fallback && !opts.keywordsOnly) fallback = agent;
  }
  return fallback;
}
