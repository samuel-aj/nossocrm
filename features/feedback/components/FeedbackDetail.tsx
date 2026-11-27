'use client';

import { useState } from 'react';
import Image from 'next/image';
import { useFeedbackDetail, useReplyFeedback } from '@/lib/query/hooks';
import { useToast } from '@/context/ToastContext';
import { FEEDBACK_KIND_LABEL, FEEDBACK_STATUS_LABEL } from '@/lib/feedback/constants';

export function FeedbackDetail({ id }: { id: string }) {
  const { data, isError } = useFeedbackDetail(id);
  const reply = useReplyFeedback(id);
  const { addToast } = useToast();
  const [text, setText] = useState('');
  if (!data) {
    return isError
      ? <p role="alert" className="p-4 text-sm text-red-600">Não foi possível abrir este pedido.</p>
      : <p className="p-4 text-sm text-slate-500">Carregando…</p>;
  }

  const send = async () => {
    if (!text.trim()) return;
    try { await reply.mutateAsync(text.trim()); setText(''); addToast('Resposta enviada.', 'success'); }
    catch (e) { addToast(e instanceof Error ? e.message : 'Não foi possível responder.', 'error'); }
  };

  return (
    <div className="space-y-4 p-4 text-sm">
      <div className="flex flex-wrap gap-2 text-xs">
        <span className="rounded-full bg-primary-50 px-2 py-0.5 font-medium text-primary-700 dark:bg-primary-500/10 dark:text-primary-300">{FEEDBACK_STATUS_LABEL[data.status]}</span>
        {data.kind && <span className="rounded-full bg-slate-100 px-2 py-0.5 dark:bg-white/10">{FEEDBACK_KIND_LABEL[data.kind]}</span>}
        {data.priority_label && <span className="rounded-full bg-slate-100 px-2 py-0.5 dark:bg-white/10">{data.priority_label}</span>}
      </div>
      {data.body && <p className="whitespace-pre-wrap">{data.body}</p>}
      {data.transcript && <p className="whitespace-pre-wrap text-slate-600 dark:text-slate-300"><strong>Áudio:</strong> {data.transcript}</p>}
      {data.attachments.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {data.attachments.map(a => a.url && (a.kind === 'image'
            ? <a key={a.id} href={a.url} target="_blank" rel="noreferrer"><Image src={a.url} alt="Print enviado" width={80} height={80} unoptimized className="h-20 w-20 rounded object-cover" /></a>
            : a.kind === 'audio' ? <audio key={a.id} controls src={a.url} className="h-10" />
              : <a key={a.id} href={a.url} target="_blank" rel="noreferrer" className="underline">Arquivo anexado</a>))}
        </div>
      )}
      {data.public_reply && <p className="rounded-lg bg-slate-50 p-3 dark:bg-white/5"><strong>Resposta:</strong> {data.public_reply}</p>}
      {data.tutorial_url && <a href={data.tutorial_url} target="_blank" rel="noreferrer" className="font-medium text-primary-600 underline">Ver o tutorial</a>}
      {data.messages.length > 0 && (
        <ul className="space-y-2">
          {data.messages.map(m => (
            <li key={m.id} className={`rounded-lg p-2 ${m.author_kind === 'agent' ? 'bg-slate-50 dark:bg-white/5' : 'bg-primary-50 dark:bg-primary-500/10'}`}>
              <span className="block text-xs text-slate-500">{m.author_kind === 'agent' ? 'Equipe' : 'Você'}</span>{m.body}
            </li>
          ))}
        </ul>
      )}
      {data.status === 'precisa_detalhes' && (
        <div className="space-y-2">
          <textarea aria-label="Sua resposta" value={text} rows={3} onChange={e => setText(e.target.value)}
            className="w-full resize-none rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-white/10 dark:bg-black/20" />
          <button type="button" onClick={send} disabled={!text.trim() || reply.isPending}
            className="rounded-lg bg-primary-600 px-4 py-2 font-medium text-white disabled:opacity-50">Responder</button>
        </div>
      )}
    </div>
  );
}
