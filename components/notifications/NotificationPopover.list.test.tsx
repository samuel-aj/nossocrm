import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { Notice } from '@/lib/notifications/types';
import type { SystemNotification } from '@/hooks/useSystemNotifications';
import { NotificationPopover } from './NotificationPopover';

const DAY = 86_400_000;
const state = vi.hoisted(() => ({ notifications: [] as SystemNotification[], notices: [] as Notice[], refresh: vi.fn() }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ profile: { role: 'admin' } }) }));
vi.mock('@/hooks/useSystemNotifications', () => ({
  useSystemNotifications: () => ({
    notifications: state.notifications, count: state.notifications.length, hasHighSeverity: false,
    markAsRead: vi.fn(), markAllAsRead: vi.fn(),
  }),
}));
vi.mock('./usePersonalNotifications', () => ({
  usePersonalNotifications: () => ({ notices: state.notices, settings: {}, clear: vi.fn(), refresh: state.refresh }),
}));

const system = (id: string, daysAgo: number, extra: Partial<SystemNotification> = {}): SystemNotification => ({
  id, type: 'SYSTEM_INFO', title: 'Lead devolvido dos Inativos', message: `Negócio ${id}`,
  timestamp: new Date(Date.now() - daysAgo * DAY), actionLink: '/boards', severity: 'medium', readAt: null, ...extra,
});
const notice = (id: string, extra: Partial<Notice> = {}): Notice => ({
  id, kind: 'message', title: `Mensagem ${id}`, message: 'Olá', href: '/chats', createdAt: new Date().toISOString(), ...extra,
});
const bell = () => screen.getByRole('button', { name: /^Notificações:/ });
const openPanel = () => { render(<NotificationPopover />); fireEvent.click(bell()); };

beforeEach(() => { state.notifications = []; state.notices = []; state.refresh.mockClear(); });

it('requests a refresh when opening the bell, not when closing it', () => {
  openPanel();
  expect(state.refresh).toHaveBeenCalledTimes(1);
  fireEvent.click(bell());
  expect(state.refresh).toHaveBeenCalledTimes(1);
});

it('opens short and keeps old notices one tap away, without dropping any', () => {
  state.notifications = [system('a', 38), system('b', 46), system('c', 86)];
  openPanel();
  expect(screen.getByText('Nenhum aviso nos últimos 7 dias.')).toBeInTheDocument();
  expect(screen.queryByText('Negócio a')).not.toBeInTheDocument();
  const more = screen.getByRole('button', { name: /Ver anteriores \(3\)/ });
  expect(more).toHaveAttribute('aria-expanded', 'false');
  expect(more).toHaveTextContent('3 não lidas');
  fireEvent.click(more);
  for (const id of ['a', 'b', 'c']) expect(screen.getByText(`Negócio ${id}`)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Mostrar só os recentes' })).toHaveAttribute('aria-expanded', 'true');
});

it('shows at most five recent notices and reopens collapsed', () => {
  state.notifications = [...Array.from({ length: 7 }, (_, index) => system(`r${index}`, index / 10)), system('old', 50, { readAt: '2026-10-05T12:00:00Z' })];
  openPanel();
  expect(screen.getAllByText(/^Negócio r/)).toHaveLength(5);
  expect(screen.queryByText('Nenhum aviso nos últimos 7 dias.')).not.toBeInTheDocument();
  const more = screen.getByRole('button', { name: /Ver anteriores \(3\)/ });
  expect(more).toHaveTextContent('2 não lidas');
  fireEvent.click(more);
  expect(screen.getAllByText(/^Negócio /)).toHaveLength(8);
  fireEvent.click(bell());
  fireEvent.click(bell());
  expect(screen.getAllByText(/^Negócio /)).toHaveLength(5);
});

it('reserves a slot for an old unread critical alert and expands in the original order', () => {
  const ordinary = Array.from({ length: 5 }, (_, index) => system(String(index + 1), index));
  state.notifications = [
    ...ordinary,
    system('crítico', 20, { severity: 'high' }),
    system('crítico lido', 21, { severity: 'high', readAt: new Date().toISOString() }),
  ];
  openPanel();
  const visible = () => screen.getAllByText(/^Negócio /).map(item => item.textContent);
  expect(visible()).toEqual(['Negócio 1', 'Negócio 2', 'Negócio 3', 'Negócio 4', 'Negócio crítico']);
  fireEvent.click(screen.getByRole('button', { name: /Ver anteriores \(2\)/ }));
  expect(visible()).toEqual(state.notifications.map(item => item.message));
});

it('keeps every unread critical alert visible even when there are more than five', () => {
  const critical = Array.from({ length: 6 }, (_, index) => system('crítico ' + index, 10 + index, { severity: 'high' }));
  state.notifications = [system('comum', 1), ...critical];
  openPanel();
  expect(screen.getAllByText(/^Negócio crítico/)).toHaveLength(6);
  expect(screen.queryByText('Negócio comum')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Ver anteriores \(1\)/ }));
  expect(screen.getByText('Negócio comum')).toBeInTheDocument();
});

it('opens with a recent-list empty state when the session contains only an old message', () => {
  state.notices = [notice('antiga', { createdAt: new Date(Date.now() - 8 * DAY).toISOString() })];
  openPanel();
  expect(screen.getByText('Nenhum aviso nos últimos 7 dias.')).toBeInTheDocument();
  expect(screen.queryByText('Mensagem antiga')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Limpar avisos' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Ver anteriores (1)' }));
  expect(screen.getByText('Mensagem antiga')).toBeInTheDocument();
  expect(screen.queryByText('Nenhum aviso nos últimos 7 dias.')).not.toBeInTheDocument();
});

it('caps the session notices but always shows ongoing alerts', () => {
  state.notices = [
    notice('ia', { kind: 'alert', category: 'ai_usage', title: 'Limite da IA', createdAt: new Date(Date.now() - 30 * DAY).toISOString() }),
    ...Array.from({ length: 8 }, (_, index) => notice(String(index))),
  ];
  openPanel();
  expect(screen.getByText('Limite da IA')).toBeInTheDocument();
  expect(screen.getAllByText(/^Mensagem \d/)).toHaveLength(5);
  fireEvent.click(screen.getByRole('button', { name: 'Ver anteriores (3)' }));
  expect(screen.getAllByText(/^Mensagem \d/)).toHaveLength(8);
});

it('describes the clear action when a connection outage must stay in the bell', () => {
  state.notices = [
    notice('conexão', { kind: 'alert', category: 'connection_outage', tone: 'red', title: 'Conexão interrompida' }),
    notice('comum'),
  ];
  openPanel();
  expect(screen.getByRole('button', { name: 'Limpar outros avisos' })).toBeInTheDocument();
});

it('gives both shortcuts a 44px touch target without changing where they lead', () => {
  openPanel();
  const preferences = screen.getByRole('button', { name: 'Preferências de notificações' });
  const alerts = screen.getByRole('link', { name: 'Configurar alertas de conexão' });
  expect(alerts).toHaveAttribute('href', '/conexao-whatsapp?aba=alertas');
  for (const shortcut of [preferences, alerts]) expect(shortcut.className).toContain('min-h-11');
  expect(preferences.parentElement?.className).toContain('gap-2');
});
