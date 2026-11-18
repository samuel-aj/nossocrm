import { useState, type MouseEvent } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
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
  useOrgMembers: () => ({ isSuccess: true, data: [] }),
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
  { id: 'one', profileName: 'Escritório de teste', phoneNumber: '+550000000001' },
  { id: 'two', profileName: 'Comercial de teste', phoneNumber: '+550000000002' },
].map(line => ({ ...line, provider: 'meta_cloud', status: 'connected' }));

function mockReads(connectionData: Promise<typeof lines>) {
  const request = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method && init.method !== 'GET') throw new Error('Apenas leitura no teste');
    if (url === '/api/whatsapp/connection') {
      const connections = await connectionData;
      return Response.json({ connections, connection: connections[0] ?? null, connected: !!connections.length });
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
