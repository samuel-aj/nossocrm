import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

// vi.hoisted: o vi.mock sobe para o topo do arquivo, então as funções simuladas também precisam subir.
const { mutateAsync, upload } = vi.hoisted(() => ({
  mutateAsync: vi.fn(async (_input: unknown) => ({ data: { id: 'r1' } })),
  upload: vi.fn(async (_f: Blob, name: string, kind: string) => ({ path: `o/u/x_${name}`, kind, mime: 'image/png', size: 3 })),
}));
vi.mock('@/lib/query/hooks', () => ({ useCreateFeedback: () => ({ mutateAsync, isPending: false }) }));
vi.mock('@/lib/feedback/client', () => ({ uploadFeedbackFile: upload, transcribeFeedbackAudio: vi.fn() }));
vi.mock('@/context/ToastContext', () => ({ useToast: () => ({ addToast: vi.fn() }) }));

import { FeedbackComposer } from './FeedbackComposer';

const png = () => new File([new Uint8Array([1, 2, 3])], 'print.png', { type: 'image/png' });

describe('FeedbackComposer', () => {
  beforeEach(() => { mutateAsync.mockClear(); upload.mockClear(); });

  it('começa com o envio desligado', () => {
    render(<FeedbackComposer screenPath="/boards" />);
    expect(screen.getByRole('button', { name: /enviar/i })).toBeDisabled();
  });

  it('envia texto, tipo e tela de origem', async () => {
    render(<FeedbackComposer screenPath="/boards" />);
    fireEvent.change(screen.getByRole('textbox', { name: /descreva/i }), { target: { value: 'O botão some' } });
    fireEvent.click(screen.getByRole('button', { name: 'Bug' }));
    fireEvent.click(screen.getByRole('button', { name: /enviar/i }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      body: 'O botão some', kind: 'bug', screenPath: '/boards', attachments: [],
    })));
  });

  it('aceita print colado', async () => {
    render(<FeedbackComposer screenPath="/" />);
    const box = screen.getByRole('textbox', { name: /descreva/i });
    fireEvent.paste(box, { clipboardData: { files: [png()], items: [] } });
    await waitFor(() => expect(upload).toHaveBeenCalledWith(expect.any(File), 'print.png', 'image'));
    expect(await screen.findByText('print.png')).toBeInTheDocument();
  });

  it('aceita vários arquivos de uma vez pelo seletor', async () => {
    render(<FeedbackComposer screenPath="/" />);
    const input = screen.getByLabelText(/anexar/i) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [png(), png(), png()] } });
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(3));
  });
});
