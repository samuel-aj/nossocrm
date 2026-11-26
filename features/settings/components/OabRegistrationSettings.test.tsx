// @vitest-environment happy-dom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, expect, it, vi } from 'vitest';
import { OabRegistrationSettings } from './OabRegistrationSettings';

vi.mock('@/context/ToastContext', () => ({ useToast: () => ({ addToast: vi.fn() }) }));
beforeAll(() => {
  HTMLElement.prototype.hasPointerCapture = () => false;
  HTMLElement.prototype.setPointerCapture = () => {};
  HTMLElement.prototype.releasePointerCapture = () => {};
  HTMLElement.prototype.scrollIntoView = () => {};
});

it('permite ao escritório confirmar e remover a inscrição', async () => {
  const saved = { id: 'fake', professionalName: 'Ana Exemplo', state: 'MS', number: '12345' };
  let confirmed = false;
  const api = vi.fn(async (_endpoint: string, init?: RequestInit) => {
    expect(new Headers(init?.headers).get('x-org-id')).toBe('org-teste');
    if (init?.method === 'POST') {
      expect(JSON.parse(String(init.body))).toEqual({ professionalName: 'Ana Exemplo', state: 'MS', number: '12345', confirmed: true });
      confirmed = true;
    }
    if (init?.method === 'DELETE') {
      expect(JSON.parse(String(init.body))).toEqual({ id: saved.id });
      confirmed = false;
    }
    return Response.json({ registrations: confirmed ? [saved] : [] });
  });
  vi.stubGlobal('fetch', api);
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={cache}><OabRegistrationSettings organizationId="org-teste" /></QueryClientProvider>);
  const user = userEvent.setup();
  await screen.findByText('Nenhuma inscrição confirmada.');
  await user.type(screen.getByRole('textbox', { name: 'Nome do profissional' }), 'Ana Exemplo');
  await user.click(screen.getByRole('combobox', { name: 'UF da inscrição' }));
  await user.click(screen.getByRole('option', { name: 'MS', exact: true }));
  await user.type(screen.getByRole('textbox', { name: 'Nº da OAB' }), '12345');
  await user.click(screen.getByRole('button', { name: 'Confirmar inscrição' }));
  await screen.findByText('Ana Exemplo · OAB/MS 12345');
  await user.click(screen.getByRole('button', { name: /Remover confirmação de Ana/ }));
  await screen.findByText('Nenhuma inscrição confirmada.');
  expect(confirmed).toBe(false);
});
