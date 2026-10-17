import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { Board, BoardStage } from '@/types';
import { StageSettingsModal } from './StageSettingsModal';
import { queryKeys } from '@/lib/query/queryKeys';
const mocks = vi.hoisted(() => ({ update: vi.fn(), toast: vi.fn() }));
vi.mock('@/context/CRMContext', () => ({ useCRM: () => ({ customFieldDefinitions: [{ id: 'f', key: 'date', label: 'Assinatura', type: 'date' }] }) }));
vi.mock('@/context/ToastContext', () => ({ useToast: () => ({ addToast: mocks.toast }) }));
vi.mock('@/lib/supabase/boards', () => ({ boardsService: { updateStage: mocks.update } }));
vi.mock('@/lib/a11y', () => ({ FocusTrap: ({ children }: { children: React.ReactNode }) => <>{children}</>, useFocusReturn: () => {} }));
beforeEach(() => { vi.resetAllMocks(); mocks.update.mockResolvedValue({ error: null }); });
const first = { id: 'first', label: 'Proposta', requiredFields: [] } as unknown as BoardStage;
const second = { id: 'second', label: 'Assinado', requiredFields: ['products'] } as BoardStage;
function setup() {
  const client = new QueryClient(); const close = vi.fn(); const board = { id: 'b', stages: [first, second] } as Board;
  client.setQueryData(queryKeys.boards.lists(), [board]);
  render(<QueryClientProvider client={client}><StageSettingsModal board={board} stage={first} onClose={close} /></QueryClientProvider>);
  return { client, close };
}
it('saves only the selected stage, by stable custom field ID, and preserves other rules', async () => {
  const { client, close } = setup();
  fireEvent.click(screen.getByRole('checkbox', { name: /Origem do lead/ }));
  fireEvent.click(screen.getByRole('checkbox', { name: /Valor do negócio/ }));
  fireEvent.click(screen.getByRole('checkbox', { name: /Assinatura/ }));
  fireEvent.submit(screen.getByLabelText('Nome da etapa').closest('form')!);
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(mocks.update).toHaveBeenCalledExactlyOnceWith('first', { label: 'Proposta', requiredFields: ['leadSource', 'value', 'custom:f'] });
  expect(client.getQueryData<Board[]>(queryKeys.boards.lists())?.[0].stages[1]).toEqual(second);
});
it('does not close or claim success when the server rejects the configuration', async () => {
  mocks.update.mockResolvedValue({ error: new Error('Sem permissão') }); const { close } = setup();
  fireEvent.submit(screen.getByLabelText('Nome da etapa').closest('form')!);
  expect(await screen.findByRole('alert')).toHaveTextContent('Sem permissão');
  expect(close).not.toHaveBeenCalled(); expect(mocks.toast).not.toHaveBeenCalled();
});
