'use client';

/**
 * Janela da ligação (API4com), num canto da tela em qualquer página do CRM:
 * quem é, o andamento e o tempo, "Encerrar" e, embaixo, os controles da
 * ligação (mudo, teclado, áudio e abrir o lead). Também mostra quem está
 * ligando para o ramal (atender ou recusar) e, no fim, o resultado.
 *
 * Computador: lado direito, um pouco acima do rodapé (não cobre o campo de
 * mensagem nem o botão de enviar da conversa).
 * Celular: topo da tela. Fica ACIMA da tela do lead (z 9999) e dos menus,
 * abaixo das listas de seleção (10050) e dos avisos do CRM (11000).
 */
import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Mic, MicOff, Phone, PhoneIncoming, PhoneOff, SlidersHorizontal, SquareArrowOutUpRight, X } from 'lucide-react';
import { RESULT_LABEL, formatDuration, formatPhone } from '@/lib/api4com/shared';
import { useApi4comPhone, type ActiveCall } from './Api4comPhoneProvider';


function clock(fromMs: number | null, now: number): string {
  if (!fromMs) return '0:00';
  const s = Math.max(0, Math.floor((now - fromMs) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function initials(name: string): string {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  if (!words.length || /^\d/.test(words[0])) return '';
  return (words[0][0] + (words.length > 1 ? words[words.length - 1][0] : '')).toUpperCase();
}

const SHELL =
  'fixed z-[10040] left-1/2 top-3 -translate-x-1/2 w-[min(360px,calc(100vw-24px))] sm:left-auto sm:right-4 sm:top-auto sm:bottom-24 sm:translate-x-0 ' +
  'rounded-2xl border border-slate-200 bg-white/95 shadow-2xl shadow-slate-900/20 backdrop-blur dark:border-dark-border dark:bg-dark-card/95 dark:shadow-black/50 ' +
  'animate-in fade-in slide-in-from-bottom-2 duration-200';

type Tone = 'live' | 'wait' | 'ok' | 'neutral' | 'bad';
const DOT: Record<Tone, string> = {
  live: 'bg-emerald-500',
  ok: 'bg-emerald-500',
  wait: 'bg-amber-400 animate-pulse',
  neutral: 'bg-slate-400',
  bad: 'bg-red-500',
};

/** Botão redondo dos controles, com o nome embaixo. */
function Control({
  label,
  onClick,
  active = false,
  disabled = false,
  pressed,
  expanded,
  children,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  pressed?: boolean;
  expanded?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={pressed}
      aria-expanded={expanded}
      className="group flex min-w-0 flex-1 flex-col items-center gap-1 rounded-xl py-1 focus-visible-ring disabled:opacity-40"
    >
      <span
        className={`flex h-10 w-10 items-center justify-center rounded-full transition-colors ${
          active
            ? 'bg-primary-600 text-white dark:bg-primary-500'
            : 'bg-slate-100 text-slate-700 group-hover:bg-slate-200 dark:bg-white/10 dark:text-slate-100 dark:group-hover:bg-white/15'
        }`}
      >
        {children}
      </span>
      <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">{label}</span>
    </button>
  );
}

/** Microfone, saída de som e volume. */
function AudioPanel() {
  const ctx = useApi4comPhone();
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  useEffect(() => {
    let alive = true;
    const load = () => {
      void navigator.mediaDevices
        ?.enumerateDevices()
        .then((list) => {
          if (alive) setDevices(list);
        })
        .catch(() => undefined);
    };
    load();
    navigator.mediaDevices?.addEventListener?.('devicechange', load);
    return () => {
      alive = false;
      navigator.mediaDevices?.removeEventListener?.('devicechange', load);
    };
  }, []);
  if (!ctx) return null;
  const real = (d: MediaDeviceInfo) => d.deviceId !== 'default' && d.deviceId !== 'communications' && !!d.deviceId;
  const inputs = devices.filter((d) => d.kind === 'audioinput' && real(d));
  const outputs = devices.filter((d) => d.kind === 'audiooutput' && real(d));
  const select =
    'mt-1 w-full truncate rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-800 focus-visible-ring dark:border-dark-border dark:bg-dark-bg dark:text-slate-100';
  const label = 'block text-[11px] font-semibold text-slate-500 dark:text-slate-400';
  return (
    <div className="space-y-2.5 px-3.5 pb-3.5 pt-1" role="group" aria-label="Áudio da ligação">
      <label className={label}>
        Microfone
        <select className={select} value={ctx.audio.inputId ?? ''} onChange={(e) => void ctx.setInputDevice(e.target.value || null).catch(() => undefined)}>
          <option value="">Padrão do computador</option>
          {inputs.map((d, i) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || `Microfone ${i + 1}`}
            </option>
          ))}
        </select>
      </label>
      {ctx.audio.canChooseOutput ? (
        <label className={label}>
          Saída de som
          <select className={select} value={ctx.audio.outputId ?? ''} onChange={(e) => void ctx.setOutputDevice(e.target.value || null)}>
            <option value="">Padrão do computador</option>
            {outputs.map((d, i) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `Saída ${i + 1}`}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label className={label}>
        Volume
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={Math.round(ctx.audio.volume * 100)}
          onChange={(e) => ctx.setVolume(Number(e.target.value) / 100)}
          className="mt-1.5 w-full accent-primary-600"
          aria-valuetext={`${Math.round(ctx.audio.volume * 100)}%`}
        />
      </label>
    </div>
  );
}

function describe(call: ActiveCall | null, session: { phase: string; startedAt: number | null } | null, now: number) {
  const row = call?.row ?? null;
  let title = '';
  let tone: Tone = 'wait';
  let spinner = false;
  /** Ainda tocando no cliente: ondas em volta do contato. */
  let ringing = false;
  let detail: string | null = null;
  if (call?.stage === 'connecting') {
    title = 'Preparando a ligação';
    detail = 'Libere o microfone se o navegador pedir';
    ringing = true;
  } else if (call?.stage === 'dialing') {
    title = `Chamando · ${clock(call.createdAt, now)}`;
    detail = 'Discando para o cliente';
    ringing = true;
  } else if (call?.stage === 'live') {
    if (row?.status === 'answered') {
      const from = row.answered_at ? Date.parse(row.answered_at) : session?.startedAt ?? null;
      title = `Em ligação · ${clock(from, now)}`;
      tone = 'live';
    } else {
      title = `Chamando · ${clock(call.createdAt, now)}`;
      detail = 'Tocando no celular do cliente';
      ringing = true;
    }
  } else if (call?.stage === 'ending') {
    title = 'Ligação encerrada';
    detail = 'Registrando o resultado no lead';
    tone = 'neutral';
  } else if (call?.stage === 'done') {
    const ok = row?.result === 'answered';
    tone = ok ? 'ok' : 'neutral';
    title = row?.status === 'failed' ? row.error || 'Não foi possível ligar.' : row?.result ? RESULT_LABEL[row.result] : 'Ligação encerrada';
    if (ok && row?.duration) title += ` · ${formatDuration(row.duration)}`;
    detail = call.dealId && row?.status === 'ended' ? 'Registrada no histórico do lead.' : null;
  } else if (call?.stage === 'error') {
    tone = 'bad';
    title = call.error || 'Não foi possível ligar.';
  } else if (session) {
    title = session.phase === 'in_call' ? `Em ligação · ${clock(session.startedAt, now)}` : 'Conectando';
    tone = session.phase === 'in_call' ? 'live' : 'wait';
    spinner = session.phase !== 'in_call';
  }
  return { title, tone, spinner, ringing, detail };
}

export function PhoneDock() {
  const ctx = useApi4comPhone();
  const router = useRouter();
  const [now, setNow] = useState(() => Date.now());
  const [panel, setPanel] = useState<'none' | 'audio'>('none');
  const session = ctx?.phone.session ?? null;
  const call = ctx?.call ?? null;
  const ticking = !!session || call?.stage === 'live' || call?.stage === 'dialing' || call?.stage === 'connecting';

  useEffect(() => {
    if (!ticking) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [ticking]);

  if (!ctx) return null;

  // Alguém ligando para o ramal (fora do botão Ligar)
  if (session?.phase === 'incoming') {
    const number = session.remote ? formatPhone(session.remote) : 'Número oculto';
    return (
      <div role="alertdialog" aria-label="Chamada recebida" className={SHELL}>
        <div className="flex items-center gap-3 p-3.5">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 ring-4 ring-emerald-500/20 animate-pulse dark:bg-emerald-500/20 dark:text-emerald-300">
            <PhoneIncoming size={18} aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold text-slate-900 dark:text-white">{number}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">Chamada recebida</p>
          </div>
          <button type="button" onClick={ctx.hangup} className="h-9 rounded-full bg-red-600 px-3.5 text-xs font-bold text-white hover:bg-red-700 focus-visible-ring">
            Recusar
          </button>
          <button type="button" onClick={ctx.answer} className="h-9 rounded-full bg-emerald-600 px-3.5 text-xs font-bold text-white hover:bg-emerald-700 focus-visible-ring">
            Atender
          </button>
        </div>
      </div>
    );
  }

  if (!call && !session) return null;

  const { title, tone, spinner, ringing, detail } = describe(call, session, now);
  const name = call ? call.label : session?.remote ? formatPhone(session.remote) : 'Ligação';
  const number = call && call.label !== call.phone ? formatPhone(call.phone) : null;
  const ini = initials(name);
  const inCall = session?.phase === 'in_call';
  const finished = call?.stage === 'done' || call?.stage === 'error' || call?.stage === 'ending';
  const canEnd = !finished && (!!session || call?.stage === 'live' || call?.stage === 'dialing' || call?.stage === 'connecting');

  return (
    <section aria-label="Ligação" className={`${SHELL} ${tone === 'bad' ? 'border-red-300 dark:border-red-500/40' : ''}`}>
      <div className="flex items-center gap-3 p-3.5">
        <span
          className={`relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
            tone === 'bad'
              ? 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300'
              : 'bg-primary-100 text-primary-700 dark:bg-primary-500/20 dark:text-primary-200'
          } ${tone === 'live' ? 'ring-4 ring-emerald-500/25' : ''}`}
          aria-hidden="true"
        >
          {ringing ? (
            <>
              <span className="absolute inset-0 rounded-full bg-primary-500/30 animate-ping" />
              <span className="absolute -inset-1.5 rounded-full border-2 border-primary-400/40 animate-pulse" />
            </>
          ) : null}
          <span className="relative">{spinner ? <Loader2 size={18} className="animate-spin" /> : ini || <Phone size={18} />}</span>
          <span className={`absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white dark:border-dark-card ${DOT[tone]}`} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-slate-900 dark:text-white" title={number ? `${name} · ${number}` : name}>
            {name}
          </p>
          {number ? <p className="truncate text-[11px] font-semibold tabular-nums text-slate-500 dark:text-slate-400">{number}</p> : null}
          <p
            role="status"
            className={`text-xs tabular-nums ${
              tone === 'bad'
                ? 'font-semibold leading-snug text-red-700 dark:text-red-300'
                : ringing
                  ? 'truncate font-semibold text-primary-700 dark:text-primary-300'
                  : 'truncate text-slate-600 dark:text-slate-300'
            }`}
          >
            {title}
          </p>
          {detail ? <p className="truncate text-[11px] text-slate-400 dark:text-slate-500">{detail}</p> : null}
        </div>
        {canEnd ? (
          <button
            type="button"
            onClick={ctx.hangup}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-red-600 px-3.5 text-xs font-bold text-white shadow-sm shadow-red-900/30 transition hover:bg-red-700 active:scale-95 focus-visible-ring"
          >
            <PhoneOff size={14} aria-hidden="true" /> Encerrar
          </button>
        ) : (
          <button
            type="button"
            onClick={ctx.dismiss}
            aria-label="Fechar"
            title="Fechar"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/10 dark:hover:text-white focus-visible-ring"
          >
            <X size={16} aria-hidden="true" />
          </button>
        )}
      </div>

      {!finished ? (
        <div className="flex items-start justify-between gap-1 border-t border-slate-100 px-2.5 py-2 dark:border-white/5">
          <Control label={session?.muted ? 'Mudo' : 'Microfone'} onClick={ctx.toggleMute} disabled={!inCall} active={!!session?.muted} pressed={!!session?.muted}>
            {session?.muted ? <MicOff size={17} aria-hidden="true" /> : <Mic size={17} aria-hidden="true" />}
          </Control>
          <Control label="Áudio" onClick={() => setPanel((p) => (p === 'audio' ? 'none' : 'audio'))} active={panel === 'audio'} expanded={panel === 'audio'}>
            <SlidersHorizontal size={17} aria-hidden="true" />
          </Control>
          {call?.dealId ? (
            <Control label="Lead" onClick={() => router.push(`/boards?deal=${call.dealId}`)}>
              <SquareArrowOutUpRight size={16} aria-hidden="true" />
            </Control>
          ) : null}
        </div>
      ) : null}

      {!finished && panel === 'audio' ? <AudioPanel /> : null}
    </section>
  );
}

export default PhoneDock;
