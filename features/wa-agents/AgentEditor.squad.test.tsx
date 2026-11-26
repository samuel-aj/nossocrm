// @vitest-environment happy-dom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AgentInputSchema, type AgentPublic } from '@/lib/wa-agents/types';
import { AgentEditor } from './AgentEditor';
import { toAgentInput } from './AgentList';

vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ profile: { organization_id: 'escritorio-teste', role: 'admin' } }) }));
vi.mock('@/context/ToastContext', () => ({ useToast: () => ({ showToast: vi.fn(), addToast: vi.fn() }) }));
vi.mock('./AgentContractSetting', () => ({ AgentContractSetting: () => null }));

const agent: AgentPublic = {
  ...AgentInputSchema.parse({ name: 'Agente fictício', provider: 'openai', model: 'gpt-4.1', system_prompt: 'Roteiro da tela' }),
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', organization_id: 'escritorio-teste',
  created_at: '2026-11-26', updated_at: '2026-11-26', has_api_key: false, has_audio_api_key: false,
};
let cache: QueryClient;
beforeEach(() => {
  cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  window.history.replaceState({}, '', '#roteiro');
});
afterEach(() => {
  cleanup();
  cache.clear();
  vi.unstubAllGlobals();
});

it.each([false, true])('salva a mudança de monitoramento a partir de %s sem reenviar o roteiro aberto', async initial => {
  const patches: Record<string, unknown>[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === `/api/wa-agents/agents/${agent.id}` && init?.method === 'PATCH') {
      const patch = JSON.parse(String(init.body));
      patches.push(patch);
      return Response.json({ agent: { ...agent, ...patch } });
    }
    return Response.json({});
  }));
  render(<QueryClientProvider client={cache}><AgentEditor agent={{ ...agent, squad_monitoring: initial }} onClose={vi.fn()} /></QueryClientProvider>);
  const toggle = screen.getByRole('checkbox', { name: 'Monitorar com o squad' }) as HTMLInputElement;
  expect(toggle.checked).toBe(initial);
  fireEvent.click(toggle);
  fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
  await waitFor(() => expect(patches).toHaveLength(1));
  expect(patches[0].squad_monitoring).toBe(!initial);
  expect(patches[0]).not.toHaveProperty('system_prompt');
  expect(patches[0]).not.toHaveProperty('stop_rules');
});

it('exige uma escolha individual para cada agente, inclusive cópias', () => {
  expect(agent.squad_monitoring).toBe(false);
  const copied = toAgentInput({ ...agent, squad_monitoring: true });
  expect(AgentInputSchema.parse(copied).squad_monitoring).toBe(false);
});
