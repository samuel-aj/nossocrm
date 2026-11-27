import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AgentDocumentRow } from '@/lib/wa-agents/types';
import type { KnowledgeGapRow } from '@/lib/wa-agents/knowledgeGapsShared';

const toast = vi.hoisted(() => vi.fn());
vi.mock('@/context/ToastContext', () => ({ useToast: () => ({ showToast: toast }) }));
vi.mock('@/components/ConfirmModal', () => ({ default: () => null }));

import { KnowledgeGapsPanel } from './KnowledgeGapsPanel';

const agentId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const gapId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const docId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const conversationId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const revision = '2026-11-27T15:03:00.123456+00:00';
const clients: QueryClient[] = [];
let gaps: KnowledgeGapRow[];
let writes: Array<Record<string, unknown>>;

function doc(overrides: Partial<AgentDocumentRow> = {}): AgentDocumentRow {
  return {
    id: docId, organization_id: 'org', agent_id: agentId, name: 'Pacotes.pdf', mime: 'application/pdf', size_bytes: 10,
    storage_path: 'org/agents/a/docs/x_Pacotes.pdf', status: 'ready', error: null, chunk_count: 3, title: 'Pacotes',
    created_at: '', updated_at: '', ...overrides,
  };
}

function gap(overrides: Partial<KnowledgeGapRow> = {}): KnowledgeGapRow {
  return {
    id: gapId, organization_id: 'org', agent_id: agentId, status: 'open', question: 'Qual o nome do hotel no pacote do Rio?',
    context: 'A base cita hotel 3 estrelas, sem o nome.', suggested_answer: 'Hotel 3 estrelas em Copacabana.', answer: null,
    document_id: null, suggested_document_id: docId, occurrences: 3, test_only: true, last_conversation_id: conversationId,
    first_seen_at: new Date(Date.now() - 3_600_000).toISOString(), last_seen_at: new Date(Date.now() - 120_000).toISOString(),
    reviewed_by: null, reviewed_at: null, created_at: '', updated_at: revision, ...overrides,
  };
}

function mount(props: Partial<React.ComponentProps<typeof KnowledgeGapsPanel>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  clients.push(client);
  const onOpenSettings = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <KnowledgeGapsPanel agentId={agentId} enabled documents={[doc()]} onOpenSettings={onOpenSettings} {...props} />
    </QueryClientProvider>,
  );
  return { onOpenSettings };
}

beforeEach(() => {
  toast.mockClear();
  writes = [];
  gaps = [gap()];
  // Toda a rede é atendida aqui; nenhuma chamada ao CRM.
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    if (path.includes('/knowledge-gaps?status=')) {
      const status = new URL(path, 'http://localhost').searchParams.get('status');
      const count = (s: string) => gaps.filter(g => g.status === s).length;
      return Response.json({
        gaps: gaps.filter(g => g.status === status),
        counts: { open: count('open'), included: count('included'), ignored: count('ignored') },
        learned_by_document: {},
      });
    }
    if (path.endsWith(`/knowledge-gaps/${gapId}`) && init?.method === 'PATCH') {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      writes.push(body);
      gaps = gaps.map(g => (g.id === gapId ? { ...g, status: body.action === 'ignore' ? 'ignored' : 'included' } : g));
      return Response.json({ gap: gaps[0] });
    }
    throw new Error(`Unexpected network request: ${path}`);
  }));
});

afterEach(() => {
  cleanup();
  clients.splice(0).forEach(client => client.clear());
  vi.unstubAllGlobals();
});

describe('KnowledgeGapsPanel', () => {
  it('com a opção desligada e sem dúvidas, mostra como ligar', async () => {
    gaps = [];
    const view = mount({ enabled: false });
    fireEvent.click(await screen.findByRole('button', { name: 'Abrir Ações e recursos' }));
    expect(view.onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it('lista a dúvida com ocorrências, marca de teste e link da conversa', async () => {
    mount();
    expect(await screen.findByText('Qual o nome do hotel no pacote do Rio?')).toBeTruthy();
    expect(screen.getByText('Perguntada 3x · última há 2 min')).toBeTruthy();
    expect(screen.getByText('Só no teste')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Ver conversa/ }).getAttribute('href')).toBe(`/chats?conversation=${conversationId}`);
    expect(screen.getByRole('radio', { name: 'Abertas (1)' })).toBeTruthy();
  });

  it('responder abre o rascunho do agente e inclui no documento sugerido', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Responder' }));
    const resposta = (await screen.findByLabelText('Resposta')) as HTMLTextAreaElement;
    expect(resposta.value).toBe('Hotel 3 estrelas em Copacabana.');
    expect(screen.getByText('A base cita hotel 3 estrelas, sem o nome.')).toBeTruthy();
    fireEvent.change(resposta, { target: { value: 'Hotel Mar Azul, em Copacabana.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Incluir na base' }));
    await waitFor(() => expect(writes).toEqual([
      { action: 'include', expected_updated_at: revision, question: 'Qual o nome do hotel no pacote do Rio?', answer: 'Hotel Mar Azul, em Copacabana.', document_id: docId },
    ]));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Resposta incluída na base', 'success'));
  });

  it('sem documento pronto, a resposta vai para o novo documento Respostas aprendidas', async () => {
    mount({ documents: [doc({ status: 'processing' })] });
    fireEvent.click(await screen.findByRole('button', { name: 'Responder' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Incluir na base' }));
    await waitFor(() => expect(writes).toEqual([
      { action: 'include', expected_updated_at: revision, question: 'Qual o nome do hotel no pacote do Rio?', answer: 'Hotel 3 estrelas em Copacabana.', create_document: true },
    ]));
  });

  it('ignorar manda a ação e avisa', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Ignorar' }));
    await waitFor(() => expect(writes).toEqual([{ action: 'ignore', expected_updated_at: revision }]));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Dúvida ignorada', 'success'));
  });
});
