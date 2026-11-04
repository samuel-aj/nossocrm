/**
 * Telefone embutido no CRM (API4com). Registra o ramal da pessoa na central da
 * API4com por SIP sobre WebSocket seguro (wss://<domínio>:6443) e fala por
 * WebRTC, como na documentação "Integração utilizando Webphone próprio".
 *
 * - O clique em Ligar chama POST /calls no servidor; a central toca PRIMEIRO
 *   neste ramal com o cabeçalho X-Api4comintegratedcall: true. Esse toque é
 *   atendido sozinho aqui e, em seguida, a central disca para o cliente.
 * - Chamada que chega sem esse cabeçalho (alguém ligando para o ramal) fica
 *   tocando na tela para a pessoa atender ou recusar.
 * - Uma ligação por vez: um segundo toque durante a ligação é recusado.
 *
 * Sem React aqui: a tela assina as mudanças (subscribe/getSnapshot).
 */
import type { SipCredentials } from '@/lib/api4com/shared';

export type PhoneStatus = 'off' | 'connecting' | 'online' | 'reconnecting' | 'error';
export type SessionPhase = 'incoming' | 'answering' | 'in_call';

export type PhoneSession = {
  phase: SessionPhase;
  /** Veio do botão Ligar do CRM (atendido sozinho). */
  integrated: boolean;
  remote: string;
  startedAt: number | null;
  muted: boolean;
};

export type PhoneSnapshot = {
  status: PhoneStatus;
  error: string | null;
  session: PhoneSession | null;
  /** Último encerramento de sessão (para a tela saber que caiu e por quê). */
  lastEnded: { at: number; cause: string | null; originator?: string | null; answered?: boolean } | null;
};

/* ---------- O mínimo do JsSIP que usamos (facilita testar com um falso) ---------- */

type Handler = (event: never) => void;
export interface SipSessionLike {
  on(event: string, handler: Handler): unknown;
  answer(options?: unknown): void;
  terminate(options?: unknown): void;
  mute(options?: unknown): void;
  unmute(options?: unknown): void;
  sendDTMF(tones: string, options?: unknown): void;
  isEnded(): boolean;
  readonly connection?: RTCPeerConnection | null;
  readonly remote_identity?: { uri?: { user?: string }; display_name?: string } | null;
}
export interface SipUaLike {
  on(event: string, handler: Handler): unknown;
  start(): void;
  stop(): void;
  unregister(options?: unknown): void;
}
export type CreateUa = (config: {
  wsUrl: string;
  uri: string;
  username: string;
  password: string;
  realm: string;
  instanceId: string;
}) => Promise<SipUaLike>;

export type SipPhoneDeps = {
  createUa: CreateUa;
  fetchCredentials: () => Promise<SipCredentials>;
  /** Pede o microfone (gesto da pessoa) e solta em seguida. */
  ensureMicrophone: () => Promise<void>;
  instanceId: () => string;
  /** Toca o áudio do outro lado. */
  playRemote: (stream: MediaStream | null) => void;
  /** Microfone escolhido (troca no meio da ligação). Padrão: o do navegador. */
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  now?: () => number;
  registerTimeoutMs?: number;
};

const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];
function answerOptions(inputDeviceId: string | null) {
  // "ideal": se o microfone escolhido sumiu (fone desconectado), usa o padrão
  const audio: boolean | MediaTrackConstraints = inputDeviceId ? { deviceId: { ideal: inputDeviceId } } : true;
  return { mediaConstraints: { audio, video: false }, pcConfig: { iceServers: ICE_SERVERS } };
}

/**
 * Quanto esperar pelos caminhos de rede antes de atender. O JsSIP espera o
 * navegador testar TODOS (VPN, IPv6, várias placas), o que levava ~10 s para
 * a central começar a chamar o cliente. Com o caminho público (srflx) em
 * mãos, atende quase na hora; sem ele, no máximo neste prazo.
 */
export const ICE_SRFLX_GRACE_MS = 150;
export const ICE_MAX_WAIT_MS = 1200;

/** Resumo técnico de uma ligação (para achar a causa de áudio ruim). */
export type CallDiag = {
  integrated: boolean;
  /** ms desde o toque da central em cada passo. */
  events: Array<{ t: number; e: string; d?: string }>;
  /** Toques que chegaram com a ligação em curso (recusados com 486). */
  extraInvites: number;
  ice: { firstCandidateMs: number | null; readyMs: number | null; readyBy: string | null; types: string[] };
  /** Amostras da qualidade do áudio recebido (a cada 4 s). */
  stats: Array<Record<string, number | string | null>>;
  endedCause: string | null;
};

/** Faixas de áudio que este navegador está enviando na ligação. */
function audioSenders(pc: RTCPeerConnection | null | undefined): RTCRtpSender[] {
  if (!pc || typeof pc.getSenders !== 'function') return [];
  return pc.getSenders().filter((s) => !s.track || s.track.kind === 'audio');
}

/** O que a central ofereceu na chamada (sem dado pessoal): ajuda a achar incompatibilidade. */
export function offerSummary(sdp: string | undefined | null): string {
  if (!sdp) return 'sem-sdp';
  const has = (re: RegExp) => (re.test(sdp) ? 1 : 0);
  const codecs = Array.from(sdp.matchAll(/a=rtpmap:\d+ ([\w-]+)\//g)).map((m) => m[1]).slice(0, 8).join(',');
  const proto = /m=audio \d+ ([\w/]+)/.exec(sdp)?.[1] ?? '?';
  return `proto=${proto} dtls=${has(/a=fingerprint/)} ice=${has(/a=ice-ufrag/)} mux=${has(/a=rtcp-mux/)} bundle=${has(/a=group:BUNDLE/)} codecs=${codecs}`;
}

/** Causa do JsSIP -> frase para a pessoa. */
export function friendlyCause(cause: string | null | undefined): string {
  switch (cause) {
    case 'Authentication Error':
      return 'A central da API4com recusou a senha do ramal. Conecte o token de novo em Configurações > Geral.';
    case 'Connection Error':
    case 'Request Timeout':
      return 'Não foi possível falar com a central da API4com. Confira a internet e tente de novo.';
    case 'User Denied Media Access':
      return 'O navegador bloqueou o microfone. Libere o microfone para o CRM no cadeado ao lado do endereço.';
    case 'Busy':
      return 'Ocupado.';
    case 'Incompatible SDP':
    case 'Bad Media Description':
      return 'O telefone do CRM não conseguiu combinar o áudio com a central da API4com.';
    case 'WebRTC Error':
    case 'Internal Error':
      return 'O navegador não conseguiu abrir o áudio da ligação. Feche outras abas que usem o microfone e tente de novo.';
    default:
      return cause ? `A ligação caiu (${cause}).` : 'A ligação caiu.';
  }
}

export class SipPhone {
  private deps: SipPhoneDeps;
  private ua: SipUaLike | null = null;
  private session: SipSessionLike | null = null;
  private snap: PhoneSnapshot = { status: 'off', error: null, session: null, lastEnded: null };
  private listeners = new Set<() => void>();
  private connecting: Promise<void> | null = null;
  /** Geração da conexão: eventos de um UA antigo são ignorados. */
  private generation = 0;
  /** Microfone escolhido nas configurações da ligação (null = padrão). */
  private inputDeviceId: string | null = null;
  /** Resumo técnico da ligação em curso e o da última que terminou. */
  private diag: CallDiag | null = null;
  private diagStart = 0;
  private finishedDiag: CallDiag | null = null;
  private registeredAt: number | null = null;
  private lastInviteAt: number | null = null;
  private statsTimer: ReturnType<typeof setInterval> | null = null;

  constructor(deps: SipPhoneDeps) {
    this.deps = deps;
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };

  getSnapshot = (): PhoneSnapshot => this.snap;

  private set(patch: Partial<PhoneSnapshot>) {
    this.snap = { ...this.snap, ...patch };
    for (const fn of this.listeners) fn();
  }

  private setSession(patch: Partial<PhoneSession> | null) {
    if (patch === null) return this.set({ session: null });
    const cur = this.snap.session;
    this.set({ session: cur ? { ...cur, ...patch } : (patch as PhoneSession) });
  }

  private now() {
    return this.deps.now?.() ?? Date.now();
  }

  get online() {
    return this.snap.status === 'online';
  }

  /**
   * Liga o telefone: microfone, dados do ramal e registro na central. Resolve
   * quando registrado; rejeita com a frase para a pessoa.
   */
  connect(): Promise<void> {
    if (this.snap.status === 'online' && this.ua) return Promise.resolve();
    if (this.connecting) return this.connecting;
    const gen = ++this.generation;
    this.set({ status: 'connecting', error: null });
    const run = async () => {
      await this.deps.ensureMicrophone();
      const creds = await this.deps.fetchCredentials();
      if (gen !== this.generation) throw new Error('cancelado');
      // Nunca dois telefones no mesmo ramal: o antigo (ex.: caído e
      // reconectando) sai antes de o novo entrar. Senão a central toca nos
      // dois e o antigo, que a tela não escuta mais, pode recusar a ligação.
      await this.teardownUa(true);
      if (gen !== this.generation) throw new Error('cancelado');
      const ua = await this.deps.createUa({ ...creds, instanceId: this.deps.instanceId() });
      if (gen !== this.generation) {
        ua.stop();
        throw new Error('cancelado');
      }
      this.ua = ua;
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const done = (err?: Error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (err) reject(err);
          else resolve();
        };
        const timer = setTimeout(() => done(new Error('A central da API4com não respondeu. Tente de novo em alguns segundos.')), this.deps.registerTimeoutMs ?? 15_000);
        // Avisos de um telefone já retirado do ramal não mexem na tela
        const stale = () => gen !== this.generation || this.ua !== ua;
        ua.on('registered', () => {
          if (stale()) return;
          this.registeredAt = this.now();
          this.set({ status: 'online', error: null });
          done();
        });
        ua.on('registrationFailed', ((e: { cause?: string }) => {
          if (stale()) return;
          const msg = friendlyCause(e?.cause);
          this.set({ status: 'error', error: msg });
          done(new Error(msg));
        }) as Handler);
        ua.on('unregistered', () => {
          if (stale() || this.snap.status === 'off') return;
          this.set({ status: 'reconnecting' });
        });
        ua.on('disconnected', () => {
          if (stale() || this.snap.status === 'off') return;
          // O JsSIP reconecta sozinho (2 a 30 s); a tela mostra "reconectando"
          if (this.snap.status === 'online') this.set({ status: 'reconnecting' });
        });
        ua.on('newRTCSession', ((e: { originator: string; session: SipSessionLike; request?: { getHeader?: (n: string) => string | undefined } }) => {
          if (gen !== this.generation) return;
          if (e.originator !== 'remote') return;
          this.onIncoming(e.session, e.request);
        }) as Handler);
        ua.start();
      });
    };
    this.connecting = run()
      .catch((err: unknown) => {
        if (gen === this.generation) {
          this.teardownUa();
          const message = err instanceof Error ? err.message : 'Não foi possível ligar o telefone.';
          if (message !== 'cancelado') this.set({ status: 'error', error: message });
        }
        throw err;
      })
      .finally(() => {
        if (gen === this.generation) this.connecting = null;
      });
    return this.connecting;
  }

  /** Desliga o telefone (sai do ramal). Encerra a ligação, se houver. */
  disconnect() {
    this.stopStats();
    this.generation++;
    this.connecting = null;
    this.hangup();
    this.teardownUa();
    this.set({ status: 'off', error: null, session: null });
  }

  /**
   * Tira o telefone atual do ramal. Com `wait`, espera a central confirmar a
   * saída (até 1,5 s) antes de devolver: assim a saída do antigo nunca chega
   * DEPOIS da entrada do novo e apaga o registro dele.
   */
  private teardownUa(wait = false): Promise<void> {
    const ua = this.ua;
    this.ua = null;
    if (!ua) return Promise.resolve();
    const stop = () => {
      try {
        ua.stop();
      } catch {
        /* já parou */
      }
    };
    if (!wait) {
      try {
        ua.unregister({ all: false });
      } catch {
        /* já caiu */
      }
      stop();
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        stop();
        resolve();
      };
      const timer = setTimeout(finish, 1500);
      try {
        ua.on('unregistered', finish);
        ua.on('registrationFailed', finish);
        ua.unregister({ all: false });
      } catch {
        finish();
      }
    });
  }

  /** Quando o telefone entrou no ramal e quando chegou o último toque da central. */
  info() {
    return { status: this.snap.status, registeredAt: this.registeredAt, lastInviteAt: this.lastInviteAt };
  }

  /**
   * Refaz o registro no ramal do zero (telefone "online" que a central não
   * enxerga). Não mexe se houver ligação em curso.
   */
  reconnect(): Promise<void> {
    if (this.session && !this.session.isEnded()) return Promise.reject(new Error('Há uma ligação em andamento.'));
    this.generation++;
    this.connecting = null;
    this.set({ status: 'connecting', error: null });
    return this.connect();
  }

  private mark(e: string, d?: string) {
    if (!this.diag || this.diag.events.length >= 40) return;
    this.diag.events.push({ t: this.now() - this.diagStart, e, ...(d ? { d } : {}) });
  }

  /** Entrega (uma vez) o resumo técnico da última ligação encerrada. */
  takeDiag(): CallDiag | null {
    const d = this.finishedDiag;
    this.finishedDiag = null;
    return d;
  }

  private onIncoming(session: SipSessionLike, request?: { getHeader?: (n: string) => string | undefined }) {
    this.lastInviteAt = this.now();
    if (this.session && !this.session.isEnded()) {
      if (this.diag) {
        this.diag.extraInvites++;
        this.mark('extra_invite', String(request?.getHeader?.('X-Api4comintegratedcall') ?? ''));
      }
      try {
        session.terminate({ status_code: 486, reason_phrase: 'Busy Here' });
      } catch {
        /* nada */
      }
      return;
    }
    const integrated = String(request?.getHeader?.('X-Api4comintegratedcall') ?? '').trim().toLowerCase() === 'true';
    const remote = session.remote_identity?.display_name || session.remote_identity?.uri?.user || '';
    this.session = session;
    this.diagStart = this.now();
    this.diag = { integrated, events: [], extraInvites: 0, ice: { firstCandidateMs: null, readyMs: null, readyBy: null, types: [] }, stats: [], endedCause: null };
    this.mark('invite', offerSummary((request as { body?: string } | undefined)?.body));
    this.setSession({ phase: integrated ? 'answering' : 'incoming', integrated, remote, startedAt: null, muted: false });

    // Atende sem esperar o navegador testar todos os caminhos de rede
    let iceTimer: ReturnType<typeof setTimeout> | null = null;
    let iceDone = false;
    const iceReady = (ready: () => void, by: string) => {
      if (iceDone) return;
      iceDone = true;
      if (iceTimer) clearTimeout(iceTimer);
      if (this.diag) this.diag.ice = { ...this.diag.ice, readyMs: this.now() - this.diagStart, readyBy: by };
      ready();
    };
    session.on('icecandidate', ((e: { candidate: RTCIceCandidate | null; ready: () => void }) => {
      if (iceDone) return;
      const type = (e.candidate?.type as string | undefined) ?? /typ (\w+)/.exec(e.candidate?.candidate ?? '')?.[1] ?? 'unknown';
      if (this.diag) {
        if (this.diag.ice.firstCandidateMs === null) this.diag.ice.firstCandidateMs = this.now() - this.diagStart;
        if (this.diag.ice.types.length < 12) this.diag.ice.types.push(type);
      }
      if (!iceTimer) iceTimer = setTimeout(() => iceReady(e.ready, 'timeout'), ICE_MAX_WAIT_MS);
      if (type === 'srflx' || type === 'relay') {
        clearTimeout(iceTimer);
        iceTimer = setTimeout(() => iceReady(e.ready, type), ICE_SRFLX_GRACE_MS);
      }
    }) as Handler);

    session.on('peerconnection', ((e: { peerconnection: RTCPeerConnection }) => {
      const pc = e.peerconnection;
      pc.addEventListener('track', (ev: RTCTrackEvent) => {
        this.mark('track');
        if (this.session === session) this.deps.playRemote(ev.streams[0] ?? new MediaStream([ev.track]));
      });
      pc.addEventListener('iceconnectionstatechange', () => this.mark('ice', pc.iceConnectionState));
      pc.addEventListener('connectionstatechange', () => this.mark('pc', pc.connectionState));
    }) as Handler);
    session.on('accepted', () => this.mark('accepted'));
    session.on('confirmed', () => {
      if (this.session !== session) return;
      this.mark('confirmed');
      this.attachRemote(session);
      this.setSession({ phase: 'in_call', startedAt: this.now() });
      this.startStats(session);
    });
    session.on('reinvite', () => this.mark('reinvite'));
    session.on('getusermediafailed', ((e: { name?: string; message?: string }) => this.mark('gum_failed', `${e?.name ?? ''} ${e?.message ?? ''}`.trim())) as Handler);
    session.on('peerconnection:setremotedescriptionfailed', ((e: { name?: string; message?: string }) => this.mark('remote_sdp_failed', `${e?.name ?? ''} ${e?.message ?? ''}`.trim())) as Handler);
    session.on('peerconnection:createanswerfailed', ((e: { name?: string; message?: string }) => this.mark('answer_failed', `${e?.name ?? ''} ${e?.message ?? ''}`.trim())) as Handler);
    session.on('peerconnection:setlocaldescriptionfailed', ((e: { name?: string; message?: string }) => this.mark('local_sdp_failed', `${e?.name ?? ''} ${e?.message ?? ''}`.trim())) as Handler);
    session.on('hold', () => this.mark('hold'));
    session.on('unhold', () => this.mark('unhold'));
    let answered = false;
    session.on('confirmed', () => void (answered = true));
    const ended = ((e: { cause?: string; originator?: string; message?: { status_code?: number } }) => {
      if (this.session !== session) return;
      if (iceTimer) clearTimeout(iceTimer);
      this.stopStats();
      this.mark('ended', [e?.cause, e?.originator, e?.message?.status_code].filter(Boolean).join(' | '));
      if (this.diag) {
        this.diag.endedCause = e?.cause ?? null;
        this.finishedDiag = this.diag;
      }
      this.diag = null;
      this.session = null;
      this.deps.playRemote(null);
      this.set({ session: null, lastEnded: { at: this.now(), cause: e?.cause ?? null, originator: e?.originator ?? null, answered } });
    }) as Handler;
    session.on('ended', ended);
    session.on('failed', ended);

    if (integrated) this.answer();
  }

  /** Amostra a qualidade do áudio recebido enquanto a ligação dura. */
  private startStats(session: SipSessionLike) {
    this.stopStats();
    const pc = session.connection;
    if (!pc || typeof pc.getStats !== 'function') return;
    const sample = async () => {
      if (this.session !== session || !this.diag || this.diag.stats.length >= 30) return;
      try {
        const report = await pc.getStats();
        const out: Record<string, number | string | null> = { t: this.now() - this.diagStart };
        const byId = new Map<string, Record<string, unknown>>();
        report.forEach((v: Record<string, unknown>) => byId.set(String(v.id), v));
        report.forEach((v: Record<string, unknown>) => {
          if (v.type === 'inbound-rtp' && v.kind === 'audio') {
            for (const k of ['packetsReceived', 'packetsLost', 'jitter', 'jitterBufferDelay', 'jitterBufferEmittedCount', 'concealedSamples', 'totalSamplesReceived', 'insertedSamplesForDeceleration', 'removedSamplesForAcceleration']) {
              out[k] = typeof v[k] === 'number' ? (v[k] as number) : null;
            }
            const codec = byId.get(String(v.codecId));
            out.codec = codec ? String(codec.mimeType ?? '') : null;
          }
          if (v.type === 'candidate-pair' && v.nominated && v.state === 'succeeded') {
            out.rtt = typeof v.currentRoundTripTime === 'number' ? (v.currentRoundTripTime as number) : null;
            out.local = String(byId.get(String(v.localCandidateId))?.candidateType ?? '');
            out.remote = String(byId.get(String(v.remoteCandidateId))?.candidateType ?? '');
            out.proto = String(byId.get(String(v.localCandidateId))?.protocol ?? '');
          }
        });
        this.diag.stats.push(out);
      } catch {
        /* sem estatística nesta amostra */
      }
    };
    void sample();
    this.statsTimer = setInterval(() => void sample(), 4000);
  }

  private stopStats() {
    if (this.statsTimer) clearInterval(this.statsTimer);
    this.statsTimer = null;
  }

  /** Garante o áudio mesmo se o evento 'track' veio antes de assinarmos. */
  private attachRemote(session: SipSessionLike) {
    const pc = session.connection;
    if (!pc || typeof pc.getReceivers !== 'function') return;
    const tracks = pc.getReceivers().map((r) => r.track).filter((t): t is MediaStreamTrack => !!t && t.kind === 'audio');
    if (tracks.length) this.deps.playRemote(new MediaStream(tracks));
  }

  answer() {
    const s = this.session;
    if (!s) return;
    this.setSession({ phase: 'answering' });
    try {
      s.answer(answerOptions(this.inputDeviceId));
    } catch (err) {
      this.set({ error: err instanceof Error ? err.message : 'Não foi possível atender.' });
    }
  }

  /** Recusa a chamada que está tocando ou encerra a ligação em curso. */
  hangup() {
    const s = this.session;
    if (!s || s.isEnded()) return;
    try {
      s.terminate(this.snap.session?.phase === 'incoming' ? { status_code: 486, reason_phrase: 'Busy Here' } : undefined);
    } catch {
      /* já encerrada */
    }
  }

  toggleMute() {
    const s = this.session;
    const cur = this.snap.session;
    if (!s || !cur || cur.phase !== 'in_call') return;
    const muted = !cur.muted;
    try {
      if (muted) s.mute({ audio: true });
      else s.unmute({ audio: true });
    } catch {
      /* segue pelo envio abaixo */
    }
    // Também direto no que está sendo enviado (vale depois de trocar o microfone)
    for (const sender of audioSenders(s.connection)) if (sender.track) sender.track.enabled = !muted;
    this.setSession({ muted });
  }

  /**
   * Troca o microfone. Fora da ligação, vale para a próxima; durante a
   * ligação, troca na hora sem derrubar (substitui a faixa enviada).
   */
  async setInputDevice(deviceId: string | null): Promise<void> {
    this.inputDeviceId = deviceId || null;
    const s = this.session;
    if (!s || this.snap.session?.phase !== 'in_call') return;
    const sender = audioSenders(s.connection)[0];
    if (!sender) return;
    const gum = this.deps.getUserMedia ?? ((c: MediaStreamConstraints) => navigator.mediaDevices.getUserMedia(c));
    const stream = await gum({ audio: deviceId ? { deviceId: { exact: deviceId } } : true, video: false });
    const track = stream.getAudioTracks()[0];
    if (!track) return;
    if (this.session !== s) {
      track.stop();
      return;
    }
    track.enabled = !this.snap.session?.muted;
    const old = sender.track;
    await sender.replaceTrack(track);
    old?.stop();
  }

  /** Tecla do teclado (menu de URA do outro lado). */
  dtmf(tone: string) {
    const s = this.session;
    if (!s || this.snap.session?.phase !== 'in_call' || !/^[0-9*#]$/.test(tone)) return;
    try {
      s.sendDTMF(tone, { transportType: 'RFC2833' });
    } catch {
      /* sem DTMF nesta chamada */
    }
  }
}

/* ---------- Implementações reais (navegador) ---------- */

/** UA do JsSIP, carregado só quando a pessoa liga o telefone. */
export const createJsSipUa: CreateUa = async (cfg) => {
  const mod = await import('jssip');
  const JsSIP = ((mod as unknown as { default?: typeof mod }).default ?? mod) as typeof mod;
  try {
    JsSIP.debug.disable();
  } catch {
    /* sem debug */
  }
  const socket = new JsSIP.WebSocketInterface(cfg.wsUrl);
  return new JsSIP.UA({
    sockets: [socket],
    uri: cfg.uri,
    authorization_user: cfg.username,
    password: cfg.password,
    realm: cfg.realm,
    instance_id: cfg.instanceId,
    register: true,
    register_expires: 600,
    session_timers: false,
    no_answer_timeout: 30,
    connection_recovery_min_interval: 2,
    connection_recovery_max_interval: 30,
    user_agent: 'NossoCRM',
  }) as unknown as SipUaLike;
};

/** Pede o microfone (precisa vir de um clique) e solta na hora. */
export async function ensureMicrophone(): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    throw new Error('Este navegador não permite usar o microfone. Use o Chrome ou o Edge atualizados.');
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    stream.getTracks().forEach((t) => t.stop());
  } catch (err) {
    const name = (err as { name?: string })?.name;
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      throw new Error('O navegador bloqueou o microfone. Libere o microfone para o CRM no cadeado ao lado do endereço e tente de novo.');
    }
    if (name === 'NotFoundError' || name === 'OverconstrainedError') throw new Error('Nenhum microfone encontrado neste computador.');
    throw new Error('Não foi possível usar o microfone.');
  }
}

/**
 * Id do aparelho para a central, um POR ABA (fica igual ao recarregar a mesma
 * aba). Antes era um por navegador: quando uma aba saía do ramal, a central
 * apagava também o registro da aba que tinha acabado de entrar (mesmo
 * aparelho para ela), e a ligação falhava com "não estava conectado".
 */
export function browserInstanceId(): string {
  const key = 'api4com-phone:instance';
  try {
    const saved = sessionStorage.getItem(key);
    if (saved && /^[0-9a-f-]{36}$/i.test(saved)) return saved;
    const id = crypto.randomUUID();
    sessionStorage.setItem(key, id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

export type RemoteAudio = {
  play: (stream: MediaStream | null) => void;
  /** Alto-falante/fone de saída. false se o navegador não deixa escolher. */
  setOutput: (deviceId: string | null) => Promise<boolean>;
  /** Volume de 0 a 1. */
  setVolume: (volume: number) => void;
  canChooseOutput: () => boolean;
};

/** Saída do áudio do outro lado (um elemento <audio> escondido). */
export function createRemoteAudio(): RemoteAudio {
  let el: HTMLAudioElement | null = null;
  let sink: string | null = null;
  let volume = 1;
  const element = () => {
    if (typeof document === 'undefined') return null;
    if (!el) {
      el = document.createElement('audio');
      el.autoplay = true;
      el.setAttribute('data-api4com-audio', '');
      el.style.display = 'none';
      el.volume = volume;
      document.body.appendChild(el);
    }
    return el;
  };
  type SinkAudio = HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
  return {
    play(stream) {
      const a = element();
      if (!a) return;
      const cur = a.srcObject as MediaStream | null;
      const ids = (m: MediaStream | null) => (m ? m.getAudioTracks().map((t) => t.id).sort().join(',') : '');
      // Mesmo áudio de antes: não reinicia (cada troca zera o buffer e dá picote)
      if (stream && cur && ids(cur) === ids(stream)) return;
      a.srcObject = stream;
      if (stream) void a.play().catch(() => undefined);
    },
    async setOutput(deviceId) {
      sink = deviceId || null;
      const a = element() as SinkAudio | null;
      if (!a?.setSinkId) return false;
      try {
        await a.setSinkId(sink ?? '');
        return true;
      } catch {
        return false;
      }
    },
    setVolume(v) {
      volume = Math.min(1, Math.max(0, v));
      const a = element();
      if (a) a.volume = volume;
    },
    canChooseOutput() {
      return typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;
    },
  };
}
