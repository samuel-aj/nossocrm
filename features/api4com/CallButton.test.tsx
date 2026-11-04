import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CallButton } from './CallButton';
import { Api4comPhoneProvider } from './phone/Api4comPhoneProvider';

vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ organizationId: 'org-1', user: { id: 'user-1' } }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/features/deals/lead/leadHistoryInvalidation', () => ({ invalidateLeadHistory: vi.fn(async () => undefined) }));

type Handler = (e?: unknown) => void;
class Emitter {
  handlers = new Map<string, Handler[]>();
  on(event: string, h: Handler) {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), h]);
    return this;
  }
  emit(event: string, payload?: unknown) {
    for (const h of this.handlers.get(event) ?? []) h(payload);
  }
}
class FakeSession extends Emitter {
  ended = false;
  remote_identity = { uri: { user: '1000' } };
  connection = null;
  answer = vi.fn(() => queueMicrotask(() => this.emit('confirmed')));
  terminate = vi.fn(() => {
    this.ended = true;
    this.emit('ended', { cause: 'Terminated' });
  });
  mute() {}
  unmute() {}
  sendDTMF() {}
  isEnded() {
    return this.ended;
  }
}
class FakeUa extends Emitter {
  start() {
    queueMicrotask(() => this.emit('registered', {}));
  }
  stop() {}
  unregister() {}
}

const h = vi.hoisted(() => ({ ua: null as unknown, mic: vi.fn(async () => undefined) }));
vi.mock('./phone/sipPhone', async (original) => {
  const real = await original<typeof import('./phone/sipPhone')>();
  return {
    ...real,
    createJsSipUa: async () => h.ua,
    ensureMicrophone: h.mic,
    browserInstanceId: () => '11111111-1111-4111-8111-111111111111',
    createRemoteAudio: () => ({ play: () => undefined, setOutput: async () => true, setVolume: () => undefined, canChooseOutput: () => true }),
  };
});

const ME = { connected: true, name: 'Vendedora', email: null, extension: '1000', domain: 'empresa.api4com.com', webhook_ok: true, verified_at: null, last_error: null, token_hint: 'tok-…123' };
const CREDS = { wsUrl: 'wss://empresa.api4com.com:6443', uri: 'sip:1000@empresa.api4com.com', username: '1000', password: 'x', realm: 'empresa.api4com.com' };
const row = (over: Record<string, unknown>) => ({ id: 'row-1', status: 'ringing', result: null, answered_at: null, duration: null, error: null, ...over });

function setup(routes: (url: string, init?: RequestInit) => { status?: number; body: unknown }, phone: string | null = '+5511987654321') {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const out = routes(String(url), init);
      return new Response(JSON.stringify(out.body), { status: out.status ?? 200, headers: { 'content-type': 'application/json' } });
    })
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Api4comPhoneProvider>
        <CallButton dealId="00000000-0000-4000-8000-000000000001" contactId={null} phone={phone} label="Maria Silva" />
      </Api4comPhoneProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  h.ua = new FakeUa();
  h.mic.mockReset();
  h.mic.mockResolvedValue(undefined);
  localStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

describe('Ligar pelo telefone do CRM', () => {
  it('não aparece para quem não conectou a API4com', async () => {
    setup(() => ({ body: { connected: false } }));
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /Ligar/ })).toBeNull();
  });

  it('contato sem telefone: botão aparece desabilitado com o motivo', async () => {
    setup((url) => (url.endsWith('/me') ? { body: ME } : { status: 404, body: {} }), null);
    const btn = await screen.findByRole('button', { name: /Ligar/ });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('title', 'O contato não tem telefone cadastrado');
  });

  it('liga o telefone, atende sozinho o toque da central e acompanha até o resultado', async () => {
    let polls = 0;
    const ua = h.ua as FakeUa;
    setup((url, init) => {
      if (url.endsWith('/me')) return { body: ME };
      if (url.endsWith('/sip')) return { body: CREDS };
      if (url.endsWith('/calls') && init?.method === 'POST') {
        expect(JSON.parse(String(init.body))).toMatchObject({ phone: '+5511987654321', deal_id: '00000000-0000-4000-8000-000000000001' });
        // A central toca no ramal com o cabeçalho do clique para ligar
        const session = new FakeSession();
        ua.emit('newRTCSession', { originator: 'remote', session, request: { getHeader: () => 'true' } });
        expect(session.answer).toHaveBeenCalled();
        return { body: { call: row({}) } };
      }
      if (url.includes('/calls/row-1')) {
        polls += 1;
        return { body: { call: polls < 2 ? row({ status: 'answered', answered_at: new Date().toISOString() }) : row({ status: 'ended', result: 'answered', duration: 65 }) } };
      }
      return { status: 404, body: {} };
    });
    fireEvent.click(await screen.findByRole('button', { name: /Ligar/ }));
    // A janela da ligação aparece no clique, antes de o cliente atender
    expect(screen.getByRole('region', { name: 'Ligação' })).toBeInTheDocument();
    expect(screen.getByText('Preparando a ligação')).toBeInTheDocument();
    await waitFor(() => expect(h.mic).toHaveBeenCalled());
    // Desligar no topo da conversa e Encerrar na janela da ligação
    expect(await screen.findByRole('button', { name: /Desligar/ }, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Encerrar/ })).toBeInTheDocument();
    expect(await screen.findByText(/Em ligação/, {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Microfone/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Lead/ })).toBeInTheDocument();
    expect(await screen.findByText(/Atendida · 1 min 5 s/, {}, { timeout: 6000 })).toBeInTheDocument();
    expect(screen.getByText('Registrada no histórico do lead.')).toBeInTheDocument();
  }, 15000);

  it('Encerrar vale com um clique: some da tela na hora e manda a central desligar', async () => {
    const ua = h.ua as FakeUa;
    let session: FakeSession | null = null;
    const hangups: string[] = [];
    setup((url, init) => {
      if (url.endsWith('/me')) return { body: ME };
      if (url.endsWith('/sip')) return { body: CREDS };
      if (url.endsWith('/calls') && init?.method === 'POST') {
        session = new FakeSession();
        ua.emit('newRTCSession', { originator: 'remote', session, request: { getHeader: () => 'true' } });
        return { body: { call: row({}) } };
      }
      if (url.endsWith('/hangup')) {
        hangups.push(url);
        return { body: { call: row({}) } };
      }
      // A central ainda não avisou o fim: a linha continua "chamando"
      if (url.includes('/calls/row-1')) return { body: { call: row({}) } };
      return { status: 404, body: {} };
    });
    fireEvent.click(await screen.findByRole('button', { name: /Ligar/ }));
    const encerrar = await screen.findByRole('button', { name: /Encerrar/ }, { timeout: 3000 });
    await screen.findByText('Tocando no celular do cliente');
    fireEvent.click(encerrar);
    // Na hora, sem esperar o aviso da central
    expect(screen.getByText('Ligação encerrada')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Encerrar/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Desligar/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Ligar/ })).toBeEnabled();
    expect((session as unknown as FakeSession).terminate).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(hangups).toEqual(['/api/integrations/api4com/calls/row-1/hangup']));
  });

  it('mostra o motivo quando a API4com recusa a ligação', async () => {
    setup((url, init) => {
      if (url.endsWith('/me')) return { body: ME };
      if (url.endsWith('/sip')) return { body: CREDS };
      if (init?.method === 'POST' && url.endsWith('/calls')) return { status: 422, body: { error: 'A API4com não aceitou o número do contato.' } };
      return { status: 404, body: {} };
    });
    fireEvent.click(await screen.findByRole('button', { name: /Ligar/ }));
    expect(await screen.findByText('A API4com não aceitou o número do contato.')).toBeInTheDocument();
  });

  it('microfone bloqueado: explica e não chama a API4com', async () => {
    h.mic.mockRejectedValueOnce(new Error('O navegador bloqueou o microfone.'));
    const calls: string[] = [];
    setup((url, init) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (url.endsWith('/me')) return { body: ME };
      return { status: 404, body: {} };
    });
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: /Ligar/ }));
    });
    expect(await screen.findByText('O navegador bloqueou o microfone.')).toBeInTheDocument();
    expect(calls.some((c) => c.includes('/calls'))).toBe(false);
  });
});
