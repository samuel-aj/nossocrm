import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AgentInputSchema, type AgentPublic } from '@/lib/wa-agents/types';
import { UserRole } from '@/types/constants';
import { AgentEditor } from './AgentEditor';

const auth = vi.hoisted(() => ({ profile: { organization_id: 'org-teste', role: 'admin' } }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('@/context/ToastContext', () => ({ useToast: () => ({ showToast: vi.fn(), addToast: vi.fn() }) }));
vi.mock('./AgentContractSetting', () => ({ AgentContractSetting: () => null }));

const agent: AgentPublic = {
  ...AgentInputSchema.parse({ name: 'Agente fictício', provider: 'openai', model: 'gpt-4.1' }),
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', organization_id: 'org-teste',
  created_at: '2026-11-26', updated_at: '2026-11-26', has_api_key: false, has_audio_api_key: false,
};
let cache: QueryClient;
const oabRequests: Array<string | null> = [];

beforeEach(() => {
  auth.profile = { organization_id: agent.organization_id, role: UserRole.ADMIN };
  oabRequests.length = 0;
  cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  window.history.replaceState({}, '', '#roteiro');
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === '/api/org/oab') {
      oabRequests.push(new Headers(init?.headers).get('x-org-id'));
      return Response.json({ registrations: [{ id: 'oab-teste', professionalName: 'Ana Exemplo', state: 'MS', number: '12345' }] });
    }
    if (String(input).startsWith('/api/wa-agents/')) return Response.json({});
    throw new Error('Requisição inesperada no editor: ' + input);
  }));
});

afterEach(() => {
  cleanup();
  cache.clear();
  vi.unstubAllGlobals();
});

function openKnowledge(editing: AgentPublic | null) {
  render(<QueryClientProvider client={cache}><AgentEditor agent={editing} onClose={vi.fn()} /></QueryClientProvider>);
  expect(oabRequests).toEqual([]);
  fireEvent.click(screen.getByRole('tab', { name: /Conhecimento/ }));
  return within(screen.getByRole('tabpanel', { name: /Conhecimento/ }));
}

it.each([
  ['existente', agent, UserRole.ADMIN],
  ['novo', null, UserRole.SUPER_ADMIN],
] as const)('mostra o cadastro do escritório ao abrir Conhecimento de um agente %s', async (_label, editing, role) => {
  auth.profile.role = role;
  const tab = openKnowledge(editing);
  expect(tab.getByRole('heading', { name: 'Base de conhecimento' })).toBeVisible();
  expect(tab.getByRole('heading', { name: 'Inscrições da OAB' })).toBeVisible();
  if (editing) expect(tab.getByRole('heading', { name: 'Dúvidas sem resposta' })).toBeVisible();
  expect(await tab.findByText('Ana Exemplo · OAB/MS 12345')).toBeVisible();
  expect(oabRequests).toEqual([agent.organization_id]);
});

it.each([
  [UserRole.VENDEDOR, agent.organization_id],
  [UserRole.ADMIN, 'outro-escritorio'],
])('protege as inscrições para o perfil %s no escritório %s', (role, organizationId) => {
  auth.profile = { role, organization_id: organizationId };
  const tab = openKnowledge(agent);
  expect(tab.queryByRole('heading', { name: 'Inscrições da OAB' })).toBeNull();
  expect(oabRequests).toEqual([]);
});
