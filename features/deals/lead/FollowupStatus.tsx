'use client';

/** Linha discreta com o estado do follow-up por inatividade da etapa atual do lead. */
import { AlertTriangle, Bot, Clock, Zap } from 'lucide-react';
import { useDealFollowup } from './useDealHistory';

const DT = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

function inWords(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} h${min % 60 ? ` ${min % 60} min` : ''}`;
  return `${Math.round(h / 24)} dias`;
}

export function FollowupStatus({ dealId, stageId }: { dealId: string; stageId: string }) {
  const { data } = useDealFollowup(dealId, stageId);
  if (!data) return null;
  const s = data.schedule;
  const action = data.rule.action_type === 'bot' ? 'iniciar o robô' : 'enviar a mensagem';
  let icon = <Clock size={12} aria-hidden="true" />;
  let text: string;
  let tone = 'text-slate-500 dark:text-slate-400';
  if (data.firedOnceAt || s?.status === 'done') {
    icon = data.rule.action_type === 'bot' ? <Bot size={12} aria-hidden="true" /> : <Zap size={12} aria-hidden="true" />;
    tone = 'text-emerald-700 dark:text-emerald-400';
    text = `Follow-up desta etapa já executado em ${DT.format(new Date(data.firedOnceAt ?? s?.fired_at ?? s?.due_at ?? Date.now()))}. Ele só dispara uma vez por etapa para cada lead.`;
  } else if (!s || s.status === 'cancelled') {
    text = 'Follow-up por inatividade ligado nesta etapa. A contagem começa na próxima entrada ou mensagem do lead.';
  } else if (s.status === 'scheduled' || s.status === 'processing') {
    const ms = Date.parse(s.due_at) - Date.now();
    text =
      ms > 0
        ? `Follow-up: se o lead não responder, vai ${action} em ${inWords(ms)} (${DT.format(new Date(s.due_at))}).`
        : `Follow-up: executando agora.`;
  } else if (s.status === 'failed') {
    icon = <AlertTriangle size={12} aria-hidden="true" />;
    tone = 'text-red-600 dark:text-red-400';
    const err = (s.last_result as { error?: string } | null)?.error;
    text = `Follow-up falhou${err ? `: ${err}` : ''}.`;
  } else {
    const reason = (s.last_result as { reason?: string } | null)?.reason;
    text = `Follow-up não executado${reason ? `: ${reason}` : ''}.`;
  }
  return (
    <p className={`flex items-start gap-1.5 text-[11px] leading-snug ${tone}`} role="status">
      <span className="mt-[1px] shrink-0">{icon}</span>
      <span>{text}</span>
    </p>
  );
}
