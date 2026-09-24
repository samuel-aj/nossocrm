import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MainOrganizationShortcut } from './MainOrganizationShortcut';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => vi.unstubAllGlobals());
const home = { id: 'home', name: 'Anúncio Jurídico' };
function mount(overrides: Partial<React.ComponentProps<typeof MainOrganizationShortcut>> = {}) {
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ organization: home }) });
  vi.stubGlobal('fetch', fetcher);
  const onSelect = vi.fn();
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MainOrganizationShortcut enabled currentOrgId="client" collapsed={false} busy={false} onSelect={onSelect} {...overrides} />
  </QueryClientProvider>);
  return { fetcher, onSelect };
}
describe('main organization shortcut', () => {
  it('returns directly to the configured organization without opening a menu', async () => {
    const { onSelect } = mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Voltar para Anúncio Jurídico' }));
    expect(onSelect).toHaveBeenCalledWith(home);
  });
  it('does not fetch or offer access for ordinary users', () => {
    const { fetcher } = mount({ enabled: false });
    expect(fetcher).not.toHaveBeenCalled();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
  it('hides itself when already home', async () => {
    const { fetcher } = mount({ currentOrgId: 'home' });
    await waitFor(() => expect(fetcher).toHaveBeenCalled());
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
  it('keeps a labeled icon when collapsed and prevents concurrent switches', async () => {
    mount({ collapsed: true, busy: true });
    expect(await screen.findByRole('button', { name: 'Voltar para Anúncio Jurídico' })).toBeDisabled();
  });
});
