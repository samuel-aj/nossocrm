import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DealWhatsAppChat } from './DealWhatsAppChat';
import type { SendChatPayload, WaChatData, WaChatMessage, WaSender } from './useWhatsAppChat';

type SendCallbacks = {
  onSuccess?: () => void;
  onError?: (error: Error) => void;
  onSettled?: () => void;
};

const mocks = vi.hoisted(() => {
  // Install before the shared setup's lifecycle hooks: no fixture cleanup or
  // component query in this suite may reach a real service.
  const fetch = vi.fn(() => Promise.reject(new Error('Unexpected network request in sender test')));
  vi.stubGlobal('fetch', fetch);
  return {
    fetch,
    data: {} as Record<string, WaChatData>,
    mutate: vi.fn<(payload: SendChatPayload, callbacks?: SendCallbacks) => void>(),
    transcode: vi.fn<(blob: Blob) => Promise<Blob>>(),
    toast: vi.fn(),
  };
});

vi.mock('@/test/helpers/fixtures', () => ({ cleanupFixtures: vi.fn() }));
vi.mock('@/hooks/useWaAgentsAccess', () => ({
  useWaAgentsAccess: () => ({ agentsApproved: false, isAdmin: false, isLoading: false }),
}));
vi.mock('@/context/ToastContext', () => ({
  useToast: () => ({ showToast: mocks.toast, addToast: mocks.toast }),
}));
vi.mock('./audioTranscode', () => ({ transcodeToMp3: mocks.transcode }));
vi.mock('./useWhatsAppChat', () => ({
  useWhatsAppChat: (phone: string) => ({
    data: mocks.data[phone],
    isLoading: false,
    error: null,
    send: { mutate: mocks.mutate, isPending: false, isError: false, error: null },
    edit: { mutateAsync: vi.fn() },
    remove: { mutateAsync: vi.fn() },
  }),
  useOlderWhatsAppMessages: (_target: unknown, latest: WaChatMessage[]) => ({
    messages: latest,
    hasOlder: false,
    loading: false,
    error: null,
    loadOlder: vi.fn(),
  }),
}));

const first: WaSender = { id: 'first', provider: 'evolution', phoneNumber: '+551130000001', profileName: 'Equipe Primeiro' };
const second: WaSender = { id: 'second', provider: 'evolution', phoneNumber: '+551130000002', profileName: 'Equipe Segundo' };
const official: WaSender = { id: 'official', provider: 'meta_cloud', phoneNumber: '+551130000003', profileName: 'Equipe Oficial' };
const alice = { id: 'alice', name: 'Alice Exemplo', phone: '+5511999990001' };
const bruno = { id: 'bruno', name: 'Bruno Exemplo', phone: '+5511999990002' };

function message(id: string, senderId: string, at = '2026-10-20T12:00:00.000Z'): WaChatMessage {
  return {
    id, connection_id: senderId, direction: 'in', status: 'read', body: `Mensagem ${id}`,
    media_type: null, media_mime: null, media_url: null, from_phone: alice.phone,
    to_phone: null, wa_timestamp: at, created_at: at, sent_by: null, source: null,
    error: null, transcription: null,
  };
}

function chat(senderId: string | null, messages?: WaChatMessage[]): WaChatData {
  return {
    connected: true, hasConnection: true, provider: 'evolution',
    senders: [first, second, official],
    conversation: senderId ? {
      id: `conversation-${senderId}`, wa_phone: alice.phone, wa_name: alice.name,
      contact_id: alice.id, connection_id: senderId,
    } : null,
    messages: messages ?? (senderId ? [message(`history-${senderId}`, senderId)] : []),
    lastInboundByConnection: {},
    numbers: Object.fromEntries([first, second, official].map(sender => [sender.id, sender])),
  };
}

type ChatProps = React.ComponentProps<typeof DealWhatsAppChat> & { conversationScopeId?: string };
const clients: QueryClient[] = [];
function setup(overrides: Partial<ChatProps> = {}, onParentKeyDown?: React.KeyboardEventHandler<HTMLDivElement>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  clients.push(client);
  client.setQueryData(['messageTemplates'], { data: [{
    id: 'welcome', name: 'Boas-vindas oficial', type: 'whatsapp_api',
    body: 'Olá, {{contato.nome}}!', language: 'pt_BR', meta_name: 'boas_vindas',
    meta_status: 'APPROVED', connectionId: official.id, buttons: [],
  }] });
  const props: ChatProps = { contact: alice, conversationScopeId: 'lead-alice', ...overrides };
  const element = (next: ChatProps) => <QueryClientProvider client={client}>
    <div onKeyDown={onParentKeyDown}><DealWhatsAppChat {...next} /></div>
  </QueryClientProvider>;
  const view = render(element(props));
  return {
    ...view,
    rerenderChat: (next: Partial<ChatProps>) => view.rerender(element({ ...props, ...next })),
  };
}

function selectSender(sender: WaSender) {
  fireEvent.click(screen.getByTitle('Trocar o número que envia'));
  fireEvent.click(screen.getByRole('button', { name: new RegExp(sender.profileName!) }));
}

function typeText(text: string) {
  fireEvent.change(screen.getByPlaceholderText(/Escreva uma mensagem|Legenda/), { target: { value: text } });
}

function sendText() {
  fireEvent.click(screen.getByRole('button', { name: 'Enviar mensagem' }));
}

async function expectConfirmation(title = 'Enviar por outro número?') {
  const dialog = await screen.findByRole('alertdialog', { name: title });
  expect(mocks.mutate).not.toHaveBeenCalled();
  return dialog;
}

async function confirm() {
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar e enviar' }));
  await waitFor(() => expect(mocks.mutate).toHaveBeenCalledTimes(1));
}

async function finishSend(success: boolean, index = 0) {
  const callbacks = mocks.mutate.mock.calls[index][1];
  await act(async () => {
    if (success) callbacks?.onSuccess?.();
    else callbacks?.onError?.(new Error('Falha simulada'));
    callbacks?.onSettled?.();
  });
}

class FakeMediaRecorder {
  static isTypeSupported(mime: string) { return mime.includes('webm'); }
  state = 'inactive';
  mimeType = 'audio/webm';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  start() { this.state = 'recording'; }
  stop() {
    if (this.state === 'inactive') return;
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['test recording'], { type: this.mimeType }) });
    this.onstop?.();
  }
}

async function recordVoice(pause = true) {
  fireEvent.click(screen.getByRole('button', { name: 'Gravar áudio' }));
  await screen.findByText(/Gravando/);
  if (pause) {
    fireEvent.click(screen.getByRole('button', { name: 'Pausar' }));
    await screen.findByRole('button', { name: 'Descartar gravação' });
  }
}

beforeEach(() => {
  mocks.mutate.mockReset();
  mocks.transcode.mockReset().mockResolvedValue(new Blob(['converted recording'], { type: 'audio/mpeg' }));
  mocks.toast.mockReset();
  mocks.fetch.mockClear();
  mocks.data = { [alice.phone]: chat(first.id), [bruno.phone]: chat(second.id) };
  window.localStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:sender-test');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] }) },
  });
});

afterEach(() => {
  cleanup();
  clients.splice(0).forEach(client => client.clear());
  vi.restoreAllMocks();
  // Keep fetch mocked through the shared afterAll fixture hook.
});

describe('conversation sender confirmation in the actual chat', () => {
  it('uses the current contact history instead of another conversation stored globally', async () => {
    window.localStorage.setItem('wa-sender-connection', second.id);
    setup();
    expect(screen.getByTitle('Trocar o número que envia')).toHaveTextContent(first.phoneNumber!);
    typeText('Resposta da Alice');
    sendText();
    await waitFor(() => expect(mocks.mutate).toHaveBeenCalledOnce());
    expect(mocks.mutate.mock.calls[0][0]).toMatchObject({ text: 'Resposta da Alice', connectionId: first.id });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('confirms a changed sender once, names both numbers and skips a new warning after success', async () => {
    setup();
    selectSender(second);
    typeText('Mensagem confirmada');
    sendText();
    const dialog = await expectConfirmation();
    expect(dialog).toHaveTextContent(alice.name);
    expect(dialog).toHaveTextContent(first.phoneNumber!);
    expect(dialog).toHaveTextContent(second.phoneNumber!);
    const button = within(dialog).getByRole('button', { name: 'Confirmar e enviar' });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(mocks.mutate).toHaveBeenCalledOnce());
    expect(mocks.mutate.mock.calls[0][0]).toMatchObject({ text: 'Mensagem confirmada', connectionId: second.id });
    await finishSend(true);
    typeText('Próxima mensagem');
    sendText();
    await waitFor(() => expect(mocks.mutate).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('restores the text after failure and asks again before retrying the changed sender', async () => {
    setup();
    selectSender(second);
    typeText('Não perder na falha');
    sendText();
    await expectConfirmation();
    await confirm();
    await finishSend(false);
    expect(screen.getByPlaceholderText('Escreva uma mensagem...')).toHaveValue('Não perder na falha');
    sendText();
    await screen.findByRole('alertdialog', { name: 'Enviar por outro número?' });
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
  });

  it('returns to the previous number without sending or clearing the text', async () => {
    setup();
    selectSender(second);
    typeText('Rascunho preservado');
    sendText();
    await expectConfirmation();
    fireEvent.click(screen.getByRole('button', { name: 'Usar número anterior' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(screen.getByPlaceholderText('Escreva uma mensagem...')).toHaveValue('Rascunho preservado');
    expect(screen.getByTitle('Trocar o número que envia')).toHaveTextContent(first.phoneNumber!);
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it('handles Escape locally and preserves the armed reply and text without closing the parent lead', async () => {
    const onParentKeyDown = vi.fn();
    setup({}, onParentKeyDown);
    fireEvent.click(screen.getByRole('button', { name: 'Opções da mensagem' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Responder' }));
    expect(screen.getByRole('button', { name: 'Cancelar resposta' })).toBeInTheDocument();
    selectSender(second);
    typeText('Resposta citada preservada');
    sendText();
    const dialog = await expectConfirmation();
    fireEvent.keyDown(within(dialog).getByRole('button', { name: 'Voltar' }), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Cancelar resposta' })).toBeInTheDocument();
    expect(screen.getByText(`Respondendo a ${alice.name}`)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Escreva uma mensagem...')).toHaveValue('Resposta citada preservada');
    expect(onParentKeyDown).not.toHaveBeenCalled();
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it('keeps attachment and caption when dismissed, then sends the chosen file only after confirmation', async () => {
    const view = setup();
    const file = new File(['documento de teste'], 'contrato-teste.pdf', { type: 'application/pdf' });
    fireEvent.change(view.container.querySelector('input[type="file"]')!, { target: { files: [file] } });
    typeText('Legenda preservada');
    selectSender(second);
    sendText();
    const dialog = await expectConfirmation();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(screen.getByText('contrato-teste.pdf')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Legenda (opcional)...')).toHaveValue('Legenda preservada');
    sendText();
    await expectConfirmation();
    await confirm();
    expect(mocks.mutate.mock.calls[0][0]).toMatchObject({
      file, kind: 'document', text: 'Legenda preservada', connectionId: second.id,
    });
  });

  it.each([true, false])('preserves %s paused/direct voice on cancel and authorizes before conversion', async paused => {
    setup();
    selectSender(second);
    await recordVoice(paused);
    fireEvent.click(screen.getByRole('button', { name: 'Enviar áudio' }));
    const dialog = await expectConfirmation();
    expect(mocks.transcode).not.toHaveBeenCalled();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await screen.findByRole('button', { name: 'Descartar gravação' });
    expect(mocks.mutate).not.toHaveBeenCalled();
    expect(mocks.transcode).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Enviar áudio' }));
    await expectConfirmation();
    await confirm();
    expect(mocks.transcode).toHaveBeenCalledOnce();
    expect(mocks.mutate.mock.calls[0][0]).toMatchObject({ kind: 'audio', connectionId: second.id });
  });

  it('preserves the official template and its variables when dismissed and confirms its sender', async () => {
    setup();
    selectSender(official);
    fireEvent.click(screen.getByRole('button', { name: 'Reiniciar com um modelo' }));
    fireEvent.click(await screen.findByRole('button', { name: /Boas-vindas oficial/ }));
    const nameInput = screen.getByDisplayValue(alice.name);
    fireEvent.change(nameInput, { target: { value: 'Alice personalizada' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar modelo' }));
    const dialog = await expectConfirmation();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(screen.getByDisplayValue('Alice personalizada')).toBeInTheDocument();
    expect(screen.getByText('Olá, Alice personalizada!')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Enviar modelo' }));
    await expectConfirmation();
    await confirm();
    expect(mocks.mutate.mock.calls[0][0]).toMatchObject({
      connectionId: official.id,
      template: { name: 'boas_vindas', language: 'pt_BR', params: ['Alice personalizada'] },
    });
  });

  it('asks before the first send when there is no history and several numbers', async () => {
    mocks.data[alice.phone] = chat(null);
    setup();
    typeText('Primeiro contato');
    sendText();
    const dialog = await expectConfirmation('Confirmar número de envio');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Voltar' }));
    expect(screen.getByPlaceholderText('Escreva uma mensagem...')).toHaveValue('Primeiro contato');
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it('invalidates an open confirmation when moving to another contact and selects that contact number', async () => {
    const view = setup();
    selectSender(second);
    typeText('Somente Alice');
    sendText();
    const dialog = await expectConfirmation();
    const staleButton = within(dialog).getByRole('button', { name: 'Confirmar e enviar' });
    view.rerenderChat({ contact: bruno, conversationScopeId: 'lead-bruno' });
    fireEvent.click(staleButton);
    await act(async () => {});
    expect(mocks.mutate).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('Escreva uma mensagem...')).toHaveValue('');
    expect(screen.getByTitle('Trocar o número que envia')).toHaveTextContent(second.phoneNumber!);
  });

  it('also invalidates confirmation when changing leads for the same contact and phone', async () => {
    const view = setup();
    selectSender(second);
    typeText('Somente primeiro lead');
    sendText();
    const dialog = await expectConfirmation();
    const staleButton = within(dialog).getByRole('button', { name: 'Confirmar e enviar' });
    view.rerenderChat({ conversationScopeId: 'another-lead-for-alice' });
    fireEvent.click(staleButton);
    await act(async () => {});
    expect(mocks.mutate).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('Escreva uma mensagem...')).toHaveValue('');
  });

  it('does not dispatch an audio whose conversion finishes after switching contacts', async () => {
    let finishConversion!: (value: Blob) => void;
    mocks.transcode.mockImplementation(() => new Promise(resolve => { finishConversion = resolve; }));
    const view = setup();
    await recordVoice();
    fireEvent.click(screen.getByRole('button', { name: 'Enviar áudio' }));
    await waitFor(() => expect(mocks.transcode).toHaveBeenCalledOnce());
    view.rerenderChat({ contact: bruno, conversationScopeId: 'lead-bruno' });
    await act(async () => finishConversion(new Blob(['old voice'], { type: 'audio/mpeg' })));
    expect(mocks.mutate).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText('Escreva uma mensagem...')).toHaveValue('');
    expect(screen.queryByRole('button', { name: 'Descartar gravação' })).not.toBeInTheDocument();
  });

  it('does not redirect an audio to a sender selected while conversion is running', async () => {
    let finishConversion!: (value: Blob) => void;
    mocks.transcode.mockImplementation(() => new Promise(resolve => { finishConversion = resolve; }));
    setup();
    await recordVoice();
    fireEvent.click(screen.getByRole('button', { name: 'Enviar áudio' }));
    await waitFor(() => expect(mocks.transcode).toHaveBeenCalledOnce());
    selectSender(second);
    await act(async () => finishConversion(new Blob(['old voice'], { type: 'audio/mpeg' })));
    expect(mocks.mutate).not.toHaveBeenCalled();
    expect(screen.getByTitle('Trocar o número que envia')).toHaveTextContent(second.phoneNumber!);
    expect(screen.getByRole('button', { name: 'Descartar gravação' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Enviar áudio' }));
    await expectConfirmation();
  });

  it('does not send a discarded voice note when its pending conversion completes', async () => {
    let finishConversion!: (value: Blob) => void;
    mocks.transcode.mockImplementation(() => new Promise(resolve => { finishConversion = resolve; }));
    setup();
    await recordVoice();
    fireEvent.click(screen.getByRole('button', { name: 'Enviar áudio' }));
    await waitFor(() => expect(mocks.transcode).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button', { name: 'Descartar gravação' }));
    expect(screen.queryByRole('button', { name: 'Descartar gravação' })).not.toBeInTheDocument();
    await act(async () => finishConversion(new Blob(['discarded voice'], { type: 'audio/mpeg' })));
    expect(mocks.mutate).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText('Escreva uma mensagem...')).toHaveValue('');
    expect(screen.queryByRole('button', { name: 'Remover anexo' })).not.toBeInTheDocument();
  });

  it('does not send a removed attachment when its sticker conversion completes', async () => {
    let finishBitmap!: (value: ImageBitmap) => void;
    const createBitmap = vi.fn(() => new Promise<ImageBitmap>(resolve => { finishBitmap = resolve; }));
    vi.stubGlobal('createImageBitmap', createBitmap);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    const toBlob = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => {
      callback(new Blob(['converted sticker'], { type: 'image/webp' }));
    });
    const view = setup();
    const file = new File(['test image'], 'figurinha-teste.png', { type: 'image/png' });
    fireEvent.change(view.container.querySelector('input[type="file"]')!, { target: { files: [file] } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Enviar como figurinha' }));
    sendText();
    await waitFor(() => expect(createBitmap).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button', { name: 'Remover anexo' }));
    await act(async () => finishBitmap({ width: 512, height: 512 } as ImageBitmap));
    expect(toBlob).toHaveBeenCalledOnce();
    expect(mocks.mutate).not.toHaveBeenCalled();
    expect(screen.queryByText('figurinha-teste.png')).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('Escreva uma mensagem...')).toHaveValue('');
  });

  it('does not restore a failed old message into a newly opened contact draft', async () => {
    const view = setup();
    typeText('Mensagem da Alice');
    sendText();
    await waitFor(() => expect(mocks.mutate).toHaveBeenCalledOnce());
    view.rerenderChat({ contact: bruno, conversationScopeId: 'lead-bruno' });
    typeText('Rascunho do Bruno');
    await finishSend(false);
    expect(screen.getByPlaceholderText('Escreva uma mensagem...')).toHaveValue('Rascunho do Bruno');
    expect(screen.queryByText('Mensagem da Alice')).not.toBeInTheDocument();
  });
});
