import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, expect, it, vi } from 'vitest';
import { LeadSourceSelect } from './LeadSourceSelect';

vi.mock('@/lib/query/hooks/useOrgPreferences', () => ({ useOrgPreferences: () => ({ leadSourceOptions: ['Google Ads', 'Meta Ads'] }) }));
beforeAll(() => {
  HTMLElement.prototype.hasPointerCapture = () => false;
  HTMLElement.prototype.setPointerCapture = () => {};
  HTMLElement.prototype.releasePointerCapture = () => {};
  HTMLElement.prototype.scrollIntoView = () => {};
});
it('keeps an existing removed category visible and clears only through an explicit choice', async () => {
  const change = vi.fn();
  render(<LeadSourceSelect value="Evento antigo" onChange={change} />);
  const select = screen.getByRole('combobox', { name: 'Origem do lead' });
  expect(select).toHaveTextContent('Evento antigo');
  expect(change).not.toHaveBeenCalled();
  await userEvent.click(select);
  expect(screen.getByRole('option', { name: 'Evento antigo' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('option', { name: 'Não informado' }));
  expect(change).toHaveBeenCalledExactlyOnceWith(null);
});
it('selects a configured organization category', async () => {
  const change = vi.fn();
  render(<LeadSourceSelect value={null} onChange={change} />);
  await userEvent.click(screen.getByRole('combobox', { name: 'Origem do lead' }));
  await userEvent.click(screen.getByRole('option', { name: 'Meta Ads' }));
  expect(change).toHaveBeenCalledExactlyOnceWith('Meta Ads');
});
it('shows the current source without allowing edits when disabled', async () => {
  const change = vi.fn();
  render(<LeadSourceSelect value="Meta Ads" onChange={change} disabled />);
  expect(screen.getByRole('combobox', { name: 'Origem do lead' })).toBeDisabled();
  await userEvent.click(screen.getByRole('combobox', { name: 'Origem do lead' }));
  expect(change).not.toHaveBeenCalled();
});
