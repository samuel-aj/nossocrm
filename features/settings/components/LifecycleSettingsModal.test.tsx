// @vitest-environment happy-dom
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { LifecycleSettingsModal } from './LifecycleSettingsModal';

const updateLifecycleStage = vi.fn();
let role: 'super_admin' | 'admin' | 'vendedor' = 'super_admin';
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ profile: { role } }),
}));
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

beforeEach(() => {
  role = 'super_admin';
  updateLifecycleStage.mockClear();
});

it('opens the color selector by clicking the visible lifecycle swatch', async () => {
  render(<LifecycleSettingsModal isOpen onClose={vi.fn()} />);
  const swatch = screen.getByRole('combobox', { name: 'Cor do estágio Lead' });
  expect(swatch).toHaveClass('bg-blue-500', 'h-6', 'w-6');
  await userEvent.click(swatch);
  await userEvent.click(screen.getByRole('option', { name: 'green-500' }));
  expect(updateLifecycleStage).toHaveBeenCalledWith('lead', { color: 'bg-green-500' });
});

it('admin do escritório só consulta: sem campos, botões nem adicionar', () => {
  role = 'admin';
  render(<LifecycleSettingsModal isOpen onClose={vi.fn()} />);
  expect(screen.getByRole('heading', { name: 'Ciclos de Vida' })).toBeInTheDocument();
  expect(screen.getByText('Lead')).toBeInTheDocument();
  expect(screen.getByRole('note')).toHaveTextContent('fale com o suporte');
  expect(screen.queryByRole('combobox')).toBeNull();
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(screen.queryByText('Adicionar Estágio')).toBeNull();
  expect(screen.queryByTitle('Estágio padrão não pode ser removido')).toBeNull();
  expect(updateLifecycleStage).not.toHaveBeenCalled();
});
