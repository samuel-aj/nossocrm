/**
 * Editar Board → etapas: clicar na etapa abre a configuração e ela FICA aberta;
 * o menu "..." abre e fica aberto; "Editar etapa" abre a configuração; ESC e
 * clique fora fecham só a etapa (o board continua aberto).
 *
 * Reproduz o bug relatado: o modal do board trocava entre "com FocusTrap" e
 * "sem FocusTrap" quando um overlay abria, o que REMONTAVA todo o conteúdo do
 * modal e zerava o estado do editor de etapas (a configuração abria e fechava
 * na hora; o menu "..." sumia). Teste de interação real sobre o DOM.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

vi.mock('@/context/CRMContext', () => ({
  useCRM: () => ({ lifecycleStages: [], products: [], customFieldDefinitions: [] }),
}));
vi.mock('@/context/settings/SettingsContext', () => ({
  useSettings: () => ({ customFieldGroups: [] }),
}));
vi.mock('@/context/ToastContext', () => ({
  useToast: () => ({ addToast: vi.fn(), showToast: vi.fn() }),
}));
vi.mock('@/features/settings/components/LifecycleSettingsModal', () => ({
  LifecycleSettingsModal: () => null,
}));

import { CreateBoardModal } from './CreateBoardModal';
import type { Board } from '@/types';

const board = {
  id: 'b1',
  name: 'Vendas',
  key: 'vendas',
  stages: [
    { id: 's1', label: 'Novo lead', color: 'bg-blue-500' },
    { id: 's2', label: 'Qualificado', color: 'bg-green-500' },
    { id: 's3', label: 'Fechado', color: 'bg-purple-500' },
  ],
  createdAt: '2026-01-01',
} as unknown as Board;

const tick = (ms = 50) => act(() => new Promise((r) => setTimeout(r, ms)));

async function renderModal() {
  const utils = render(
    <CreateBoardModal isOpen onClose={vi.fn()} onSave={vi.fn()} editingBoard={board} availableBoards={[board]} />
  );
  // Como no navegador: o modal do board já está aberto e com o foco inicial
  // aplicado (o focus-trap faz isso num setTimeout) antes de a pessoa interagir.
  await tick(20);
  return utils;
}

const openMenu = (label: string) =>
  fireEvent.pointerDown(screen.getByRole('button', { name: `Mais ações: ${label}` }), {
    button: 0,
    ctrlKey: false,
    pointerType: 'mouse',
  });

describe('Editar Board: etapas', () => {
  it('clicar na etapa abre a configuração e ela permanece aberta', async () => {
    await renderModal();
    fireEvent.click(screen.getByRole('button', { name: 'Editar etapa Qualificado' }));
    expect(await screen.findByRole('dialog', { name: /^Etapa 2$/ })).toBeInTheDocument();
    await tick();
    await tick();
    expect(screen.getByRole('dialog', { name: /^Etapa 2$/ })).toBeInTheDocument();
    expect(screen.getByDisplayValue('Qualificado')).toBeInTheDocument();
    // O modal do board continua aberto por baixo
    expect(screen.getByRole('dialog', { name: /Editar Board/ })).toBeInTheDocument();
  });

  it('o menu "..." abre, permanece aberto e tem as ações da etapa', async () => {
    await renderModal();
    openMenu('Novo lead');
    expect(await screen.findByRole('menuitem', { name: /Editar etapa/ })).toBeInTheDocument();
    await tick();
    await tick();
    expect(screen.getByRole('menuitem', { name: /Editar etapa/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Copiar ID da etapa/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Mover para o fim/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Remover/ })).toBeInTheDocument();
  });

  it('"Editar etapa" no menu abre a configuração, que permanece aberta', async () => {
    await renderModal();
    openMenu('Novo lead');
    fireEvent.click(await screen.findByRole('menuitem', { name: /Editar etapa/ }));
    expect(await screen.findByRole('dialog', { name: /^Etapa 1$/ })).toBeInTheDocument();
    await tick();
    await tick();
    expect(screen.getByRole('dialog', { name: /^Etapa 1$/ })).toBeInTheDocument();
  });

  it('ESC fecha só a etapa; o board continua aberto', async () => {
    await renderModal();
    fireEvent.click(screen.getByRole('button', { name: 'Editar etapa Fechado' }));
    const dialog = await screen.findByRole('dialog', { name: /^Etapa 3$/ });
    await tick();
    fireEvent.keyDown(dialog, { key: 'Escape', code: 'Escape' });
    await tick();
    expect(screen.queryByRole('dialog', { name: /^Etapa 3$/ })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: /Editar Board/ })).toBeInTheDocument();
  });

  it('clicar fora da configuração da etapa fecha só ela', async () => {
    await renderModal();
    fireEvent.click(screen.getByRole('button', { name: 'Editar etapa Novo lead' }));
    const dialog = await screen.findByRole('dialog', { name: /^Etapa 1$/ });
    await tick();
    fireEvent.click(dialog.parentElement as HTMLElement);
    await tick();
    expect(screen.queryByRole('dialog', { name: /^Etapa 1$/ })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: /Editar Board/ })).toBeInTheDocument();
  });

  it('o ID da etapa nunca aparece escrito na tela', async () => {
    await renderModal();
    expect(screen.queryByText(/^s[123]$/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Editar etapa Novo lead' }));
    await screen.findByRole('dialog', { name: /^Etapa 1$/ });
    expect(screen.getByRole('button', { name: 'Copiar ID da etapa' })).toBeInTheDocument();
    expect(screen.queryByText('s1')).not.toBeInTheDocument();
  });
});
