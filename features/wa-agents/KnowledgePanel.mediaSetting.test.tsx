import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AgentMediaRow } from '@/lib/wa-agents/types';

const toast = vi.hoisted(() => vi.fn());
vi.mock('@/context/ToastContext', () => ({ useToast: () => ({ showToast: toast }) }));
vi.mock('@/components/ConfirmModal', () => ({ default: () => null }));

import { KnowledgePanel } from './KnowledgePanel';

const agentId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const mediaId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
let saved: AgentMediaRow;
let rejectPatch: boolean;
let writes: Array<{ path: string; body: Record<string, unknown> }>;
const clients: QueryClient[] = [];

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  clients.push(client);
  const onInsertMedia = vi.fn();
  const onRenameMedia = vi.fn();
  const view = render(
    <QueryClientProvider client={client}>
      <KnowledgePanel agentId={agentId} onInsertMedia={onInsertMedia} onRenameMedia={onRenameMedia} onRequestSave={vi.fn()} saving={false} />
    </QueryClientProvider>,
  );
  return { ...view, onInsertMedia, onRenameMedia };
}

const setting = () => screen.findByRole('checkbox', { name: /Enviar apenas uma vez por conversa/ });

beforeEach(() => {
  toast.mockClear();
  rejectPatch = false;
  writes = [];
  saved = {
    id: mediaId, agent_id: agentId, organization_id: 'org', name: 'boas vindas', description: 'Na chegada',
    kind: 'video', mime: 'video/mp4', size_bytes: 10, storage_path: 'org/agent/video.mp4',
    created_at: '2026-11-14T10:00:00Z', send_once_per_conversation: true,
  };
  // All traffic is served here; no CRM, media provider or storage connection is used.
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    if (path.endsWith('/documents')) return Response.json({ documents: [] });
    if (path.endsWith(`/media/${mediaId}`) && init?.method === 'PATCH') {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      writes.push({ path, body });
      if (rejectPatch) return Response.json({ error: 'Não foi possível salvar' }, { status: 500 });
      saved = { ...saved, ...body };
      return Response.json({ media: saved });
    }
    if (path.endsWith('/media')) return Response.json({ media: [saved] });
    throw new Error(`Unexpected network request: ${path}`);
  }));
});

afterEach(() => {
  cleanup();
  clients.splice(0).forEach(client => client.clear());
  vi.unstubAllGlobals();
});

describe('media repetition checkbox with persisted API state', () => {
  it.each([undefined, true, false])('renders legacy/current preference %s without writing the agent or media', async value => {
    saved.send_once_per_conversation = value;
    const view = mount();
    const checkbox = await setting();
    if (value === false) expect(checkbox).not.toBeChecked();
    else expect(checkbox).toBeChecked();
    expect(writes).toEqual([]);
    expect(view.onInsertMedia).not.toHaveBeenCalled();
    expect(view.onRenameMedia).not.toHaveBeenCalled();
  });

  it('saves only the checkbox, renders the returned value, and keeps it after reopening', async () => {
    const view = mount();
    fireEvent.click(await setting());
    await waitFor(() => expect(screen.getByRole('checkbox')).not.toBeChecked());
    expect(writes).toEqual([{
      path: `/api/wa-agents/agents/${agentId}/media/${mediaId}`, body: { send_once_per_conversation: false },
    }]);
    expect(view.onInsertMedia).not.toHaveBeenCalled();
    expect(view.onRenameMedia).not.toHaveBeenCalled();
    view.unmount();
    mount();
    expect(await setting()).not.toBeChecked();
  });

  it('keeps the saved preference and reports an error when the PATCH fails', async () => {
    rejectPatch = true;
    mount();
    fireEvent.click(await setting());
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Não foi possível salvar', 'error'));
    expect(screen.getByRole('checkbox')).toBeChecked();
    expect(screen.getByRole('checkbox')).toBeEnabled();
    expect(saved.send_once_per_conversation).toBe(true);
  });

  it('renames a media without changing its disabled repetition protection', async () => {
    saved.send_once_per_conversation = false;
    const view = mount();
    await setting();
    const name = screen.getByRole('textbox', { name: 'Nome da mídia' });
    fireEvent.change(name, { target: { value: 'saudacao' } });
    fireEvent.blur(name);
    await waitFor(() => expect(view.onRenameMedia).toHaveBeenCalledWith('boas vindas', 'saudacao'));
    expect(writes[0].body).toEqual({ name: 'saudacao' });
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    expect(saved.send_once_per_conversation).toBe(false);
  });
});
