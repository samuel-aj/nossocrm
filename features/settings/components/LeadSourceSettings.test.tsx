import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { LeadSourceSettings } from './LeadSourceSettings';

const mocks = vi.hoisted(() => ({ options: ['Google Ads', 'Meta Ads'], role: 'admin', mutate: vi.fn(), toast: vi.fn() }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ profile: { role: mocks.role }, organizationId: 'org' }) }));
vi.mock('@/context/ToastContext', () => ({ useToast: () => ({ addToast: mocks.toast }) }));
vi.mock('@/lib/query/hooks/useOrgPreferences', () => ({ useOrgPreferences: () => ({
  leadSourceOptions: mocks.options, isLoading: false, isError: false, setLeadSourceOptions: { mutateAsync: mocks.mutate, isPending: false },
}) }));
beforeEach(() => {
  mocks.options = ['Google Ads', 'Meta Ads']; mocks.role = 'admin'; mocks.toast.mockReset();
  mocks.mutate.mockReset().mockImplementation(async next => { mocks.options = next ?? ['Google Ads', 'Meta Ads']; });
});
it('adds and removes categories without saving until the admin confirms', async () => {
  render(<LeadSourceSettings />);
  fireEvent.change(screen.getByRole('textbox', { name: 'Nova origem' }), { target: { value: '  Parceiros  ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Adicionar' }));
  fireEvent.click(screen.getByRole('button', { name: 'Remover Meta Ads' }));
  expect(mocks.mutate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Salvar origens' }));
  await waitFor(() => expect(mocks.mutate).toHaveBeenCalledExactlyOnceWith(['Google Ads', 'Parceiros']));
  expect(mocks.toast).toHaveBeenCalledWith('Origens do lead salvas.', 'success');
  expect(screen.getByRole('button', { name: 'Salvar origens' })).toBeDisabled();
});
it('preserves an unsaved draft and does not claim success when save fails', async () => {
  mocks.mutate.mockRejectedValue(new Error('Acesso negado'));
  render(<LeadSourceSettings />);
  fireEvent.click(screen.getByRole('button', { name: 'Remover Meta Ads' }));
  fireEvent.click(screen.getByRole('button', { name: 'Salvar origens' }));
  await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith('Acesso negado', 'error'));
  expect(screen.queryByRole('button', { name: 'Remover Meta Ads' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Salvar origens' })).toBeEnabled();
  expect(mocks.toast).not.toHaveBeenCalledWith(expect.anything(), 'success');
});
it('restores defaults with explicit null and offers read-only categories to nonadmins', async () => {
  const view = render(<LeadSourceSettings />);
  fireEvent.click(screen.getByRole('button', { name: 'Restaurar padrão' }));
  await waitFor(() => expect(mocks.mutate).toHaveBeenCalledExactlyOnceWith(null));
  view.unmount(); mocks.role = 'sales'; mocks.mutate.mockClear();
  render(<LeadSourceSettings />);
  expect(screen.getByText('Google Ads')).toBeInTheDocument();
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  expect(mocks.mutate).not.toHaveBeenCalled();
});
