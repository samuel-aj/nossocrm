import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AgentTestChat } from './AgentTestChat';

const h = vi.hoisted(() => ({ send: vi.fn(), toast: vi.fn() }));
vi.mock('./useWaAgents', () => ({ useTestWaAgent: () => ({ mutateAsync: h.send, isPending: false }) }));
vi.mock('@/context/ToastContext', () => ({ useToast: () => ({ showToast: h.toast }) }));
vi.mock('@/lib/wa-agents/typing', () => ({ typingDelayMs: () => 0 }));
vi.mock('./VoicePreview', () => ({ VoicePreview: () => null }));

beforeEach(() => {
  vi.clearAllMocks();
  h.send.mockImplementation(async ({ sessionId }) => ({ sessionId, text: 'Resposta simulada', lines: ['Resposta simulada'], toolCalls: [], media: ['boas_vindas'], usage: null }));
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

async function send(text: string, calls: number) {
  fireEvent.change(screen.getByRole('textbox', { name: 'Mensagem de teste' }), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Enviar mensagem de teste' }));
  await waitFor(() => expect(h.send).toHaveBeenCalledTimes(calls));
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Mensagem de teste' })).not.toBeDisabled());
}

it('mantém a sessão no mesmo teste e cria outra ao Limpar, sem reutilizar recibos', async () => {
  render(<AgentTestChat agentId="agent" />);
  await send('Olá', 1);
  const firstId = h.send.mock.calls[0][0].sessionId;
  expect(firstId).toMatch(/^[a-f0-9-]{36}$/);
  await send('Maria', 2);
  expect(h.send.mock.calls[1][0]).toMatchObject({ sessionId: firstId, messages: expect.arrayContaining([expect.objectContaining({ role: 'assistant', media: ['boas_vindas'] })]) });
  fireEvent.click(screen.getByRole('button', { name: 'Limpar' }));
  await send('Outro cliente', 3);
  expect(h.send.mock.calls[2][0].sessionId).not.toBe(firstId);
  expect(h.send.mock.calls[2][0].messages).toEqual([expect.objectContaining({ role: 'user', text: 'Outro cliente' })]);
});
