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
  starts = 0;
  start() {
    this.starts++;
    queueMicrotask(() => this.emit('registered', {}));
  }
  stop() {}
  unregister() {
    queueMicrotask(() => this.emit('unregistered', {}));
  }
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

/** Botão do topo da conversa (o do balão é "Ligar para ..."). */
const HEADER = { name: /^Ligar \(/ };

/** Clica em Ligar e confirma o número no balão. */
async function ligar(confirm: RegExp = /^Ligar para/) {
  fireEvent.click(await screen.findByRole('button', HEADER));
  fireEvent.click(await screen.findByRole('button', { name: confirm }));
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

  it('confirma o número antes de ligar; Cancelar não liga', async () => {
    const calls: string[] = [];
    setup((url, init) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      return url.endsWith('/me') ? { body: ME } : { status: 404, body: {} };
    });
    fireEvent.click(await screen.findByRole('button', HEADER));
    const dialog = screen.getByRole('dialog', { name: 'Confirmar o número da ligação' });
    expect(dialog).toHaveTextContent('Telefone do cadastro');
    expect(dialog).toHaveTextContent('(11) 98765-4321');
    const confirm = screen.getByRole('button', { name: 'Ligar para (11) 98765-4321' });
    await waitFor(() => expect(confirm).toHaveFocus());
    // Nada sai antes de confirmar
    expect(h.mic).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(h.mic).not.toHaveBeenCalled();
    expect(calls.some((c) => c.includes('/calls'))).toBe(false);
  });

  it('liga para outro número digitado na hora, sem mudar o cadastro', async () => {
    const ua = h.ua as FakeUa;
    const bodies: unknown[] = [];
    setup((url, init) => {
      if (url.endsWith('/me')) return { body: ME };
      if (url.endsWith('/sip')) return { body: CREDS };
      if (url.endsWith('/calls') && init?.method === 'POST') {
        bodies.push(JSON.parse(String(init.body)));
        ua.emit('newRTCSession', { originator: 'remote', session: new FakeSession(), request: { getHeader: () => 'true' } });
        return { body: { call: row({}) } };
      }
      if (url.includes('/calls/row-1')) return { body: { call: row({}) } };
      return { status: 404, body: {} };
    });
    fireEvent.click(await screen.findByRole('button', HEADER));
    const field = screen.getByRole('textbox', { name: 'Digite outro número' });
    fireEvent.change(field, { target: { value: '(21) 9888' } });
    // Número incompleto: avisa e não deixa ligar
    expect(screen.getByText('Confira o DDD e o número.')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Outro número' })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Ligar' })).toBeDisabled();
    fireEvent.change(field, { target: { value: '(21) 98888-7777' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ligar para (21) 98888-7777' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(await screen.findByText('Tocando no celular do cliente', {}, { timeout: 4000 })).toBeInTheDocument();
    expect(bodies).toEqual([expect.objectContaining({ phone: '+5521988887777', deal_id: '00000000-0000-4000-8000-000000000001' })]);
    expect(screen.getByText('(21) 98888-7777')).toBeInTheDocument();
  });

  it('contato sem telefone: o balão abre direto no campo de outro número', async () => {
    setup((url) => (url.endsWith('/me') ? { body: ME } : { status: 404, body: {} }), null);
    const btn = await screen.findByRole('button', HEADER);
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    expect(screen.getByRole('dialog')).toHaveTextContent('Sem telefone cadastrado');
    expect(screen.getByRole('radio', { name: /Telefone do cadastro/ })).toBeDisabled();
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Digite outro número' })).toHaveFocus());
    expect(screen.getByRole('button', { name: 'Ligar' })).toBeDisabled();
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
    await ligar();
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
    // Sem teclado na janela da ligação
    expect(screen.queryByRole('button', { name: /Teclado/ })).toBeNull();
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
    await ligar();
    const encerrar = await screen.findByRole('button', { name: /Encerrar/ }, { timeout: 3000 });
    await screen.findByText('Tocando no celular do cliente');
    fireEvent.click(encerrar);
    // Na hora, sem esperar o aviso da central
    expect(screen.getByText('Ligação encerrada')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Encerrar/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Desligar/ })).toBeNull();
    expect(screen.getByRole('button', HEADER)).toBeEnabled();
    expect((session as unknown as FakeSession).terminate).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(hangups).toEqual(['/api/integrations/api4com/calls/row-1/hangup']));
  });

  it('telefone do CRM recusou o toque (424): mostra o motivo real e guarda o resumo técnico', async () => {
    const ua = h.ua as FakeUa;
    const diags: Array<{ url: string; body: unknown }> = [];
    setup((url, init) => {
      if (url.endsWith('/me')) return { body: ME };
      if (url.endsWith('/sip')) return { body: CREDS };
      if (url.endsWith('/calls') && init?.method === 'POST') {
        const session = new FakeSession();
        session.answer = vi.fn(() => queueMicrotask(() => session.emit('failed', { cause: 'Incompatible SDP', originator: 'local' })));
        ua.emit('newRTCSession', { originator: 'remote', session, request: { getHeader: () => 'true' } });
        return { status: 424, body: { error: 'O telefone do CRM não estava conectado ao ramal.', call_id: 'row-9' } };
      }
      if (url.endsWith('/diag')) {
        diags.push({ url, body: JSON.parse(String(init?.body)) });
        return { body: { ok: true } };
      }
      return { status: 404, body: {} };
    });
    await ligar();
    expect(await screen.findByText(/não conseguiu combinar o áudio/)).toBeInTheDocument();
    await waitFor(() => expect(diags).toHaveLength(1));
    expect(diags[0].url).toBe('/api/integrations/api4com/calls/row-9/diag');
    expect(diags[0].body).toMatchObject({ diag: { integrated: true, endedCause: 'Incompatible SDP' } });
  });

  it('central diz que o telefone não está no ramal e não tocou aqui: refaz o registro e liga de novo sozinho', async () => {
    const ua = h.ua as FakeUa;
    const posts: string[] = [];
    const diags: Array<{ url: string; body: unknown }> = [];
    setup((url, init) => {
      if (url.endsWith('/me')) return { body: ME };
      if (url.endsWith('/sip')) return { body: CREDS };
      if (url.endsWith('/calls') && init?.method === 'POST') {
        posts.push(url);
        if (posts.length === 1) return { status: 424, body: { error: 'O telefone do CRM não estava conectado ao ramal.', call_id: 'row-perdida' } };
        ua.emit('newRTCSession', { originator: 'remote', session: new FakeSession(), request: { getHeader: () => 'true' } });
        return { body: { call: row({}) } };
      }
      if (url.endsWith('/diag')) {
        diags.push({ url, body: JSON.parse(String(init?.body)) });
        return { body: { ok: true } };
      }
      if (url.includes('/calls/row-1')) return { body: { call: row({}) } };
      return { status: 404, body: {} };
    });
    await ligar();
    expect(await screen.findByText('Tocando no celular do cliente', {}, { timeout: 4000 })).toBeInTheDocument();
    expect(posts).toHaveLength(2);
    expect(ua.starts).toBe(2);
    expect(screen.queryByText(/não estava conectado/)).toBeNull();
    await waitFor(() => expect(diags).toHaveLength(1));
    expect(diags[0]).toMatchObject({ url: '/api/integrations/api4com/calls/row-perdida/diag', body: { diag: { noInvite: true, retried: true, phoneStatus: 'online' } } });
  });

  it('mostra o motivo quando a API4com recusa a ligação', async () => {
    setup((url, init) => {
      if (url.endsWith('/me')) return { body: ME };
      if (url.endsWith('/sip')) return { body: CREDS };
      if (init?.method === 'POST' && url.endsWith('/calls')) return { status: 422, body: { error: 'A API4com não aceitou o número do contato.' } };
      return { status: 404, body: {} };
    });
    await ligar();
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
      await ligar();
    });
    expect(await screen.findByText('O navegador bloqueou o microfone.')).toBeInTheDocument();
    expect(calls.some((c) => c.includes('/calls'))).toBe(false);
  });
});
