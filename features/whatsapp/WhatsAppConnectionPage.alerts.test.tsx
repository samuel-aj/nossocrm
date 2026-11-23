import { useState, type MouseEvent } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { NotificationPopover } from '@/components/notifications/NotificationPopover';
import { WhatsAppConnectionPage } from './WhatsAppConnectionPage';

const { profile } = vi.hoisted(() => ({
  profile: { role: 'admin', organization_id: 'test-office', id: 'test-admin' },
}));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ profile }) }));
vi.mock('@/context/ToastContext', () => ({ useToast: () => ({ addToast: vi.fn() }) }));
vi.mock('@/lib/query/hooks', () => ({
  useOrgMembers: () => ({ isSuccess: true, data: [{ id: 'member-two', name: 'Pessoa de teste', member: true }] }),
}));
vi.mock('@/hooks/useSystemNotifications', () => ({
  useSystemNotifications: () => ({ notifications: [], count: 0 }),
}));
vi.mock('@/components/notifications/usePersonalNotifications', () => ({
  usePersonalNotifications: () => ({ notices: [], settings: {} }),
}));

const hub = '/conexao-whatsapp';
const alerts = '/conexao-whatsapp?aba=alertas';
const lines = [
  { id: 'one', profileName: 'Escritório de teste', phoneNumber: '+550000000001', alertOwnerId: null },
  { id: 'two', profileName: 'Comercial de teste', phoneNumber: '+550000000002', alertOwnerId: 'member-two' },
].map(line => ({ ...line, provider: 'meta_cloud', status: 'connected' }));

function mockReads(connectionData: Promise<typeof lines>) {
  const historyPath = '/api/whatsapp/connection/history';
  const request = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method && init.method !== 'GET') throw new Error('Apenas leitura no teste');
    if (url === '/api/whatsapp/connection') {
      const connections = await connectionData;
      return Response.json({ connections, connection: connections[0] ?? null, connected: !!connections.length });
    }
    if (url.startsWith(historyPath + '?')) {
      const id = new URL(url, window.location.origin).searchParams.get('connectionId');
      const line = lines.find(candidate => candidate.id === id);
      if (!line) return new Response(null, { status: 404 });
      return Response.json({ items: [{
        id: 'incident-' + line.id, openedAt: '2026-11-18T08:00:00Z', resolvedAt: null, resolution: null,
        observation: 'Observação de teste · ' + line.profileName, observedAt: '2026-11-18T08:00:00Z',
        detectedBy: 'Verificação de teste', observedBy: 'Verificação de teste',
      }], nextCursor: null });
    }
    return Response.json({});
  });
  vi.stubGlobal('fetch', request);
  return request;
}

// Follow the href rendered by Next Link without loading another browser or server.
function TestRoutes() {
  const [location, setLocation] = useState(window.location.href);
  function follow(event: MouseEvent<HTMLDivElement>) {
    const link = (event.target as Element).closest('a');
    if (!link) return;
    event.preventDefault();
    window.history.pushState(null, '', link.href);
    setLocation(window.location.href);
  }
  return <div onClick={follow}>
    <NotificationPopover />
    {new URL(location).pathname === hub ? <WhatsAppConnectionPage /> : <h1>Boards</h1>}
  </div>;
}

function visit(url: string) {
  window.history.replaceState(null, '', url);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><TestRoutes /></QueryClientProvider>);
}

afterEach(() => {
  vi.unstubAllGlobals();
  profile.role = 'admin';
  window.history.replaceState(null, '', '/');
});

it.each([hub, '/boards'])('opens the specific settings from the bell on %s while numbers load', async initial => {
  let resolveLines!: (value: typeof lines) => void;
  const request = mockReads(new Promise(resolve => { resolveLines = resolve; }));
  visit(initial);
  const bell = screen.getByRole('button', { name: /Notificações/ });
  fireEvent.click(bell);
  fireEvent.click(screen.getByRole('link', { name: 'Configurar alertas de conexão' }));
  expect(bell).toHaveAttribute('aria-expanded', 'false');
  expect(window.location.pathname + window.location.search).toBe(alerts);
  expect(await screen.findByRole('heading', { name: 'Alertas de conexão' })).toBeVisible();
  expect(screen.getByText(/Carregando/i)).toBeVisible();
  expect(screen.queryByRole('combobox', { name: 'Quem recebe os avisos' })).toBeNull();

  await act(async () => { resolveLines(lines); });
  const controls = await screen.findAllByRole('combobox', { name: 'Quem recebe os avisos' });
  expect(controls).toHaveLength(2);
  for (const [i, line] of lines.entries()) {
    expect(screen.getByText(line.profileName)).toBeVisible();
    expect(screen.getByText(line.phoneNumber, { exact: false })).toBeVisible();
    expect(controls[i]).toBeEnabled();
  }
  const back = screen.getByRole('link', { name: /Voltar para (a )?Conexão/i });
  expect(back).toHaveAttribute('href', hub);
  fireEvent.click(back);
  expect(window.location.search).toBe('');
  expect(screen.queryByRole('heading', { name: 'Alertas de conexão' })).toBeNull();
  expect(request.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true);
});

it('explains the empty state when an administrator has no numbers', async () => {
  mockReads(Promise.resolve([]));
  visit(alerts);
  expect(await screen.findByText(/nenhum número|conecte um número/i)).toBeVisible();
  expect(screen.queryByRole('combobox', { name: 'Quem recebe os avisos' })).toBeNull();
});

it('keeps recipient controls unavailable to a non-admin opening the URL directly', async () => {
  profile.role = 'vendedor';
  const request = mockReads(Promise.resolve(lines));
  visit(alerts);
  expect(await screen.findByText(/apenas administradores|somente administradores|acesso restrito|sem permissão/i)).toBeVisible();
  expect(screen.queryByRole('combobox', { name: 'Quem recebe os avisos' })).toBeNull();
  expect(request.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true);
});

it('opens separate alerts and history dialogs for the chosen number and returns keyboard focus', async () => {
  const request = mockReads(Promise.resolve(lines));
  const historyUrls = () => request.mock.calls.map(([url]) => url).filter(url => url.includes('/history?'));
  const user = userEvent.setup();
  visit(hub);
  const bell = await screen.findByRole('button', { name: /Alertas de conexão de .*Comercial de teste/i });
  const history = screen.getByRole('button', { name: /Histórico de .*Escritório de teste/i });
  expect(bell).toHaveAttribute('aria-haspopup', 'dialog');
  expect(bell).toHaveTextContent(/^$/);
  expect(history).toHaveTextContent('Histórico');
  expect(history).toHaveAttribute('aria-haspopup', 'dialog');
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.queryByRole('combobox', { name: 'Quem recebe os avisos' })).toBeNull();
  expect(historyUrls()).toEqual([]);

  bell.focus();
  await user.keyboard('{Enter}');
  const alertsDialog = screen.getByRole('dialog', { name: 'Alertas de conexão' });
  expect(alertsDialog).toHaveTextContent(lines[1].phoneNumber);
  expect(alertsDialog).toHaveTextContent(/e-mail usa os mesmos destinatários do sino para este número/);
  expect(alertsDialog).not.toHaveTextContent(lines[0].phoneNumber);
  expect(within(alertsDialog).getByRole('combobox', { name: 'Quem recebe os avisos' })).toHaveTextContent('Administradores e Pessoa de teste');
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  expect(historyUrls()).toEqual([]);
  await user.keyboard('{Escape}');
  await waitFor(() => expect(bell).toHaveFocus());
  expect(screen.queryByRole('dialog')).toBeNull();

  await user.click(history);
  const historyDialog = screen.getByRole('dialog', { name: 'Histórico da conexão' });
  expect(historyDialog).toHaveTextContent(lines[0].phoneNumber);
  expect(await within(historyDialog).findByText('Observação de teste · ' + lines[0].profileName)).toBeVisible();
  expect(historyDialog).not.toHaveTextContent(lines[1].profileName);
  expect(screen.queryByRole('combobox', { name: 'Quem recebe os avisos' })).toBeNull();
  expect(historyUrls()).toEqual(['/api/whatsapp/connection/history?connectionId=one']);
  await user.click(within(historyDialog).getByRole('button', { name: /Fechar/ }));
  await waitFor(() => expect(history).toHaveFocus());
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('shows read-only alert recipients for a non-admin opening the bell on a number', async () => {
  profile.role = 'vendedor';
  const request = mockReads(Promise.resolve(lines));
  visit(hub);
  fireEvent.click(await screen.findByRole('button', { name: /Alertas de conexão de .*Comercial de teste/i }));
  const dialog = screen.getByRole('dialog', { name: 'Alertas de conexão' });
  expect(dialog).toHaveTextContent(/Os administradores e Pessoa de teste recebem/);
  expect(within(dialog).queryByRole('combobox')).toBeNull();
  expect(request.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true);
});
