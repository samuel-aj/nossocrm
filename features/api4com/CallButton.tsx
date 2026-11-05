'use client';

/**
 * Botão "Ligar" do lead (API4com), no cabeçalho da conversa, ao lado de
 * IA Insights. Só aparece para quem conectou a própria API4com. O clique abre
 * um balão para confirmar o número (o do cadastro do contato ou outro digitado
 * na hora); a ligação só sai no "Ligar para ...". Ela sai pelo telefone
 * embutido no CRM (microfone do computador); o andamento, o mudo e o desligar
 * ficam na janela de ligação.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Loader2, Phone, PhoneOff } from 'lucide-react';
import { FloatingLayer } from '@/components/ui/FloatingLayer';
import { normalizePhoneE164 } from '@/lib/phone';
import { formatPhone } from '@/lib/api4com/shared';
import { useApi4comPhone } from './phone/Api4comPhoneProvider';

type Props = { dealId?: string | null; contactId?: string | null; phone?: string | null; label?: string | null; className?: string };

/** Número digitado ou cadastrado -> E.164 que dá para ligar; null enquanto não for um número completo. */
export function callableNumber(raw: string | null | undefined): string | null {
  const e164 = normalizePhoneE164(raw ?? '');
  return /^\+\d{10,15}$/.test(e164) ? e164 : null;
}

const option = (on: boolean) =>
  `flex items-start gap-2.5 rounded-lg border px-3 py-2.5 transition-colors ${
    on ? 'border-emerald-500 bg-emerald-50/70 dark:border-emerald-500/60 dark:bg-emerald-500/10' : 'border-slate-200 hover:border-slate-300 dark:border-white/10 dark:hover:border-white/20'
  }`;

function ConfirmNumber({ main, busy, onCall, onCancel }: { main: string; busy: boolean; onCall: (e164: string) => void; onCancel: () => void }) {
  const mainOk = callableNumber(main);
  const [choice, setChoice] = useState<'main' | 'other'>(mainOk ? 'main' : 'other');
  const [other, setOther] = useState('');
  const otherOk = callableNumber(other);
  const target = choice === 'main' ? mainOk : otherOk;
  const confirmRef = useRef<HTMLButtonElement>(null);
  const otherRef = useRef<HTMLInputElement>(null);

  // Com número no cadastro, o foco vai direto para o "Ligar para"; sem, para o campo
  useEffect(() => {
    if (confirmRef.current && !confirmRef.current.disabled) confirmRef.current.focus();
    else otherRef.current?.focus();
  }, []);

  return (
    <form
      className="p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (target && !busy) onCall(target);
      }}
    >
      <p className="text-sm font-bold text-slate-900 dark:text-white">Confirme o número</p>
      <p className="mb-2.5 text-[11px] text-slate-500 dark:text-slate-400">A ligação sai pelo telefone do CRM, com o microfone do computador.</p>

      <div role="radiogroup" aria-label="Número para ligar" className="space-y-2">
        <label className={`${option(choice === 'main')} ${mainOk ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}>
          <input
            type="radio"
            name="api4com-number"
            checked={choice === 'main'}
            disabled={!mainOk}
            onChange={() => setChoice('main')}
            className="mt-0.5 accent-emerald-600"
          />
          <span className="min-w-0">
            <span className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400">Telefone do cadastro</span>
            <span className="block truncate text-sm font-bold tabular-nums text-slate-900 dark:text-white">
              {mainOk ? formatPhone(mainOk) : main ? `${main} (número incompleto)` : 'Sem telefone cadastrado'}
            </span>
          </span>
        </label>

        <div className={`${option(choice === 'other')} cursor-text`} onClick={() => otherRef.current?.focus()}>
          <input
            type="radio"
            name="api4com-number"
            aria-label="Outro número"
            checked={choice === 'other'}
            onChange={() => {
              setChoice('other');
              otherRef.current?.focus();
            }}
            className="mt-0.5 accent-emerald-600"
          />
          <span className="min-w-0 flex-1">
            <span className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400">Outro número</span>
            <input
              ref={otherRef}
              type="tel"
              inputMode="tel"
              autoComplete="off"
              aria-label="Digite outro número"
              placeholder="DDD + número"
              value={other}
              onFocus={() => setChoice('other')}
              onChange={(e) => {
                setOther(e.target.value);
                setChoice('other');
              }}
              className="mt-1 h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:border-white/10 dark:bg-white/5 dark:text-white"
            />
            {other.trim() && !otherOk ? <span className="mt-1 block text-[11px] text-amber-700 dark:text-amber-400">Confira o DDD e o número.</span> : null}
          </span>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="h-9 rounded-lg px-3 text-xs font-bold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/10 focus-visible-ring"
        >
          Cancelar
        </button>
        <button
          ref={confirmRef}
          type="submit"
          disabled={!target || busy}
          className="inline-flex h-9 min-w-0 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs font-bold text-white shadow-sm hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none dark:disabled:bg-white/10 dark:disabled:text-slate-500 focus-visible-ring"
        >
          <Phone size={14} aria-hidden="true" />
          <span className="truncate tabular-nums">{target ? `Ligar para ${formatPhone(target)}` : 'Ligar'}</span>
        </button>
      </div>
    </form>
  );
}

export function CallButton({ dealId, contactId, phone, label, className }: Props) {
  const ctx = useApi4comPhone();
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [confirming, setConfirming] = useState(false);
  if (!ctx?.available) return null;

  const base = `h-8 px-3 inline-flex items-center gap-1.5 rounded-lg text-xs font-bold transition-colors focus-visible-ring disabled:cursor-not-allowed ${className ?? ''}`;
  const number = (phone ?? '').trim();
  const call = ctx.call;
  const busy = !!ctx.phone.session || (call && (call.stage === 'connecting' || call.stage === 'dialing' || call.stage === 'live'));
  const mine = !!call && !!dealId && call.dealId === dealId;

  if (busy && mine) {
    const live = !!ctx.phone.session || call?.stage === 'live';
    return live ? (
      <button type="button" onClick={ctx.hangup} className={`${base} bg-red-600 text-white hover:bg-red-700`} title="Desligar a ligação">
        <PhoneOff size={14} aria-hidden="true" /> Desligar
      </button>
    ) : (
      <span role="status" className={`${base} bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300`}>
        <Loader2 size={14} className="animate-spin" aria-hidden="true" /> Chamando
      </span>
    );
  }

  const online = ctx.phone.status === 'online';
  const title = busy ? 'Já existe uma ligação em andamento' : number ? `Ligar para ${number} ou outro número` : 'Ligar: digite o número na hora';

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        disabled={!!busy}
        aria-haspopup="dialog"
        aria-expanded={confirming}
        onClick={() => setConfirming((v) => !v)}
        title={title}
        className={`${base} bg-emerald-600 text-white shadow-sm hover:bg-emerald-700 disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none dark:disabled:bg-white/10 dark:disabled:text-slate-500`}
      >
        <span className="relative inline-flex">
          <Phone size={14} aria-hidden="true" />
          <span
            className={`absolute -right-1 -top-1 h-2 w-2 rounded-full ring-2 ring-emerald-600 ${online ? 'bg-lime-300' : 'bg-white/60'}`}
            aria-hidden="true"
          />
        </span>
        Ligar
        <span className="sr-only">{online ? ' (telefone do CRM ligado)' : ' (o telefone do CRM liga ao clicar)'}</span>
      </button>
      <FloatingLayer
        open={confirming}
        anchorRef={anchorRef}
        onClose={() => setConfirming(false)}
        width={340}
        align="end"
        maxHeight={420}
        role="dialog"
        ariaLabel="Confirmar o número da ligação"
      >
        <ConfirmNumber
          main={number}
          busy={!!busy}
          onCancel={() => setConfirming(false)}
          onCall={(e164) => {
            setConfirming(false);
            void ctx.startCall({ phone: e164, label, dealId, contactId });
          }}
        />
      </FloatingLayer>
    </>
  );
}

export default CallButton;
