import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WhatsAppPairingPanel } from './WhatsAppPairingPanel';

vi.mock('@/components/ui/NativeSelect', () => ({ NativeSelect: ({ searchable: _searchable, ...props }: React.SelectHTMLAttributes<HTMLSelectElement> & { searchable?: boolean }) => <select {...props} /> }));
const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const setup = () => {
  const onConnected = vi.fn(), onClose = vi.fn();
  render(<WhatsAppPairingPanel connectionId="conn-a" onConnected={onConnected} onClose={onClose} />);
  return { onConnected, onClose };
};
const fill = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Conectar por código' }));
  fireEvent.change(screen.getByLabelText('Número do WhatsApp'), { target: { value: '(11) 99999-0000' } });
};
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('WhatsApp pairing panel', () => {
  it('lets the user choose before initiating a session, then sends the normalized phone', async () => {
    const fetch = vi.fn().mockResolvedValue(reply({ state: 'connecting', pairingCode: 'ABCD2345' }));
    vi.stubGlobal('fetch', fetch); setup();
    expect(fetch).not.toHaveBeenCalled(); fill();
    fireEvent.click(screen.getByRole('button', { name: 'Gerar código', exact: true }));
    expect(await screen.findByLabelText('Código de pareamento')).toHaveTextContent('ABCD-2345');
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ id: 'conn-a', method: 'code', phone: '+5511999990000' });
    expect(screen.getByText('Conectar com número de telefone')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Número do WhatsApp'), { target: { value: '(21) 99999-0000' } });
    expect(screen.queryByLabelText('Código de pareamento')).not.toBeInTheDocument();
  });
  it('validates before requesting and displays provider failure with an enabled retry', async () => {
    const fetch = vi.fn().mockResolvedValue(reply({ error: 'A Evolution não retornou um código.' }, 502));
    vi.stubGlobal('fetch', fetch); setup(); fill();
    fireEvent.change(screen.getByLabelText('Número do WhatsApp'), { target: { value: '123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Gerar código', exact: true }));
    expect(screen.getByRole('alert')).toHaveTextContent('telefone válido'); expect(fetch).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Número do WhatsApp'), { target: { value: '(11) 99999-0000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Gerar código', exact: true }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Evolution'));
    expect(screen.getByRole('button', { name: 'Gerar código', exact: true })).toBeEnabled();
  });
  it('hides an expired code and stops polling', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockResolvedValueOnce(reply({ state: 'connecting', pairingCode: 'ABCD2345' }))
      .mockResolvedValue(reply({ state: 'disconnected' }));
    vi.stubGlobal('fetch', fetch); setup(); fill();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Gerar código', exact: true })); });
    expect(screen.getByLabelText('Código de pareamento')).toHaveTextContent('ABCD-2345');
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    expect(screen.queryByLabelText('Código de pareamento')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('expirou');
    await act(async () => { await vi.advanceTimersByTimeAsync(20000); });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('recognizes completion without another linking request', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockResolvedValueOnce(reply({ state: 'connecting', qrBase64: 'data:image/png;base64,AA==' }))
      .mockResolvedValue(reply({ state: 'connected' }));
    vi.stubGlobal('fetch', fetch); const { onConnected } = setup();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Gerar QR Code' })); });
    expect(screen.getByAltText('QR Code para conectar o WhatsApp')).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    expect(onConnected).toHaveBeenCalledOnce();
    expect(fetch.mock.calls.filter(call => call[1]?.method === 'POST')).toHaveLength(1);
  });
  it('discards a stale poll when switching from code back to QR', async () => {
    vi.useFakeTimers();
    let resolvePoll!: (value: Response) => void;
    const fetch = vi.fn().mockResolvedValueOnce(reply({ state: 'connecting', pairingCode: 'ABCD2345' }))
      .mockImplementationOnce(() => new Promise<Response>(resolve => { resolvePoll = resolve; }));
    vi.stubGlobal('fetch', fetch); setup(); fill();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Gerar código', exact: true })); });
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    fireEvent.click(screen.getByRole('button', { name: 'QR Code', exact: true }));
    await act(async () => { resolvePoll(reply({ state: 'connecting', pairingCode: 'STALE123' })); });
    fireEvent.click(screen.getByRole('button', { name: 'Conectar por código' }));
    expect(screen.queryByLabelText('Código de pareamento')).not.toBeInTheDocument();
  });
});
