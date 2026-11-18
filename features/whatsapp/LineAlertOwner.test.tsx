import type { SelectHTMLAttributes } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { LineAlertOwner } from './WhatsAppLineHealth';

const { addToast } = vi.hoisted(() => ({ addToast: vi.fn() }));
vi.mock('@/context/ToastContext', () => ({ useToast: () => ({ addToast }) }));
vi.mock('@/lib/query/hooks', () => ({
  useOrgMembers: () => ({
    isSuccess: true,
    data: [{ id: 'm1', name: 'Rita', member: true }, { id: 'm2', name: 'Visitante', member: false }],
  }),
}));
vi.mock('@/components/ui/NativeSelect', () => ({
  NativeSelect: (props: SelectHTMLAttributes<HTMLSelectElement>) => <select {...props} />,
}));

function show(canEdit: boolean, ownerId: string | null) {
  return render(<QueryClientProvider client={new QueryClient()}>
    <LineAlertOwner connectionId="line-a" ownerId={ownerId} canEdit={canEdit} />
  </QueryClientProvider>);
}

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

it('lets an admin add one member to the administrators for this number', async () => {
  const request = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', request);
  show(true, null);
  expect(screen.getByRole('heading', { name: 'Alertas no sino' })).toBeInTheDocument();
  const select = screen.getByRole('combobox', { name: 'Quem recebe os avisos' });
  expect(select).toHaveDisplayValue('Somente administradores');
  expect(screen.getByRole('option', { name: 'Administradores e Rita' })).toBeInTheDocument();
  expect(screen.queryByRole('option', { name: /Visitante/ })).not.toBeInTheDocument();
  expect(request).not.toHaveBeenCalled();
  fireEvent.change(select, { target: { value: 'm1' } });
  await waitFor(() => expect(addToast).toHaveBeenCalledWith('Destinatários dos alertas atualizados.', 'success'));
  expect(request).toHaveBeenCalledExactlyOnceWith('/api/whatsapp/connection/alert-owner', expect.objectContaining({
    method: 'PATCH', body: JSON.stringify({ connectionId: 'line-a', ownerId: 'm1' }),
  }));
});

it('shows a read-only recipient and the path for personal preferences to a non-admin', () => {
  const request = vi.fn();
  vi.stubGlobal('fetch', request);
  show(false, 'm1');
  expect(screen.getByText(/Os administradores e Rita recebem/)).toBeInTheDocument();
  expect(screen.getByText('Preferências de notificações')).toBeInTheDocument();
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  expect(request).not.toHaveBeenCalled();
});
