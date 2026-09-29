import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, expect, it, vi } from 'vitest';
import { LifecycleSettingsModal } from './LifecycleSettingsModal';

const updateLifecycleStage = vi.fn();
vi.mock('@/context/CRMContext', () => ({
  useCRM: () => ({
    lifecycleStages: [{ id: 'lead', name: 'Lead', color: 'bg-blue-500', isDefault: true }],
    contacts: [],
    addLifecycleStage: vi.fn(),
    updateLifecycleStage,
    deleteLifecycleStage: vi.fn(),
    reorderLifecycleStages: vi.fn(),
  }),
}));

beforeAll(() => {
  HTMLElement.prototype.hasPointerCapture = () => false;
  HTMLElement.prototype.setPointerCapture = () => {};
  HTMLElement.prototype.releasePointerCapture = () => {};
  HTMLElement.prototype.scrollIntoView = () => {};
});

it('opens the color selector by clicking the visible lifecycle swatch', async () => {
  render(<LifecycleSettingsModal isOpen onClose={vi.fn()} />);
  const swatch = screen.getByRole('combobox', { name: 'Cor do estágio Lead' });
  expect(swatch).toHaveClass('bg-blue-500', 'h-6', 'w-6');
  await userEvent.click(swatch);
  await userEvent.click(screen.getByRole('option', { name: 'green-500' }));
  expect(updateLifecycleStage).toHaveBeenCalledWith('lead', { color: 'bg-green-500' });
});
