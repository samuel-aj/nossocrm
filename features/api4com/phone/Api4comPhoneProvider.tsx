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
import { fetchSipCredentials, getApi4comCall, hangupApi4comCall, startApi4comCall, useApi4comMe } from '../useApi4com';
import { SipPhone, browserInstanceId, createJsSipUa, createRemoteAudio, ensureMicrophone, type PhoneSnapshot } from './sipPhone';
import { PhoneDock } from './PhoneDock';

export type CallStage = 'connecting' | 'dialing' | 'live' | 'done' | 'error';

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
};

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
};

const PhoneContext = createContext<PhoneContextValue | null>(null);
/** Para telas de teste montarem estados do telefone sem a central. */
export const Api4comPhoneContext = PhoneContext;

const ACTIVE = new Set(['dialing', 'ringing', 'answered']);
const POLL_MS = 2500;
const POLL_LIMIT_MS = 2 * 60 * 60 * 1000;
/** Depois que o áudio caiu, quanto esperar o resultado da central. */
const AFTER_END_WAIT_MS = 90_000;
const BUSY_STAGES: CallStage[] = ['connecting', 'dialing', 'live'];

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

  const [phone] = useState(
    () =>
      new SipPhone({
        createUa: createJsSipUa,
        fetchCredentials: fetchSipCredentials,
        ensureMicrophone,
        instanceId: browserInstanceId,
        playRemote: createRemoteAudio(),
      })
  );
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

  const placeCall = useCallback(
    async (input: StartCallInput) => {
      const key = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
      setCall({
        key,
        phone: input.phone,
        label: input.label?.trim() || input.phone,
        dealId: input.dealId ?? null,
        contactId: input.contactId ?? null,
        stage: 'connecting',
        row: null,
        error: null,
        createdAt: Date.now(),
      });
      try {
        await connectPhone(true);
      } catch (err) {
        patchCall(key, { stage: 'error', error: err instanceof Error ? err.message : 'Não foi possível ligar o telefone do CRM.' });
        return;
      }
      patchCall(key, { stage: 'dialing' });
      try {
        const { call: row } = await startApi4comCall({ phone: input.phone, dealId: input.dealId, contactId: input.contactId });
        patchCall(key, { row, stage: ACTIVE.has(row.status) ? 'live' : row.status === 'failed' ? 'error' : 'done', error: row.status === 'failed' ? row.error : null });
      } catch (err) {
        patchCall(key, { stage: 'error', error: err instanceof Error ? err.message : 'Não foi possível ligar.' });
      }
    },
    [connectPhone, patchCall]
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

  // Acompanha a ligação até o resultado (atendida, duração, gravação) chegar
  const liveKey = call?.stage === 'live' && call.row ? call.key : null;
  const liveRowId = call?.stage === 'live' ? call.row?.id ?? null : null;
  const liveDealId = call?.dealId ?? null;
  useEffect(() => {
    if (!liveKey || !liveRowId) return;
    const startedAt = Date.now();
    let stop = false;
    const finish = (row: CallRow) => {
      patchCall(liveKey, { row, stage: 'done' });
      if (liveDealId) void invalidateLeadHistory(qc, organizationId, liveDealId);
    };
    const tick = async () => {
      if (stop) return;
      try {
        const { call: row } = await getApi4comCall(liveRowId);
        if (stop) return;
        if (!ACTIVE.has(row.status)) return finish(row);
        const ended = phone.getSnapshot().lastEnded;
        const audioGoneFor = ended && ended.at >= startedAt && !phone.getSnapshot().session ? Date.now() - ended.at : 0;
        if (audioGoneFor > AFTER_END_WAIT_MS || Date.now() - startedAt > POLL_LIMIT_MS) return finish(row);
        patchCall(liveKey, { row });
      } catch {
        /* rede oscilou: tenta no próximo ciclo */
      }
    };
    const timer = setInterval(() => void tick(), POLL_MS);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [liveKey, liveRowId, liveDealId, organizationId, qc, phone, patchCall]);

  // O resultado fica à vista um pouco e some sozinho
  useEffect(() => {
    if (!call || (call.stage !== 'done' && call.stage !== 'error')) return;
    const key = call.key;
    const t = setTimeout(() => setCall((cur) => (cur?.key === key ? null : cur)), call.stage === 'done' ? 10_000 : 15_000);
    return () => clearTimeout(t);
  }, [call]);

  const hangup = useCallback(() => {
    phone.hangup();
    const row = callRef.current?.row;
    if (row && ACTIVE.has(row.status)) void hangupApi4comCall(row.id).catch(() => undefined);
  }, [phone]);

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
    }),
    [available, snap, otherTab, call, goOnline, goOffline, startCall, hangup, phone]
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
