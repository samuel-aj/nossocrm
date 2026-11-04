'use client';

/**
 * Janela da ligação (API4com), no topo da tela em qualquer página do CRM:
 * andamento, tempo, mudo, teclado e desligar; depois, o resultado. Também
 * mostra quem está ligando para o ramal (atender ou recusar).
 */
import React, { useEffect, useState } from 'react';
import { Grid3x3, Loader2, Mic, MicOff, Phone, PhoneIncoming, PhoneOff, X } from 'lucide-react';
import { RESULT_LABEL, formatDuration, formatPhone } from '@/lib/api4com/shared';
import { useApi4comPhone } from './Api4comPhoneProvider';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];

function clock(fromMs: number | null, now: number): string {
  if (!fromMs) return '0:00';
  const s = Math.max(0, Math.floor((now - fromMs) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// Celular: no topo. Computador: canto inferior esquerdo, para não cobrir o
// cabeçalho da conversa (nome do contato, Ligar, IA Insights).
const SHELL =
  'fixed left-1/2 top-3 z-[70] w-[min(420px,calc(100vw-24px))] -translate-x-1/2 rounded-2xl border bg-white px-3.5 py-3 shadow-2xl dark:bg-slate-900 sm:left-4 sm:top-auto sm:bottom-4 sm:w-[380px] sm:translate-x-0';
const ROUND = 'inline-flex h-9 w-9 items-center justify-center rounded-full transition-colors focus-visible-ring disabled:opacity-50';

export function PhoneDock() {
  const ctx = useApi4comPhone();
  const [now, setNow] = useState(() => Date.now());
  const [keypad, setKeypad] = useState(false);
  const session = ctx?.phone.session ?? null;
  const call = ctx?.call ?? null;
  const ticking = !!session || call?.stage === 'live';

  useEffect(() => {
    if (!ticking) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [ticking]);

  useEffect(() => {
    if (!session) setKeypad(false);
  }, [session]);

  if (!ctx) return null;

  // Alguém ligando para o ramal (fora do botão Ligar)
  if (session?.phase === 'incoming') {
    return (
      <div role="alertdialog" aria-label="Chamada recebida" className={`${SHELL} border-emerald-300 dark:border-emerald-500/40`}>
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 animate-pulse dark:bg-emerald-500/20 dark:text-emerald-300">
            <PhoneIncoming size={17} aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-slate-900 dark:text-white">Chamada recebida</p>
            <p className="truncate text-xs text-slate-500 dark:text-slate-400">{session.remote ? formatPhone(session.remote) : 'Número oculto'}</p>
          </div>
          <button type="button" onClick={ctx.hangup} aria-label="Recusar" title="Recusar" className={`${ROUND} bg-red-600 text-white hover:bg-red-700`}>
            <PhoneOff size={16} aria-hidden="true" />
          </button>
          <button type="button" onClick={ctx.answer} aria-label="Atender" title="Atender" className={`${ROUND} bg-emerald-600 text-white hover:bg-emerald-700`}>
            <Phone size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
    );
  }

  if (!call && !session) return null;

  // Texto principal e tom do cartão
  let title = '';
  let detail: string | null = null;
  let tone: 'live' | 'wait' | 'ok' | 'neutral' | 'bad' = 'wait';
  let spinner = false;
  const row = call?.row ?? null;
  const answeredAt = row?.answered_at ? Date.parse(row.answered_at) : null;

  if (call?.stage === 'connecting') {
    title = 'Ligando o telefone do CRM';
    detail = 'Se o navegador pedir, libere o microfone.';
    spinner = true;
  } else if (call?.stage === 'dialing') {
    title = 'Chamando';
    spinner = true;
  } else if (call?.stage === 'live') {
    if (row?.status === 'answered') {
      title = `Em ligação · ${clock(answeredAt ?? session?.startedAt ?? null, now)}`;
      tone = 'live';
    } else if (!session) {
      title = 'Encerrando a ligação';
      spinner = true;
    } else {
      title = 'Chamando o cliente';
      detail = 'Você ouve o toque. Fale quando atenderem.';
    }
  } else if (call?.stage === 'done') {
    const ok = row?.result === 'answered';
    tone = ok ? 'ok' : 'neutral';
    title = row?.status === 'failed' ? row.error || 'Não foi possível ligar.' : row?.result ? RESULT_LABEL[row.result] : 'Ligação encerrada';
    if (ok && row?.duration) title += ` · ${formatDuration(row.duration)}`;
    detail = call.dealId ? 'Registrada no histórico do lead.' : null;
  } else if (call?.stage === 'error') {
    tone = 'bad';
    title = call.error || 'Não foi possível ligar.';
  } else if (session) {
    // Chamada recebida já atendida (sem ligação do CRM)
    title = session.phase === 'in_call' ? `Em ligação · ${clock(session.startedAt, now)}` : 'Conectando';
    tone = session.phase === 'in_call' ? 'live' : 'wait';
    spinner = session.phase !== 'in_call';
  }

  const who = call ? call.label : session?.remote ? formatPhone(session.remote) : 'Ligação';
  const number = call && call.label !== call.phone ? formatPhone(call.phone) : null;
  const canControl = session?.phase === 'in_call';
  const closable = call?.stage === 'done' || call?.stage === 'error';
  const border =
    tone === 'live' || tone === 'ok'
      ? 'border-emerald-300 dark:border-emerald-500/40'
      : tone === 'bad'
        ? 'border-red-300 dark:border-red-500/40'
        : 'border-slate-200 dark:border-white/10';
  const dot = tone === 'live' ? 'bg-emerald-500' : tone === 'ok' ? 'bg-emerald-500' : tone === 'bad' ? 'bg-red-500' : tone === 'neutral' ? 'bg-slate-400' : 'bg-amber-400 animate-pulse';

  return (
    <section aria-label="Ligação" className={`${SHELL} ${border} flex flex-col sm:flex-col-reverse`}>
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-200">
          {spinner ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Phone size={16} aria-hidden="true" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 truncate text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} aria-hidden="true" />
            <span className="truncate">{who}</span>
          </p>
          <p role="status" className={`text-sm font-bold tabular-nums ${tone === 'bad' ? 'text-[13px] leading-snug text-red-700 dark:text-red-300' : 'truncate text-slate-900 dark:text-white'}`}>
            {title}
          </p>
          {detail || number ? <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">{detail || number}</p> : null}
        </div>
        {canControl ? (
          <>
            <button
              type="button"
              onClick={ctx.toggleMute}
              aria-pressed={!!session?.muted}
              aria-label={session?.muted ? 'Ligar o microfone' : 'Silenciar o microfone'}
              title={session?.muted ? 'Ligar o microfone' : 'Silenciar'}
              className={`${ROUND} ${session?.muted ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-white/10 dark:text-slate-200 dark:hover:bg-white/20'}`}
            >
              {session?.muted ? <MicOff size={16} aria-hidden="true" /> : <Mic size={16} aria-hidden="true" />}
            </button>
            <button
              type="button"
              onClick={() => setKeypad((v) => !v)}
              aria-expanded={keypad}
              aria-label="Teclado"
              title="Teclado (para menus de atendimento)"
              className={`${ROUND} bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-white/10 dark:text-slate-200 dark:hover:bg-white/20`}
            >
              <Grid3x3 size={16} aria-hidden="true" />
            </button>
          </>
        ) : null}
        {session || call?.stage === 'live' ? (
          <button type="button" onClick={ctx.hangup} aria-label="Desligar" title="Desligar" className={`${ROUND} bg-red-600 text-white hover:bg-red-700`}>
            <PhoneOff size={16} aria-hidden="true" />
          </button>
        ) : null}
        {closable ? (
          <button type="button" onClick={ctx.dismiss} aria-label="Fechar" title="Fechar" className={`${ROUND} text-slate-400 hover:text-slate-700 dark:hover:text-white`}>
            <X size={16} aria-hidden="true" />
          </button>
        ) : null}
      </div>
      {keypad && canControl ? (
        <div className="mt-3 grid grid-cols-3 gap-1.5 sm:mb-3 sm:mt-0" role="group" aria-label="Teclado">
          {KEYS.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => ctx.dtmf(k)}
              className="h-9 rounded-lg bg-slate-100 text-sm font-bold text-slate-800 hover:bg-slate-200 dark:bg-white/10 dark:text-white dark:hover:bg-white/20 focus-visible-ring"
            >
              {k}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}

export default PhoneDock;
