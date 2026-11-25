// @vitest-environment happy-dom
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { SecurityEventsPanel } from './SecurityEventsPanel';

const calls: string[] = [];

beforeAll(() => {
  HTMLElement.prototype.hasPointerCapture = () => false;
  HTMLElement.prototype.setPointerCapture = () => {};
  HTMLElement.prototype.releasePointerCapture = () => {};
  HTMLElement.prototype.scrollIntoView = () => {};
});

beforeEach(() => {
  calls.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(String(url));
      const isAuth = String(url).includes('source=auth');
      return new Response(
        JSON.stringify({
          events: isAuth
            ? []
            : [
                {
                  id: 'e1',
                  created_at: '2026-11-24T12:00:00Z',
                  action: 'api_key.created',
                  severity: 'warning',
                  actor: { id: 'u1', name: 'Ana', email: 'ana@x.com' },
                  organization: { id: 'o1', name: 'Escritório A' },
                  resource_type: 'api_key',
                  details: { name: 'n8n' },
                  ip: '203.0.113.7',
                  user_agent: 'UA',
                },
              ],
          hasMore: false,
          summary: isAuth ? null : { critical: 1, warning: 4 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

it('abre nos eventos importantes, com resumo, e mostra os detalhes ao clicar', async () => {
  render(<SecurityEventsPanel organizations={[{ id: 'o1', name: 'Escritório A' }]} />);
  expect(await screen.findByText('Chave de API criada')).toBeInTheDocument();
  expect(calls[0]).toContain('severity=important');
  expect(calls[0]).toContain('period=7d');
  expect(screen.getByText(/No período:/)).toHaveTextContent('No período: 1 crítico e 4 de atenção.');
  expect(screen.getByText('1 registro carregado.')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: /Chave de API criada/ }));
  expect(screen.getByText('203.0.113.7')).toBeInTheDocument();
  expect(screen.getByText('n8n')).toBeInTheDocument();
});

it('os filtros são listas suspensas e refazem a busca', async () => {
  render(<SecurityEventsPanel organizations={[{ id: 'o1', name: 'Escritório A' }]} />);
  await screen.findByText('Chave de API criada');

  await userEvent.click(screen.getByRole('combobox', { name: 'Período' }));
  await userEvent.click(screen.getByRole('option', { name: 'Últimos 30 dias' }));
  await waitFor(() => expect(calls.some(u => u.includes('period=30d'))).toBe(true));

  await userEvent.click(screen.getByRole('combobox', { name: 'Mostrar' }));
  expect(screen.getByText('Quem entrou e senhas recusadas')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('option', { name: 'Logins' }));
  await waitFor(() => expect(calls[calls.length - 1]).toContain('type=logins'));
  expect(calls[calls.length - 1]).not.toContain('severity=');

  await userEvent.click(screen.getByRole('combobox', { name: 'Mostrar' }));
  await userEvent.click(screen.getByRole('option', { name: 'Tudo' }));
  await waitFor(() => expect(calls[calls.length - 1]).not.toContain('type='));
  expect(calls[calls.length - 1]).not.toContain('severity=');
  expect(screen.queryByRole('tab')).toBeNull();
});
