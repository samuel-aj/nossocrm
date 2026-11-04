import { describe, expect, it, vi } from 'vitest';
import { SipPhone, friendlyCause, type SipPhoneDeps } from './sipPhone';

type Handler = (e?: unknown) => void;

class FakeEmitter {
  handlers = new Map<string, Handler[]>();
  on(event: string, h: Handler) {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), h]);
    return this;
  }
  emit(event: string, payload?: unknown) {
    for (const h of this.handlers.get(event) ?? []) h(payload);
  }
}

class FakeSession extends FakeEmitter {
  ended = false;
  answered = 0;
  terminated: unknown[] = [];
  muted = false;
  dtmfs: string[] = [];
  remote_identity = { uri: { user: '5511987654321' }, display_name: '' };
  connection = null;
  answer = vi.fn(() => {
    this.answered++;
  });
  terminate(opts?: unknown) {
    this.terminated.push(opts);
    this.ended = true;
    this.emit('ended', { cause: 'Terminated' });
  }
  mute() {
    this.muted = true;
  }
  unmute() {
    this.muted = false;
  }
  sendDTMF(t: string) {
    this.dtmfs.push(t);
  }
  isEnded() {
    return this.ended;
  }
}

class FakeUa extends FakeEmitter {
  started = false;
  stopped = false;
  constructor(private outcome: 'register' | 'fail' | 'silent' = 'register') {
    super();
  }
  start() {
    this.started = true;
    queueMicrotask(() => {
      if (this.outcome === 'register') this.emit('registered', {});
      if (this.outcome === 'fail') this.emit('registrationFailed', { cause: 'Authentication Error' });
    });
  }
  stop() {
    this.stopped = true;
  }
  unregister() {}
  ring(integrated: boolean) {
    const session = new FakeSession();
    this.emit('newRTCSession', {
      originator: 'remote',
      session,
      request: { getHeader: (n: string) => (n === 'X-Api4comintegratedcall' && integrated ? 'true' : undefined) },
    });
    return session;
  }
}

const CREDS = { wsUrl: 'wss://empresa.api4com.com:6443', uri: 'sip:1000@empresa.api4com.com', username: '1000', password: 'segredo', realm: 'empresa.api4com.com' };

function setup(outcome: 'register' | 'fail' | 'silent' = 'register') {
  const ua = new FakeUa(outcome);
  const createUa = vi.fn(async () => ua);
  const playRemote = vi.fn();
  const deps: SipPhoneDeps = {
    createUa,
    fetchCredentials: vi.fn(async () => CREDS),
    ensureMicrophone: vi.fn(async () => undefined),
    instanceId: () => '11111111-1111-4111-8111-111111111111',
    playRemote,
    registerTimeoutMs: 50,
  };
  return { phone: new SipPhone(deps), ua, deps, createUa, playRemote };
}

describe('SipPhone', () => {
  it('pede o microfone, busca o ramal e fica online quando a central registra', async () => {
    const { phone, deps, createUa, ua } = setup();
    await phone.connect();
    expect(deps.ensureMicrophone).toHaveBeenCalled();
    expect(createUa).toHaveBeenCalledWith(expect.objectContaining({ wsUrl: 'wss://empresa.api4com.com:6443', username: '1000', password: 'segredo', realm: 'empresa.api4com.com' }));
    expect(ua.started).toBe(true);
    expect(phone.getSnapshot().status).toBe('online');
  });

  it('senha recusada pela central vira erro em português e o telefone desliga', async () => {
    const { phone, ua } = setup('fail');
    await expect(phone.connect()).rejects.toThrow('recusou a senha');
    expect(phone.getSnapshot()).toMatchObject({ status: 'error' });
    expect(ua.stopped).toBe(true);
  });

  it('central que não responde não deixa a tela presa em "conectando"', async () => {
    const { phone } = setup('silent');
    await expect(phone.connect()).rejects.toThrow('não respondeu');
    expect(phone.getSnapshot().status).toBe('error');
  });

  it('o toque do botão Ligar (X-Api4comintegratedcall) é atendido sozinho, só com áudio', async () => {
    const { phone, ua } = setup();
    await phone.connect();
    const s = ua.ring(true);
    expect(s.answer).toHaveBeenCalledWith(expect.objectContaining({ mediaConstraints: { audio: true, video: false } }));
    expect(phone.getSnapshot().session).toMatchObject({ integrated: true, phase: 'answering' });
    s.emit('confirmed');
    expect(phone.getSnapshot().session).toMatchObject({ phase: 'in_call' });
  });

  it('chamada de fora toca na tela e só atende quando a pessoa clica', async () => {
    const { phone, ua } = setup();
    await phone.connect();
    const s = ua.ring(false);
    expect(s.answer).not.toHaveBeenCalled();
    expect(phone.getSnapshot().session).toMatchObject({ integrated: false, phase: 'incoming', remote: '5511987654321' });
    phone.answer();
    expect(s.answer).toHaveBeenCalledTimes(1);
  });

  it('recusar chamada de fora responde ocupado (486)', async () => {
    const { phone, ua } = setup();
    await phone.connect();
    const s = ua.ring(false);
    phone.hangup();
    expect(s.terminated[0]).toMatchObject({ status_code: 486 });
    expect(phone.getSnapshot().session).toBeNull();
  });

  it('uma ligação por vez: segundo toque durante a ligação é recusado', async () => {
    const { phone, ua } = setup();
    await phone.connect();
    const first = ua.ring(true);
    first.emit('confirmed');
    const second = ua.ring(true);
    expect(second.terminated[0]).toMatchObject({ status_code: 486 });
    expect(second.answer).not.toHaveBeenCalled();
    expect(phone.getSnapshot().session?.phase).toBe('in_call');
  });

  it('mudo, teclado e desligar agem na ligação; o fim limpa a sessão e o áudio', async () => {
    const { phone, ua, playRemote } = setup();
    await phone.connect();
    const s = ua.ring(true);
    s.emit('confirmed');
    phone.toggleMute();
    expect(s.muted).toBe(true);
    expect(phone.getSnapshot().session?.muted).toBe(true);
    phone.dtmf('5');
    phone.dtmf('x');
    expect(s.dtmfs).toEqual(['5']);
    phone.hangup();
    expect(phone.getSnapshot().session).toBeNull();
    expect(phone.getSnapshot().lastEnded?.cause).toBe('Terminated');
    expect(playRemote).toHaveBeenLastCalledWith(null);
  });

  it('trocar o microfone no meio da ligação substitui o áudio enviado, mantendo o mudo', async () => {
    const oldTrack = { kind: 'audio', enabled: true, stop: vi.fn() };
    const newTrack = { kind: 'audio', enabled: true, stop: vi.fn() };
    const sender = { track: oldTrack as unknown, replaceTrack: vi.fn(async (t: unknown) => void (sender.track = t)) };
    const gum = vi.fn(async () => ({ getAudioTracks: () => [newTrack] }) as unknown as MediaStream);
    const { phone, ua, deps } = setup();
    deps.getUserMedia = gum;
    await phone.connect();
    const s = ua.ring(true);
    (s as unknown as { connection: unknown }).connection = { getSenders: () => [sender] };
    s.emit('confirmed');
    phone.toggleMute();
    expect(oldTrack.enabled).toBe(false);
    await phone.setInputDevice('mic-2');
    expect(gum).toHaveBeenCalledWith({ audio: { deviceId: { exact: 'mic-2' } }, video: false });
    expect(sender.replaceTrack).toHaveBeenCalledWith(newTrack);
    expect(oldTrack.stop).toHaveBeenCalled();
    expect(newTrack.enabled).toBe(false);
    // A próxima ligação já atende com o microfone escolhido
    phone.hangup();
    const next = ua.ring(true);
    expect(next.answer).toHaveBeenCalledWith(expect.objectContaining({ mediaConstraints: { audio: { deviceId: { ideal: 'mic-2' } }, video: false } }));
  });

  it('desligar o telefone encerra a ligação e sai do ramal', async () => {
    const { phone, ua } = setup();
    await phone.connect();
    const s = ua.ring(true);
    s.emit('confirmed');
    phone.disconnect();
    expect(s.ended).toBe(true);
    expect(ua.stopped).toBe(true);
    expect(phone.getSnapshot()).toMatchObject({ status: 'off', session: null });
  });

  it('dois cliques seguidos em conectar usam a mesma conexão', async () => {
    const { phone, createUa } = setup();
    await Promise.all([phone.connect(), phone.connect()]);
    await phone.connect();
    expect(createUa).toHaveBeenCalledTimes(1);
  });

  describe('atender sem esperar todos os caminhos de rede', () => {
    const cand = (type: string) => ({ candidate: { type, candidate: `candidate:1 1 udp 1 1.2.3.4 5 typ ${type}` } });

    it('com o caminho público (srflx) atende em ~150 ms', async () => {
      const { phone, ua } = setup();
      await phone.connect();
      vi.useFakeTimers();
      try {
        const s = ua.ring(true);
        const ready = vi.fn();
        s.emit('icecandidate', { ...cand('host'), ready });
        vi.advanceTimersByTime(100);
        expect(ready).not.toHaveBeenCalled();
        s.emit('icecandidate', { ...cand('srflx'), ready });
        vi.advanceTimersByTime(149);
        expect(ready).not.toHaveBeenCalled();
        vi.advanceTimersByTime(2);
        expect(ready).toHaveBeenCalledTimes(1);
        // Candidatos que chegam depois não chamam de novo
        s.emit('icecandidate', { ...cand('srflx'), ready });
        vi.advanceTimersByTime(2000);
        expect(ready).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('só com caminhos locais atende no máximo em 1,2 s', async () => {
      const { phone, ua } = setup();
      await phone.connect();
      vi.useFakeTimers();
      try {
        const s = ua.ring(true);
        const ready = vi.fn();
        s.emit('icecandidate', { ...cand('host'), ready });
        vi.advanceTimersByTime(1199);
        expect(ready).not.toHaveBeenCalled();
        vi.advanceTimersByTime(2);
        expect(ready).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it('resumo técnico: conta toques extras durante a ligação e sai uma vez só no fim', async () => {
    const { phone, ua } = setup();
    await phone.connect();
    const s = ua.ring(true);
    s.emit('icecandidate', { candidate: { type: 'srflx', candidate: '' }, ready: () => undefined });
    s.emit('confirmed');
    ua.ring(true);
    ua.ring(true);
    expect(phone.takeDiag()).toBeNull();
    phone.hangup();
    const d = phone.takeDiag();
    expect(d).toMatchObject({ integrated: true, extraInvites: 2, endedCause: 'Terminated', ice: { types: ['srflx'] } });
    expect(d?.events.map((e) => e.e)).toEqual(expect.arrayContaining(['invite', 'confirmed', 'extra_invite', 'ended']));
    expect(phone.takeDiag()).toBeNull();
  });

  it('causas da central viram frases para a pessoa', () => {
    expect(friendlyCause('Authentication Error')).toContain('senha do ramal');
    expect(friendlyCause('User Denied Media Access')).toContain('microfone');
    expect(friendlyCause(null)).toBe('A ligação caiu.');
  });
});
