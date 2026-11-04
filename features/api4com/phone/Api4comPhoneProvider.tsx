'use client';

/**
 * Telefone da API4com dentro do CRM, para a área logada inteira: fica fora da
 * tela do lead, então navegar pelo CRM não derruba a ligação (recarregar a
 * página derruba, por isso o aviso antes de sair).
 *
 * - Só existe para quem conectou o próprio token (Configurações > Geral).
 * - Um telefone por pessoa: só UMA aba fica com o ramal (a central derruba o
 *   registro anterior). Clicar em Ligar em outra aba traz o telefone para ela.
 * - Liga sozinho de novo ao abrir o CRM se a pessoa deixou ligado e o
 *   microfone já está liberado.
 * - startCall: liga o telefone se preciso, chama POST /calls (a central toca
 *   aqui, o telefone atende sozinho e ela disca para o cliente) e acompanha a
 *   ligação até o resultado chegar pelo webhook.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { invalidateLeadHistory } from '@/features/deals/lead/leadHistoryInvalidation';
import type { CallRow } from '@/lib/api4com/shared';
import { fetchSipCredentials, getApi4comCall, hangupApi4comCall, sendApi4comCallDiag, startApi4comCall, useApi4comMe } from '../useApi4com';
import { SipPhone, browserInstanceId, createJsSipUa, createRemoteAudio, ensureMicrophone, type CallDiag, type PhoneSnapshot } from './sipPhone';
import { PhoneDock } from './PhoneDock';

/** connecting: ligando o telefone; dialing: pedindo a ligação à central;
 *  live: em andamento; ending: a pessoa (ou o outro lado) desligou e o
 *  resultado está chegando; done/error: fim. */
export type CallStage = 'connecting' | 'dialing' | 'live' | 'ending' | 'done' | 'error';

export type ActiveCall = {
  key: string;
  phone: string;
  label: string;
  dealId: string | null;
  contactId: string | null;
  stage: CallStage;
  row: CallRow | null;
  error: string | null;
  createdAt: number;
  /** Quando a pessoa clicou em Encerrar (ou a ligação caiu). */
  endedAt: number | null;
};

/** Microfone, saída de som e volume escolhidos na janela da ligação. */
export type AudioSettings = { inputId: string | null; outputId: string | null; volume: number; canChooseOutput: boolean };

export type StartCallInput = { phone: string; label?: string | null; dealId?: string | null; contactId?: string | null };

export type PhoneContextValue = {
  /** A pessoa conectou a API4com (o botão Ligar existe). */
  available: boolean;
  phone: PhoneSnapshot;
  /** O telefone está ligado em outra aba deste navegador. */
  otherTab: boolean;
  call: ActiveCall | null;
  goOnline: () => Promise<void>;
  goOffline: () => void;
  startCall: (input: StartCallInput) => Promise<void>;
  hangup: () => void;
  answer: () => void;
  toggleMute: () => void;
  dtmf: (tone: string) => void;
  dismiss: () => void;
  audio: AudioSettings;
  setInputDevice: (id: string | null) => Promise<void>;
  setOutputDevice: (id: string | null) => Promise<void>;
  setVolume: (volume: number) => void;
};

const PhoneContext = createContext<PhoneContextValue | null>(null);
/** Para telas de teste montarem estados do telefone sem a central. */
export const Api4comPhoneContext = PhoneContext;

const ACTIVE = new Set(['dialing', 'ringing', 'answered']);
const POLL_MS = 2500;
/** Depois de encerrar, consulta mais rápido para o resultado aparecer logo. */
const ENDING_POLL_MS = 1200;
const POLL_LIMIT_MS = 2 * 60 * 60 * 1000;
/** Depois de encerrar, quanto esperar o resultado da central antes de fechar. */
const ENDING_WAIT_MS = 20_000;
const BUSY_STAGES: CallStage[] = ['connecting', 'dialing', 'live'];
const PREFS_KEY = 'api4com-phone:audio';

type StoredAudio = { inputId: string | null; outputId: string | null; volume: number };
function readAudioPrefs(): StoredAudio {
  try {
    const v = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') as Partial<StoredAudio>;
    return {
      inputId: typeof v.inputId === 'string' ? v.inputId : null,
      outputId: typeof v.outputId === 'string' ? v.outputId : null,
      volume: typeof v.volume === 'number' && v.volume >= 0 && v.volume <= 1 ? v.volume : 1,
    };
  } catch {
    return { inputId: null, outputId: null, volume: 1 };
  }
}
function writeAudioPrefs(v: StoredAudio) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(v));
  } catch {
    /* só não lembra na próxima vez */
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Tenta pegar a trava do telefone sem esperar; devolve a função que solta. */
function tryLock(name: string): Promise<(() => void) | null> {
  if (typeof navigator === 'undefined' || !navigator.locks) return Promise.resolve(() => undefined);
  return new Promise((resolve) => {
    navigator.locks
      .request(name, { ifAvailable: true }, (lock) => {
        if (!lock) {
          resolve(null);
          return undefined;
        }
        return new Promise<void>((release) => resolve(() => release()));
      })
      .catch(() => resolve(null));
  });
}

function wantKey(scope: string) {
  return `api4com-phone:want-online:${scope}`;
}
function readWant(scope: string): boolean {
  try {
    return localStorage.getItem(wantKey(scope)) === '1';
  } catch {
    return false;
  }
}
function writeWant(scope: string, on: boolean) {
  try {
    if (on) localStorage.setItem(wantKey(scope), '1');
    else localStorage.removeItem(wantKey(scope));
  } catch {
    /* sem armazenamento: só não religa sozinho */
  }
}

export function Api4comPhoneProvider({ children }: { children: React.ReactNode }) {
  const { user, organizationId } = useAuth();
  const scope = user?.id && organizationId ? `${organizationId}:${user.id}` : '';
  const me = useApi4comMe(!!scope);
  const available = !!scope && !!me.data?.connected;
  const qc = useQueryClient();

  const [remoteAudio] = useState(createRemoteAudio);
  const [phone] = useState(
    () =>
      new SipPhone({
        createUa: createJsSipUa,
        fetchCredentials: fetchSipCredentials,
        ensureMicrophone,
        instanceId: browserInstanceId,
        playRemote: remoteAudio.play,
      })
  );
  const [audioPrefs, setAudioPrefs] = useState<StoredAudio>({ inputId: null, outputId: null, volume: 1 });
  // Aplica o que a pessoa escolheu da última vez (microfone, saída, volume)
  useEffect(() => {
    const prefs = readAudioPrefs();
    setAudioPrefs(prefs);
    void phone.setInputDevice(prefs.inputId).catch(() => undefined);
    void remoteAudio.setOutput(prefs.outputId);
    remoteAudio.setVolume(prefs.volume);
  }, [phone, remoteAudio]);
  const snap = useSyncExternalStore(phone.subscribe, phone.getSnapshot, phone.getSnapshot);

  const [otherTab, setOtherTab] = useState(false);
  const [call, setCall] = useState<ActiveCall | null>(null);
  const callRef = useRef<ActiveCall | null>(null);
  useEffect(() => {
    callRef.current = call;
  }, [call]);
  const releaseRef = useRef<(() => void) | null>(null);
  const startingRef = useRef(false);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const lockName = `api4com-phone:${scope}`;

  const releaseLock = useCallback(() => {
    const release = releaseRef.current;
    releaseRef.current = null;
    release?.();
  }, []);

  const acquireLock = useCallback(
    async (takeover: boolean): Promise<boolean> => {
      if (releaseRef.current) return true;
      let release = await tryLock(lockName);
      if (!release && takeover) {
        // Pede para a outra aba soltar o telefone (ela só solta se estiver sem ligação)
        channelRef.current?.postMessage({ type: 'release' });
        for (let i = 0; i < 16 && !release; i++) {
          await sleep(300);
          release = await tryLock(lockName);
        }
      }
      if (!release) return false;
      releaseRef.current = release;
      return true;
    },
    [lockName]
  );

  const connectPhone = useCallback(
    async (takeover: boolean) => {
      if (!available) throw new Error('Conecte a API4com em Configurações > Geral para ligar pelo CRM.');
      const ok = await acquireLock(takeover);
      if (!ok) {
        setOtherTab(true);
        throw new Error('O telefone do CRM está numa ligação em outra aba. Termine a ligação lá ou feche aquela aba.');
      }
      setOtherTab(false);
      try {
        await phone.connect();
        writeWant(scope, true);
      } catch (err) {
        releaseLock();
        throw err;
      }
    },
    [available, acquireLock, phone, scope, releaseLock]
  );

  const goOnline = useCallback(() => connectPhone(true), [connectPhone]);

  const goOffline = useCallback(() => {
    phone.disconnect();
    releaseLock();
    writeWant(scope, false);
  }, [phone, releaseLock, scope]);

  // Conversa entre abas: quem tem o telefone solta quando outra aba pede
  useEffect(() => {
    if (!scope || typeof BroadcastChannel === 'undefined') return;
    const ch = new BroadcastChannel(`api4com-phone:${scope}`);
    channelRef.current = ch;
    ch.onmessage = (ev: MessageEvent<{ type?: string }>) => {
      if (ev.data?.type === 'release') {
        const busy = !!phone.getSnapshot().session || (callRef.current && BUSY_STAGES.includes(callRef.current.stage));
        if (busy || !releaseRef.current) return;
        phone.disconnect();
        releaseLock();
        setOtherTab(true);
      }
    };
    return () => {
      ch.close();
      channelRef.current = null;
    };
  }, [scope, phone, releaseLock]);

  // Troca de organização/usuário ou token desconectado: desliga o telefone
  useEffect(() => {
    if (available) return;
    phone.disconnect();
    releaseLock();
    setOtherTab(false);
  }, [available, phone, releaseLock]);
  useEffect(
    () => () => {
      phone.disconnect();
      releaseLock();
    },
    [scope, phone, releaseLock]
  );

  // Religa sozinho se a pessoa deixou ligado e o microfone já está liberado
  useEffect(() => {
    if (!available || !readWant(scope)) return;
    let cancelled = false;
    void (async () => {
      try {
        const perm = await navigator.permissions?.query({ name: 'microphone' as PermissionName });
        if (cancelled || perm?.state !== 'granted') return;
        await connectPhone(false);
      } catch {
        /* fica desligado; o clique em Ligar tenta de novo */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [available, scope, connectPhone]);

  // Sair da página derruba a ligação: avisa antes; e sai do ramal ao fechar
  useEffect(() => {
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (phone.getSnapshot().session) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    const pageHide = () => {
      phone.disconnect();
      releaseLock();
    };
    window.addEventListener('beforeunload', beforeUnload);
    window.addEventListener('pagehide', pageHide);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      window.removeEventListener('pagehide', pageHide);
    };
  }, [phone, releaseLock]);

  const patchCall = useCallback((key: string, patch: Partial<ActiveCall>) => {
    setCall((cur) => (cur && cur.key === key ? { ...cur, ...patch } : cur));
  }, []);

  /** Ligações que a pessoa encerrou antes de a central responder o pedido. */
  const cancelledRef = useRef(new Set<string>());

  const placeCall = useCallback(
    async (input: StartCallInput) => {
      const key = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
      const startedAt = Date.now();
      setCall({
        key,
        phone: input.phone,
        label: input.label?.trim() || input.phone,
        dealId: input.dealId ?? null,
        contactId: input.contactId ?? null,
        stage: 'connecting',
        row: null,
        error: null,
        createdAt: startedAt,
        endedAt: null,
      });
      try {
        await connectPhone(true);
      } catch (err) {
        if (cancelledRef.current.has(key)) return;
        patchCall(key, { stage: 'error', error: err instanceof Error ? err.message : 'Não foi possível ligar o telefone do CRM.' });
        return;
      }
      if (cancelledRef.current.has(key)) return;
      patchCall(key, { stage: 'dialing' });
      try {
        const { call: row } = await startApi4comCall({ phone: input.phone, dealId: input.dealId, contactId: input.contactId });
        if (cancelledRef.current.has(key)) {
          // Encerrou enquanto a central atendia o pedido: manda desligar já
          if (ACTIVE.has(row.status)) void hangupApi4comCall(row.id).catch(() => undefined);
          patchCall(key, { row });
          return;
        }
        if (row.status === 'failed') return patchCall(key, { row, stage: 'error', error: row.error });
        if (!ACTIVE.has(row.status)) return patchCall(key, { row, stage: 'done' });
        // A sessão de áudio já pode ter caído enquanto a resposta vinha
        const last = phone.getSnapshot().lastEnded;
        const gone = !phone.getSnapshot().session && !!last && last.at >= startedAt;
        patchCall(key, { row, stage: gone ? 'ending' : 'live', endedAt: gone ? Date.now() : null });
      } catch (err) {
        if (cancelledRef.current.has(key)) return;
        patchCall(key, { stage: 'error', error: err instanceof Error ? err.message : 'Não foi possível ligar.' });
      }
    },
    [connectPhone, patchCall, phone]
  );

  const startCall = useCallback(
    async (input: StartCallInput) => {
      const cur = callRef.current;
      if (startingRef.current || (cur && BUSY_STAGES.includes(cur.stage)) || phone.getSnapshot().session) return;
      startingRef.current = true;
      try {
        await placeCall(input);
      } finally {
        startingRef.current = false;
      }
    },
    [phone, placeCall]
  );

  // Resumo técnico da ligação que terminou vai para a linha dela (uma vez)
  const pendingDiagRef = useRef<CallDiag | null>(null);
  const diagRowId = call?.row?.id ?? null;
  useEffect(() => {
    const d = phone.takeDiag();
    if (d) pendingDiagRef.current = d;
    const pending = pendingDiagRef.current;
    if (!pending || !diagRowId) return;
    pendingDiagRef.current = null;
    void sendApi4comCallDiag(diagRowId, pending).catch(() => undefined);
  }, [snap.lastEnded, diagRowId, phone]);

  // O outro lado desligou (o áudio caiu): a tela mostra "encerrada" na hora
  const liveKeyForAudio = call?.stage === 'live' ? call.key : null;
  const liveCreatedAt = call?.createdAt ?? 0;
  useEffect(() => {
    if (!liveKeyForAudio || snap.session || !snap.lastEnded || snap.lastEnded.at < liveCreatedAt) return;
    patchCall(liveKeyForAudio, { stage: 'ending', endedAt: Date.now() });
  }, [liveKeyForAudio, liveCreatedAt, snap.session, snap.lastEnded, patchCall]);

  // Acompanha a ligação até o resultado (atendida, duração, gravação) chegar
  const watchKey = (call?.stage === 'live' || call?.stage === 'ending') && call.row ? call.key : null;
  const watchRowId = watchKey ? call?.row?.id ?? null : null;
  const watchEnding = call?.stage === 'ending';
  const watchEndedAt = call?.endedAt ?? null;
  const watchDealId = call?.dealId ?? null;
  useEffect(() => {
    if (!watchKey || !watchRowId) return;
    const startedAt = Date.now();
    let stop = false;
    const finish = (row: CallRow) => {
      patchCall(watchKey, { row, stage: 'done' });
      if (watchDealId) void invalidateLeadHistory(qc, organizationId, watchDealId);
    };
    const tick = async () => {
      if (stop) return;
      try {
        const { call: row } = await getApi4comCall(watchRowId);
        if (stop) return;
        if (!ACTIVE.has(row.status)) return finish(row);
        const waited = watchEnding && watchEndedAt ? Date.now() - watchEndedAt : 0;
        if (waited > ENDING_WAIT_MS || Date.now() - startedAt > POLL_LIMIT_MS) return finish(row);
        patchCall(watchKey, { row });
      } catch {
        /* rede oscilou: tenta no próximo ciclo */
      }
    };
    if (watchEnding) void tick();
    const timer = setInterval(() => void tick(), watchEnding ? ENDING_POLL_MS : POLL_MS);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [watchKey, watchRowId, watchEnding, watchEndedAt, watchDealId, organizationId, qc, patchCall]);

  // O resultado fica à vista um pouco e some sozinho
  useEffect(() => {
    if (!call || (call.stage !== 'done' && call.stage !== 'error')) return;
    const key = call.key;
    const t = setTimeout(() => setCall((cur) => (cur?.key === key ? null : cur)), call.stage === 'done' ? 8_000 : 15_000);
    return () => clearTimeout(t);
  }, [call]);

  /**
   * Encerrar: vale na hora na tela. Pede à central para derrubar a ligação
   * inteira (a do cliente também) e encerra o áudio aqui. Um clique basta.
   */
  const hangup = useCallback(() => {
    const cur = callRef.current;
    const row = cur?.row;
    if (row && ACTIVE.has(row.status)) void hangupApi4comCall(row.id).catch(() => undefined);
    phone.hangup();
    if (!cur) return;
    if (cur.stage === 'connecting' || cur.stage === 'dialing') {
      cancelledRef.current.add(cur.key);
      setCall((c) => (c?.key === cur.key ? { ...c, stage: row ? 'ending' : 'done', endedAt: Date.now() } : c));
      return;
    }
    if (cur.stage === 'live') patchCall(cur.key, { stage: 'ending', endedAt: Date.now() });
  }, [phone, patchCall]);

  const saveAudio = useCallback((patch: Partial<StoredAudio>) => {
    setAudioPrefs((p) => {
      const next = { ...p, ...patch };
      writeAudioPrefs(next);
      return next;
    });
  }, []);
  const setInputDevice = useCallback(
    async (id: string | null) => {
      saveAudio({ inputId: id });
      await phone.setInputDevice(id);
    },
    [phone, saveAudio]
  );
  const setOutputDevice = useCallback(
    async (id: string | null) => {
      saveAudio({ outputId: id });
      await remoteAudio.setOutput(id);
    },
    [remoteAudio, saveAudio]
  );
  const setVolume = useCallback(
    (v: number) => {
      remoteAudio.setVolume(v);
      saveAudio({ volume: v });
    },
    [remoteAudio, saveAudio]
  );

  const value = useMemo<PhoneContextValue>(
    () => ({
      available,
      phone: snap,
      otherTab,
      call,
      goOnline,
      goOffline,
      startCall,
      hangup,
      answer: () => phone.answer(),
      toggleMute: () => phone.toggleMute(),
      dtmf: (tone: string) => phone.dtmf(tone),
      dismiss: () => setCall((cur) => (cur && !BUSY_STAGES.includes(cur.stage) ? null : cur)),
      audio: { ...audioPrefs, canChooseOutput: remoteAudio.canChooseOutput() },
      setInputDevice,
      setOutputDevice,
      setVolume,
    }),
    [available, snap, otherTab, call, goOnline, goOffline, startCall, hangup, phone, audioPrefs, remoteAudio, setInputDevice, setOutputDevice, setVolume]
  );

  return (
    <PhoneContext.Provider value={value}>
      {children}
      {available ? <PhoneDock /> : null}
    </PhoneContext.Provider>
  );
}

/** Telefone da API4com; null fora do provedor (telas públicas, testes). */
export function useApi4comPhone(): PhoneContextValue | null {
  return useContext(PhoneContext);
}
