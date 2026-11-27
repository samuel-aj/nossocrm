import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

// vi.hoisted: o vi.mock sobe para o topo do arquivo, então as funções simuladas também precisam subir.
const { mutateAsync, upload, transcribe, addToast, recorder } = vi.hoisted(() => ({
  mutateAsync: vi.fn(async (_input: unknown) => ({ data: { id: 'r1' } })),
  upload: vi.fn(async (_f: Blob, name: string, kind: string) => ({ path: `o/u/x_${name}`, kind, mime: 'image/png', size: 3 })),
  transcribe: vi.fn(async (_path: string) => 'texto do áudio'),
  addToast: vi.fn(),
  recorder: { onDone: null as null | ((b: Blob) => void) },
}));
vi.mock('@/lib/query/hooks', () => ({ useCreateFeedback: () => ({ mutateAsync, isPending: false }) }));
vi.mock('@/lib/feedback/client', () => ({ uploadFeedbackFile: upload, transcribeFeedbackAudio: transcribe }));
vi.mock('@/context/ToastContext', () => ({ useToast: () => ({ addToast }) }));
vi.mock('@/features/feedback/hooks/useAudioRecorder', () => ({
  useAudioRecorder: (onDone: (b: Blob) => void) => {
    recorder.onDone = onDone;
    return { recording: false, seconds: 0, start: vi.fn(), stop: vi.fn() };
  },
}));

import { FeedbackComposer } from './FeedbackComposer';

const png = (name = 'print.png') => new File([new Uint8Array([1, 2, 3])], name, { type: 'image/png' });
const audioBlob = () => new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/mpeg' });
const sendButton = () => screen.getByRole('button', { name: /enviar/i }) as HTMLButtonElement;
const dropZone = () => screen.getByRole('textbox', { name: /descreva/i }).parentElement!;
const drop = (files: File[]) => fireEvent.drop(dropZone(), { dataTransfer: { files } });

describe('FeedbackComposer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    upload.mockImplementation(async (_f: Blob, name: string, kind: string) => ({ path: `o/u/x_${name}`, kind, mime: 'image/png', size: 3 }));
    transcribe.mockImplementation(async () => 'texto do áudio');
  });

  it('começa com o envio desligado', () => {
    render(<FeedbackComposer screenPath="/boards" />);
    expect(sendButton()).toBeDisabled();
  });

  it('envia texto, tipo e tela de origem', async () => {
    render(<FeedbackComposer screenPath="/boards" />);
    fireEvent.change(screen.getByRole('textbox', { name: /descreva/i }), { target: { value: 'O botão some' } });
    fireEvent.click(screen.getByRole('button', { name: 'Bug' }));
    fireEvent.click(sendButton());
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

  it('avisa com o nome do arquivo quando o envio de um print falha', async () => {
    upload.mockRejectedValueOnce(new Error('falhou'));
    render(<FeedbackComposer screenPath="/" />);
    drop([png('tela-do-lead.png')]);
    await waitFor(() => expect(addToast).toHaveBeenCalledWith(expect.stringContaining('tela-do-lead.png'), 'error'));
    expect(screen.getByText('tela-do-lead.png')).toHaveClass('text-red-600');
  });

  it('soltar 11 imagens de uma vez sobe só 10 e avisa', async () => {
    render(<FeedbackComposer screenPath="/" />);
    drop(Array.from({ length: 11 }, (_, i) => png(`print-${i}.png`)));
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(10));
    expect(addToast).toHaveBeenCalledWith('Até 10 imagens por envio.', 'error');
    expect(screen.queryByText('print-10.png')).toBeNull();
  });

  it('conta as imagens que ainda estão subindo', async () => {
    upload.mockImplementation(() => new Promise(() => {})); // nunca termina: tudo fica "enviando"
    render(<FeedbackComposer screenPath="/" />);
    drop(Array.from({ length: 6 }, (_, i) => png(`a-${i}.png`)));
    drop(Array.from({ length: 5 }, (_, i) => png(`b-${i}.png`)));
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(10));
    expect(addToast).toHaveBeenCalledWith('Até 10 imagens por envio.', 'error');
  });

  it('aceita só um áudio colado ou arrastado', async () => {
    render(<FeedbackComposer screenPath="/" />);
    const mp3 = (name: string) => new File([new Uint8Array([1])], name, { type: 'audio/mpeg' });
    drop([mp3('um.mp3'), mp3('dois.mp3')]);
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    expect(upload).toHaveBeenCalledWith(expect.any(File), 'um.mp3', 'audio');
    expect(addToast).toHaveBeenCalledWith('Só um áudio por envio.', 'error');
  });

  it('uma gravação nova substitui o áudio que já estava na caixa', async () => {
    render(<FeedbackComposer screenPath="/" />);
    drop([new File([new Uint8Array([1])], 'antigo.mp3', { type: 'audio/mpeg' })]);
    expect(await screen.findByText('antigo.mp3')).toBeInTheDocument();
    await act(async () => { recorder.onDone!(audioBlob()); });
    await waitFor(() => expect(screen.queryByText('antigo.mp3')).toBeNull());
    expect(screen.getByText('audio.mp3')).toBeInTheDocument();
  });

  it('se a transcrição falha, o áudio enviado vai junto e dá para enviar só com ele', async () => {
    transcribe.mockRejectedValue(new Error('API key de IA não configurada'));
    render(<FeedbackComposer screenPath="/" />);
    await act(async () => { recorder.onDone!(audioBlob()); });
    await waitFor(() => expect(transcribe).toHaveBeenCalledWith('o/u/x_audio.mp3'));
    await waitFor(() => expect(sendButton()).toBeEnabled());
    expect(addToast).toHaveBeenCalledWith('Não deu para transcrever agora. O áudio vai junto mesmo assim.', 'info');
    expect(screen.getByText('audio.mp3')).not.toHaveClass('text-red-600');
    fireEvent.click(sendButton());
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync.mock.calls[0][0]).toMatchObject({
      body: '', transcript: null, attachments: [{ path: 'o/u/x_audio.mp3', kind: 'audio' }],
    });
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it('se o envio do áudio falha, marca o item e avisa', async () => {
    upload.mockRejectedValueOnce(new Error('falhou'));
    render(<FeedbackComposer screenPath="/" />);
    await act(async () => { recorder.onDone!(audioBlob()); });
    await waitFor(() => expect(addToast).toHaveBeenCalledWith('Não foi possível enviar o áudio.', 'error'));
    expect(screen.getByText('audio.mp3')).toHaveClass('text-red-600');
    expect(transcribe).not.toHaveBeenCalled();
    expect(sendButton()).toBeDisabled();
  });
});
