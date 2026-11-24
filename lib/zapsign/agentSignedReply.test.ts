import type { ModelMessage } from 'ai';
import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConversationContext } from '@/lib/wa-agents/context';
import type { AgentRow } from '@/lib/wa-agents/types';
import { composeSignedReply } from './agentSignedReply';

const mocks = vi.hoisted(() => ({ generate: vi.fn(), registrations: vi.fn() }));
vi.mock('ai', () => ({ generateText: mocks.generate }));
vi.mock('@/lib/ai-usage/context', () => ({ assertUsageHealthy: vi.fn() }));
vi.mock('@/lib/wa-agents/context', () => ({ buildSystemPrompt: () => '' }));
vi.mock('@/lib/wa-agents/model', () => ({ resolveAgentModel: async () => ({ model: {} }) }));
vi.mock('@/lib/wa-agents/oabRegistry', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/wa-agents/oabRegistry')>(),
  loadConfirmedOabRegistrations: mocks.registrations,
}));

const db = {} as SupabaseClient;
const agent = { organization_id: 'office' } as AgentRow;
const ctx = { org: { id: 'office', name: 'Escritório de teste' } } as ConversationContext;
const registration = { id: '00000000-0000-4000-8000-000000000001', professionalName: 'Ana Exemplo', state: 'SP', number: '12345' };
const history: ModelMessage[] = [{ role: 'user', content: 'Qual é a OAB da Dra. Ana Exemplo?' }];

describe('OAB no acompanhamento de uma assinatura já confirmada', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('mantém o aviso de assinatura quando a resposta cita uma inscrição confirmada do escritório', async () => {
    const text = 'Parabéns pela assinatura! A OAB/SP 12.345 é da Dra. Ana Exemplo.';
    mocks.generate.mockResolvedValue({ text });
    mocks.registrations.mockResolvedValue([registration]);
    const notice = await composeSignedReply(db, agent, ctx, history, true);
    expect(notice).toMatch(/assinatura/i);
    expect(notice).toMatch(/OAB\/SP 12345/);
    expect(mocks.registrations).toHaveBeenCalledWith(db, agent.organization_id);
  });

  it.each([
    ['inscrição divergente', 'Parabéns pela assinatura! A OAB/SP 98.765 é da Dra. Ana Exemplo.', [registration]],
    ['número isolado em resposta ao cliente, sem inscrição confirmada', '98765', []],
  ])('confirma a assinatura sem divulgar %s', async (_label, text, registrations) => {
    mocks.generate.mockResolvedValue({ text });
    mocks.registrations.mockResolvedValue(registrations);
    const notice = await composeSignedReply(db, agent, ctx, history, true);
    expect(notice).toContain('assinatura');
    expect(notice).not.toMatch(/98\.?765/);
    if (registrations.length) expect(notice).toContain('OAB/SP 12345');
    else expect(notice).not.toMatch(/\d/);
  });
});
