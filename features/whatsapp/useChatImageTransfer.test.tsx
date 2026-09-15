import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useChatImageTransfer } from './useChatImageTransfer';
const image = new File(['image'], 'foto.png', { type: 'image/png' });
function Harness({ onFile, onError, blocked = false }: { onFile: (file: File) => void; onError: (message: string) => void; blocked?: boolean }) {
  const transfer = useChatImageTransfer({ onFile, onError, blocked });
  return <div data-testid="chat" {...transfer.dropHandlers}><textarea aria-label="Mensagem" onPaste={transfer.onPaste} />{transfer.draggingImage && <span>Solte a imagem</span>}</div>;
}
describe('chat image transfer', () => {
  it('pastes the image from clipboard items and suppresses the filename without consuming plain text', () => {
    const onFile = vi.fn(); render(<Harness onFile={onFile} onError={vi.fn()} />);
    const field = screen.getByRole('textbox');
    expect(fireEvent.paste(field, { clipboardData: { files: [], items: [{ kind: 'file', getAsFile: () => image }] } })).toBe(false);
    expect(onFile).toHaveBeenCalledWith(image);
    expect(fireEvent.paste(field, { clipboardData: { files: [], items: [{ kind: 'string' }] } })).toBe(true);
    expect(onFile).toHaveBeenCalledTimes(1);
  });
  it('previews dropped images, resets the overlay and prevents navigation', () => {
    const onFile = vi.fn(); render(<Harness onFile={onFile} onError={vi.fn()} />);
    const chat = screen.getByTestId('chat');
    const dataTransfer = { types: ['Files'], files: [image] };
    fireEvent.dragEnter(chat, { dataTransfer });
    expect(screen.getByText('Solte a imagem')).toBeInTheDocument();
    expect(fireEvent.drop(chat, { dataTransfer })).toBe(false);
    expect(onFile).toHaveBeenCalledWith(image);
    expect(screen.queryByText('Solte a imagem')).not.toBeInTheDocument();
  });
  it('does not lose images silently when multiple files or blocked sending are involved', () => {
    const onFile = vi.fn(), onError = vi.fn();
    const view = render(<Harness onFile={onFile} onError={onError} />);
    fireEvent.drop(screen.getByTestId('chat'), { dataTransfer: { types: ['Files'], files: [image, image] } });
    expect(onError).toHaveBeenCalled(); expect(onFile).not.toHaveBeenCalled();
    view.rerender(<Harness onFile={onFile} onError={onError} blocked />);
    fireEvent.paste(screen.getByRole('textbox'), { clipboardData: { files: [image] } });
    expect(onFile).not.toHaveBeenCalled();
  });
});
