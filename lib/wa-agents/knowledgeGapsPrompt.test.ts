import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { buildSystemPrompt, KNOWLEDGE_GAP_PROMPT_LINE, normalizeAgentRow } from './context';
import { buildTestContext } from './test';

function prompt(tools: Record<string, unknown>, knowledgeGaps: boolean): string {
  const agent = normalizeAgentRow({ id: 'agent', organization_id: 'org', system_prompt: 'Atenda o cliente.', tools });
  const ctx = buildTestContext({ organizationId: 'org', organizationName: 'Teste', agent });
  return buildSystemPrompt({ agent, ctx, knowledgeGaps });
}

describe('linha de dúvidas sem resposta no prompt', () => {
  it('entra só com a opção ligada no agente e a ferramenta disponível na geração', () => {
    expect(prompt({ calculator: true, knowledge_gaps: true }, true)).toContain(KNOWLEDGE_GAP_PROMPT_LINE);
    expect(prompt({ calculator: true, knowledge_gaps: true }, false)).not.toContain('registrar_duvida_sem_resposta');
    expect(prompt({ calculator: true }, true)).not.toContain('registrar_duvida_sem_resposta');
  });
});
