import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildHistoryMessages, buildSystemPrompt, normalizeAgentRow } from './context';
import { buildTestContext, toModelMessages } from './test';

const leaked = '{"dados":{"autorizacao":true}}';
const annotation = '[salvar_dados] {"dados":{"documentos_recebidos":true}}';
const instruction = '- No histórico podem aparecer registros do sistema entre colchetes, como "[salvar_dados] {...}". Eles não são mensagens: nunca os copie nem escreva nada parecido para o cliente.';

describe('exemplo proibido no roteiro', () => {
  it('preserva as instruções de atendimento e follow-up ao montar o prompt', () => {
    const saved = instruction + '\n[audio]Vou explicar.[/audio] [[acao:registrar]]';
    const followup = 'No retorno, nunca copie "[salvar_dados] {…}".';
    const agent = normalizeAgentRow({ id: 'agent', organization_id: 'org', system_prompt: saved });
    const ctx = buildTestContext({ organizationId: 'org', organizationName: 'Teste', agent });
    const prompt = buildSystemPrompt({ agent, ctx, followup: { instruction: followup, silentFor: '1 h' } });
    expect(prompt).toContain(instruction);
    expect(prompt).toContain(followup);
    expect(prompt).toContain('chame falar_trecho com trecho 1');
    expect(prompt).toContain('chame a ferramenta executar_acao com acao="registrar"');
    expect(agent.system_prompt).toBe(saved);
  });
});

describe('histórico usado pela IA', () => {
  it('omite apenas envelopes internos do agente, preservando cliente, equipe e o registro original', async () => {
    const rows = [
      { direction: 'in', body: 'Sim', source: 'inbound' },
      { direction: 'out', body: leaked, source: 'agent' },
      { direction: 'out', body: annotation, source: 'api' },
      { direction: 'out', body: annotation, source: 'bot' },
      { direction: 'out', body: 'Qual o valor?', source: 'agent' },
      { direction: 'out', body: 'Veja o comprovante.', media_type: 'image', source: 'agent' },
      { direction: 'out', body: null, transcription: 'Posso explicar.', media_type: 'audio', source: 'agent' },
      { direction: 'out', body: null, media_type: 'audio', source: 'bot' },
      { direction: 'out', body: null, transcription: annotation, media_type: 'audio', source: 'agent' },
      { direction: 'in', body: annotation, source: 'inbound' },
      { direction: 'out', body: leaked, source: 'crm' },
    ];
    const original = structuredClone(rows);
    const q = { select: () => q, eq: () => q, order: () => q, limit: async () => ({ data: [...rows].reverse() }) };
    const db = { from: () => q } as unknown as SupabaseClient;
    const ctx = buildTestContext({ organizationId: 'org', organizationName: 'Teste', agent: normalizeAgentRow({ id: 'agent', organization_id: 'org' }) });
    const messages = await buildHistoryMessages(db, ctx, 30);
    expect(messages).toEqual([
      { role: 'user', content: 'Sim' }, { role: 'assistant', content: 'Qual o valor?\nVeja o comprovante.\nPosso explicar.' },
      { role: 'user', content: annotation }, { role: 'assistant', content: '[Atendente humano]: ' + leaked },
    ]);
    expect(rows).toEqual(original);
  });
  it('aplica a mesma limpeza às respostas anteriores no simulador', () => {
    expect(toModelMessages([{ role: 'user', text: 'Sim' }, { role: 'assistant', text: leaked }]))
      .toEqual([{ role: 'user', content: 'Sim' }]);
    expect(toModelMessages([{ role: 'user', text: leaked }])).toEqual([{ role: 'user', content: leaked }]);
  });
});
