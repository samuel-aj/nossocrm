import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ThemeProvider } from '@/context/ThemeContext';
import { ToastProvider } from '@/context/ToastContext';
import Layout from './Layout';

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
  useRouter: () => ({ replace: vi.fn() }),
}));
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'super-admin' },
    profile: { role: 'super_admin', organization_id: 'home', organization_name: 'Escritório atual' },
  }),
}));
vi.mock('@/context/CRMContext', () => ({ useCRM: () => ({ boards: [] }) }));
vi.mock('./notifications/NotificationPopover', () => ({ NotificationPopover: () => null }));

afterEach(() => vi.unstubAllGlobals());

it.each([
  { device: 'celular', width: 390, landmark: 'banner' },
  { device: 'tablet', width: 1024, landmark: 'banner' },
  { device: 'desktop', width: 1280, landmark: 'complementary' },
])('exibe um único seletor de organização no $device', ({ width, landmark }) => {
  vi.stubGlobal('innerWidth', width);
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ total: 0, organization: null })));
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ThemeProvider>
        <ToastProvider><Layout>CRM</Layout></ToastProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );

  const switcher = screen.getByRole('button', { name: 'Trocar organização' });
  const region = landmark === 'banner'
    ? screen.getByRole('banner')
    : screen.getByRole('complementary', { name: 'Menu principal' });
  expect(region).toContainElement(switcher);
  expect(switcher).toHaveTextContent('Escritório atual');
});
