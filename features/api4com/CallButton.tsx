'use client';

/**
 * Botão "Ligar" ao lado do telefone do contato (API4com). Só aparece para quem
 * conectou a própria API4com. A ligação toca primeiro no Webphone da pessoa;
 * quando ela atende lá, a API4com disca para o cliente. Enquanto isso o botão
 * vira um cartão com o andamento, o tempo de ligação e "Desligar".
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, Phone, PhoneOff } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { invalidateLeadHistory } from '@/features/deals/lead/leadHistoryInvalidation';
import { RESULT_LABEL, formatDuration, type CallRow } from '@/lib/api4com/shared';
import { getApi4comCall, hangupApi4comCall, startApi4comCall, useApi4comMe } from './useApi4com';

type Phase =
  | { kind: 'idle' }
  | { kind: 'starting' }
  | { kind: 'live'; call: CallRow }
  | { kind: 'done'; call: CallRow }
  | { kind: 'error'; message: string };

const POLL_MS = 2500;
const POLL_LIMIT_MS = 2 * 60 * 60 * 1000;
const ACTIVE = new Set(['dialing', 'ringing', 'answered']);

function elapsed(from: string | null, now: number): string {
  if (!from) return '';
  const s = Math.max(0, Math.round((now - Date.parse(from)) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function CallButton({ dealId, contactId, phone, className }: { dealId?: string | null; contactId?: string | null; phone: string; className?: string }) {
  const me = useApi4comMe();
  const qc = useQueryClient();
  const { organizationId } = useAuth();
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [now, setNow] = useState(() => Date.now());
  const [hangingUp, setHangingUp] = useState(false);
  const mounted = useRef(true);
  useEffect(() => () => void (mounted.current = false), []);

  const liveId = phase.kind === 'live' ? phase.call.id : null;

  // Acompanha a ligação até ela terminar (o webhook atualiza o estado no servidor)
  useEffect(() => {
    if (!liveId) return;
    const startedAt = Date.now();
    let stop = false;
    const tick = async () => {
      if (stop) return;
      try {
        const { call } = await getApi4comCall(liveId);
        if (stop || !mounted.current) return;
        if (ACTIVE.has(call.status) && Date.now() - startedAt < POLL_LIMIT_MS) {
          setPhase({ kind: 'live', call });
          return;
        }
        setPhase({ kind: 'done', call });
        if (dealId) void invalidateLeadHistory(qc, organizationId, dealId);
      } catch {
        /* rede oscilou: tenta de novo no próximo ciclo */
      }
    };
    const timer = setInterval(() => void tick(), POLL_MS);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [liveId, dealId, organizationId, qc]);

  // Relógio da ligação em andamento
  useEffect(() => {
    if (phase.kind !== 'live' && phase.kind !== 'starting') return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [phase.kind]);

  // O resultado fica à vista por alguns segundos e o botão volta
  useEffect(() => {
    if (phase.kind !== 'done' && phase.kind !== 'error') return;
    const t = setTimeout(() => mounted.current && setPhase({ kind: 'idle' }), phase.kind === 'done' ? 10_000 : 12_000);
    return () => clearTimeout(t);
  }, [phase]);

  const start = useCallback(async () => {
    setPhase({ kind: 'starting' });
    setNow(Date.now());
    try {
      const { call } = await startApi4comCall({ phone, dealId, contactId });
      if (!mounted.current) return;
      setPhase(ACTIVE.has(call.status) ? { kind: 'live', call } : { kind: 'done', call });
    } catch (e) {
      if (mounted.current) setPhase({ kind: 'error', message: (e as Error).message || 'Não foi possível ligar.' });
    }
  }, [phone, dealId, contactId]);

  const hangup = useCallback(async () => {
    if (phase.kind !== 'live') return;
    setHangingUp(true);
    try {
      await hangupApi4comCall(phase.call.id);
    } catch (e) {
      setPhase({ kind: 'error', message: (e as Error).message || 'Não foi possível desligar.' });
    } finally {
      setHangingUp(false);
    }
  }, [phase]);

  if (!me.data?.connected) return null;

  if (phase.kind === 'idle') {
    return (
      <button
        type="button"
        onClick={() => void start()}
        title="Ligar pela API4com: toca primeiro no seu Webphone"
        className={`inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-300 dark:hover:bg-emerald-500/20 transition-colors focus-visible-ring ${className ?? ''}`}
      >
        <Phone size={12} aria-hidden="true" /> Ligar
      </button>
    );
  }

  const card = 'mt-1.5 w-full rounded-lg border px-2.5 py-2 text-xs';
  if (phase.kind === 'starting') {
    return (
      <div role="status" className={`${card} border-emerald-200 bg-emerald-50/70 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-900/15 dark:text-emerald-200`}>
        <p className="flex items-center gap-1.5 font-semibold">
          <Loader2 size={12} className="animate-spin" aria-hidden="true" /> Chamando o seu Webphone
        </p>
        <p className="mt-0.5 text-[11px] opacity-80">Atenda no Webphone da API4com para o CRM discar para o cliente.</p>
      </div>
    );
  }

  if (phase.kind === 'live') {
    const answered = phase.call.status === 'answered';
    return (
      <div role="status" className={`${card} border-emerald-200 bg-emerald-50/70 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-900/15 dark:text-emerald-200`}>
        <div className="flex items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 font-semibold">
            <span className={`h-2 w-2 rounded-full ${answered ? 'bg-emerald-500' : 'bg-amber-400 animate-pulse'}`} aria-hidden="true" />
            {answered ? <>Em ligação · <span className="tabular-nums">{elapsed(phase.call.answered_at, now)}</span></> : 'Chamando o cliente'}
          </p>
          <button
            type="button"
            onClick={() => void hangup()}
            disabled={hangingUp}
            className="inline-flex items-center gap-1 rounded-md bg-red-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-red-700 disabled:opacity-60 focus-visible-ring"
          >
            {hangingUp ? <Loader2 size={11} className="animate-spin" aria-hidden="true" /> : <PhoneOff size={11} aria-hidden="true" />} Desligar
          </button>
        </div>
      </div>
    );
  }

  if (phase.kind === 'done') {
    const c = phase.call;
    const ok = c.result === 'answered';
    const label = c.status === 'failed' ? c.error || 'Não foi possível ligar.' : c.result ? RESULT_LABEL[c.result] : 'Ligação encerrada';
    return (
      <div role="status" className={`${card} ${ok ? 'border-emerald-200 bg-emerald-50/70 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-900/15 dark:text-emerald-200' : 'border-slate-200 bg-slate-50 text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-slate-200'}`}>
        <p className="font-semibold">
          {label}
          {ok && c.duration ? ` · ${formatDuration(c.duration)}` : ''}
        </p>
        {ok ? <p className="mt-0.5 text-[11px] opacity-80">Registrada no histórico do lead.</p> : null}
      </div>
    );
  }

  return (
    <div role="alert" className={`${card} border-red-200 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-900/15 dark:text-red-300`}>
      {phase.message}
    </div>
  );
}

export default CallButton;
