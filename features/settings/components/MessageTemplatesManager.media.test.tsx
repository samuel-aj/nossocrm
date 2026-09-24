import React from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MessageTemplatesManager } from './MessageTemplatesManager';

vi.mock('@/context/ToastContext', () => ({ useToast: () => ({ addToast: vi.fn() }) }));
vi.mock('./TemplateMediaUpload', () => ({
  TemplateMediaUpload: ({ onUploaded, onBusy }: {
    onUploaded: (id: string) => void;
    onBusy: (busy: boolean) => void;
  }) => <div>
    <button onClick={() => onUploaded('asset-from-cloud')}>Concluir upload</button>
    <button onClick={() => onBusy(true)}>Iniciar upload</button>
  </div>,
}));

const cloud = { id: 'cloud', provider: 'meta_cloud', status: 'connected', phoneNumber: '+5511111111111' };
const evolution = { id: 'evolution', provider: 'evolution_business', status: 'connected', phoneNumber: '+5522222222222' };
const cloudTwo = { ...cloud, id: 'cloud-two', phoneNumber: '+5533333333333' };

beforeEach(() => { vi.unstubAllGlobals(); Element.prototype.scrollIntoView = vi.fn(); });

async function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(['messageTemplates'], { data: [] });
  client.setQueryData(['waConnection'], { connected: true, connection: cloud, connections: [cloud, evolution, cloudTwo] });
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [] }) });
  vi.stubGlobal('fetch', fetcher);
  render(<QueryClientProvider client={client}><MessageTemplatesManager /></QueryClientProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'WhatsApp API' }));
  fireEvent.change(screen.getByPlaceholderText('Ex: Boas-vindas, Lembrete de audiência'), { target: { value: 'Boas-vindas' } });
  fireEvent.change(screen.getByPlaceholderText(/Ex: Olá/), { target: { value: 'Olá, tudo bem?' } });
  fireEvent.keyDown(screen.getByRole('combobox', { name: 'Mídia do cabeçalho' }), { key: 'Enter' });
  fireEvent.click(await screen.findByRole('option', { name: 'Imagem' }));
  return fetcher;
}

it('clears uploaded media when switching Meta Cloud to Evolution and permits text-only creation', async () => {
  const fetcher = await setup();
  fireEvent.click(screen.getByRole('button', { name: 'Concluir upload' }));
  expect(screen.getByRole('button', { name: 'Criar modelo' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: evolution.phoneNumber }));
  expect(screen.getByRole('combobox', { name: 'Mídia do cabeçalho' })).toHaveTextContent('Sem mídia');
  expect(screen.getByRole('combobox', { name: 'Mídia do cabeçalho' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Concluir upload' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Criar modelo' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Criar modelo' }));
  await waitFor(() => expect(fetcher).toHaveBeenCalled());
  const payload = JSON.parse(fetcher.mock.calls[0][1].body);
  expect(payload).toMatchObject({ connectionId: evolution.id, body: 'Olá, tudo bem?' });
  expect(payload).not.toHaveProperty('mediaId');
});

it('clears pending upload state and requires a new file for a different Cloud connection', async () => {
  await setup();
  fireEvent.click(screen.getByRole('button', { name: 'Iniciar upload' }));
  expect(screen.getByRole('button', { name: 'Criar modelo' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: cloudTwo.phoneNumber }));
  expect(screen.getByRole('combobox', { name: 'Mídia do cabeçalho' })).toHaveTextContent('Sem mídia');
  expect(screen.getByRole('combobox', { name: 'Mídia do cabeçalho' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Criar modelo' })).toBeEnabled();
  fireEvent.keyDown(screen.getByRole('combobox', { name: 'Mídia do cabeçalho' }), { key: 'Enter' });
  fireEvent.click(await screen.findByRole('option', { name: 'Imagem' }));
  expect(screen.getByRole('button', { name: 'Criar modelo' })).toBeDisabled();
});
