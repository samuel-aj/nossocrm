import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import SessionGate from './SessionGate';

const mocks = vi.hoisted(() => ({
  auth: { user: { id: 'samuel' } as { id: string } | null, profile: null as { id: string } | null,
    loading: true, profileError: null as string | null, refreshProfile: vi.fn(), signOut: vi.fn() },
  router: { replace: vi.fn() },
  mountCRM: vi.fn(),
}));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => mocks.auth }));
vi.mock('next/navigation', () => ({ useRouter: () => mocks.router }));
function CRM() { mocks.mountCRM(); return <p>Conversas</p>; }
beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(mocks.auth, { user: { id: 'samuel' }, profile: null, loading: true, profileError: null });
});
afterEach(cleanup);

it('does not mount CRM queries or generic identity while a profile is unresolved', () => {
  render(<SessionGate><CRM /></SessionGate>);
  expect(screen.getByRole('status').textContent).toContain('Carregando seu perfil');
  expect(mocks.mountCRM).not.toHaveBeenCalled();
});
it('offers recovery after failure, then mounts the CRM with the correct profile', () => {
  Object.assign(mocks.auth, { loading: false, profileError: 'offline' });
  const view = render(<SessionGate><CRM /></SessionGate>);
  fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
  expect(mocks.auth.refreshProfile).toHaveBeenCalledOnce();
  expect(mocks.mountCRM).not.toHaveBeenCalled();
  mocks.auth.profile = { id: 'samuel' };
  view.rerender(<SessionGate><CRM /></SessionGate>);
  expect(screen.getByText('Conversas')).toBeTruthy();
});
it('does not show a previous user’s profile while the current one loads', () => {
  mocks.auth.profile = { id: 'previous' };
  render(<SessionGate><CRM /></SessionGate>);
  expect(mocks.mountCRM).not.toHaveBeenCalled();
});
it('redirects an unauthenticated session to login', () => {
  Object.assign(mocks.auth, { loading: false, user: null });
  render(<SessionGate><CRM /></SessionGate>);
  expect(mocks.router.replace).toHaveBeenCalledWith('/login');
  expect(mocks.mountCRM).not.toHaveBeenCalled();
});
