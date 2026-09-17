import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WhatsAppChatDemo } from './WhatsAppChatDemo';

describe('local WhatsApp demonstration', () => {
  const network = vi.fn(() => { throw new Error('Demo must not call the network'); });
  beforeEach(() => {
    vi.stubGlobal('fetch', network); network.mockClear();
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:local-demo');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('sends and edits locally through the actual message menu and editor', async () => {
    render(<WhatsAppChatDemo startedAt={new Date().toISOString()} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Mensagem de teste' }), { target: { value: 'Texto local' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar na simulação' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Opções da mensagem' })[1]);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Editar' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Texto da mensagem' }), { target: { value: 'Texto corrigido' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByText('Texto corrigido')).toBeInTheDocument();
    expect(screen.getAllByText(/^Editada \d{2}:\d{2}$/)).toHaveLength(2);
    expect(screen.getByText('Texto local')).toHaveClass('line-through');
    expect(network).not.toHaveBeenCalled();
  });

  it('previews pasted/dropped images, sends locally and clears them on reset', () => {
    render(<WhatsAppChatDemo startedAt={new Date().toISOString()} />);
    const file = new File(['image'], 'teste.png', { type: 'image/png' });
    const transfer = { files: [file], types: ['Files'], items: [] };
    const composer = screen.getByRole('textbox', { name: 'Mensagem de teste' });
    fireEvent.paste(composer, { clipboardData: transfer });
    expect(screen.getByAltText('Prévia da imagem')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remover imagem' }));
    expect(screen.queryByAltText('Prévia da imagem')).not.toBeInTheDocument();
    fireEvent.drop(composer, { dataTransfer: transfer });
    expect(screen.getByAltText('Prévia da imagem')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Enviar na simulação' }));
    expect(screen.queryByAltText('Prévia da imagem')).not.toBeInTheDocument();
    expect(screen.getAllByRole('img')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Reiniciar teste' }));
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:local-demo');
    expect(network).not.toHaveBeenCalled();
  });
});
