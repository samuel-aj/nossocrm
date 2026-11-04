'use client';

/**
 * Botão "Ligar" do lead (API4com), no cabeçalho da conversa, ao lado de
 * IA Insights. Só aparece para quem conectou a própria API4com. A ligação sai
 * pelo telefone embutido no CRM (microfone do computador); o andamento, o mudo,
 * o teclado e o desligar ficam na janela de ligação no topo da tela.
 */
import React from 'react';
import { Loader2, Phone, PhoneOff } from 'lucide-react';
import { useApi4comPhone } from './phone/Api4comPhoneProvider';

type Props = { dealId?: string | null; contactId?: string | null; phone?: string | null; label?: string | null; className?: string };

export function CallButton({ dealId, contactId, phone, label, className }: Props) {
  const ctx = useApi4comPhone();
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
  const title = !number
    ? 'O contato não tem telefone cadastrado'
    : busy
      ? 'Já existe uma ligação em andamento'
      : online
        ? `Ligar para ${number} pelo telefone do CRM`
        : `Ligar para ${number}. O telefone do CRM liga na hora e usa o microfone do computador.`;

  return (
    <button
      type="button"
      disabled={!number || !!busy}
      onClick={() => void ctx.startCall({ phone: number, label, dealId, contactId })}
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
  );
}

export default CallButton;
