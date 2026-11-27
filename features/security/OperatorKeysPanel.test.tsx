// @vitest-environment happy-dom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { OperatorKeysPanel } from './OperatorKeysPanel';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('mostra o segredo uma vez e exige confirmação antes de revogar', async () => {
  const record = { id: 'fixture', name: 'Piloto', key_prefix: 'exemplo', last_used_at: null, revoked_at: null };
  const remove = vi.fn();
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    if (init.method === 'POST') return Response.json({ data: record, token: 'segredo-sintético' });
    if (init.method === 'DELETE') { remove(init.body); return Response.json({ data: { ...record, revoked_at: new Date().toISOString() } }); }
    return Response.json({ data: [] });
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<OperatorKeysPanel />);
  expect(fetchMock).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Chaves de operador da AJ' }));
  await screen.findByText('Nenhuma chave criada.');
  fireEvent.change(screen.getByLabelText('Nome da chave'), { target: { value: 'Piloto' } });
  fireEvent.click(screen.getByRole('button', { name: 'Criar chave de leitura' }));
  await screen.findByDisplayValue('segredo-sintético');
  fireEvent.click(screen.getByRole('button', { name: 'Concluir' }));
  expect(screen.queryByDisplayValue('segredo-sintético')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Revogar' }));
  expect(remove).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar revogação' }));
  await waitFor(() => expect(remove).toHaveBeenCalledWith(JSON.stringify({ id: 'fixture' })));
  await screen.findByText('Revogada');
});
