import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { NotificationPopover } from './NotificationPopover';

const { auth } = vi.hoisted(() => ({ auth: { profile: { role: 'vendedor' } } }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('@/hooks/useSystemNotifications', () => ({ useSystemNotifications: () => ({ notifications: [], count: 0 }) }));
vi.mock('./usePersonalNotifications', () => ({ usePersonalNotifications: () => ({ notices: [], settings: {} }) }));

it.each([['admin', true], ['super_admin', true], ['vendedor', false]] as const)(
  'shows personal preferences and the role-appropriate recipient settings for %s', (role, canEdit) => {
    auth.profile.role = role;
    render(<NotificationPopover />);
    fireEvent.click(screen.getByRole('button', { name: /Notificações/ }));
    expect(screen.getByRole('button', { name: 'Preferências de notificações' })).toBeEnabled();
    const link = screen.queryByRole('link', { name: 'Configurar alertas de conexão' });
    if (canEdit) expect(link).toHaveAttribute('href', '/conexao-whatsapp');
    else expect(link).not.toBeInTheDocument();
  }
);
