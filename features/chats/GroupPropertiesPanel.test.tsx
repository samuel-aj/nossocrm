import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { GroupPropertiesPanel } from './GroupPropertiesPanel';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('reads the group, cancels without a write and keeps the draft when WhatsApp refuses the change', async () => {
  const fetcher = vi.fn(async (_url: string, init: RequestInit) => init.method === 'PATCH'
    ? Response.json({ error: 'O número não pode editar este grupo.' }, { status: 502 })
    : Response.json({ subject: 'Equipe', description: 'Avisos', pictureUrl: null }));
  vi.stubGlobal('fetch', fetcher);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><GroupPropertiesPanel conversationId="group-1" onClose={() => {}} /></QueryClientProvider>);
  await screen.findByText('Equipe');
  fireEvent.click(screen.getByRole('button', { name: 'Editar nome do grupo' }));
  fireEvent.change(screen.getByLabelText('Nome do grupo'), { target: { value: 'Alteração cancelada' } });
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
  expect(fetcher).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Editar descrição' }));
  fireEvent.change(screen.getByLabelText('Descrição'), { target: { value: 'Novo aviso' } });
  fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('não pode editar');
  expect(screen.getByLabelText('Descrição')).toHaveValue('Novo aviso');
  const write = fetcher.mock.calls[1][1].body as FormData;
  expect(write.get('field')).toBe('description');
  expect(write.get('value')).toBe('Novo aviso');
  client.clear();
});
