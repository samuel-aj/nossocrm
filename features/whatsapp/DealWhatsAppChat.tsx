'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Send, MessageCircle, Loader2 } from 'lucide-react';
import { normalizePhoneE164 } from '@/lib/phone';
import { useWhatsAppChat, type WaChatMessage } from './useWhatsAppChat';

const TIME_FMT = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });

function statusTick(status: string): string {
  switch (status) {
    case 'read':
      return '✓✓';
    case 'delivered':
      return '✓✓';
    case 'sent':
      return '✓';
    case 'failed':
      return '⚠';
    case 'queued':
      return '⏱';
    default:
      return '';
  }
}

function MessageBubble({ m }: { m: WaChatMessage }) {
  const isOut = m.direction === 'out';
  const time = (() => {
    const raw = m.wa_timestamp || m.created_at;
    const d = new Date(raw);
    return isNaN(d.getTime()) ? '' : TIME_FMT.format(d);
  })();
  return (
    <div className={`flex ${isOut ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[78%] rounded-2xl px-3 py-2 text-sm shadow-sm ${
          isOut
            ? 'bg-emerald-600 text-white rounded-br-sm'
            : 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white rounded-bl-sm border border-slate-200 dark:border-white/10'
        }`}
      >
        {m.body ? (
          <p className="whitespace-pre-wrap break-words">{m.body}</p>
        ) : (
          <p className="italic opacity-70">{m.media_type ? `[${m.media_type}]` : '[sem conteúdo]'}</p>
        )}
        <div
          className={`mt-1 flex items-center justify-end gap-1 text-[10px] ${
            isOut ? 'text-emerald-100' : 'text-slate-400'
          }`}
        >
          <span>{time}</span>
          {isOut && (
            <span className={m.status === 'read' ? 'text-sky-200' : m.status === 'failed' ? 'text-red-200' : ''}>
              {statusTick(m.status)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function CenterMsg({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center gap-2 text-slate-500 dark:text-slate-400 px-6">
      <MessageCircle size={28} className="opacity-40" />
      <p className="text-sm">{children}</p>
    </div>
  );
}

export function DealWhatsAppChat({
  contact,
}: {
  contact: { id: string; name?: string | null; phone?: string | null } | null;
}) {
  const phone = useMemo(() => normalizePhoneE164(contact?.phone || ''), [contact?.phone]);
  const { data, isLoading, error, send } = useWhatsAppChat(phone || null);
  const [text, setText] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  const messages = data?.messages ?? [];
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  if (!contact) return <CenterMsg>Este lead não tem contato vinculado.</CenterMsg>;
  if (!phone)
    return <CenterMsg>O contato não tem telefone. Adicione um número pra conversar pelo WhatsApp.</CenterMsg>;

  const onSend = () => {
    const t = text.trim();
    if (!t || send.isPending) return;
    setText('');
    send.mutate(t, { onError: () => setText(t) });
  };

  return (
    <div className="flex flex-col h-full min-h-0 rounded-xl overflow-hidden border border-slate-200 dark:border-white/10">
      {/* Cabeçalho da conversa */}
      <div className="shrink-0 flex items-center gap-2 px-4 py-2.5 border-b border-slate-200 dark:border-white/10 bg-white/60 dark:bg-white/5">
        <span className="w-7 h-7 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 flex items-center justify-center">
          <MessageCircle size={15} />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-bold text-slate-900 dark:text-white truncate">
            {contact.name || data?.conversation?.wa_name || 'Contato'}
          </p>
          <p className="text-[11px] text-slate-500">{phone}</p>
        </div>
        {data && !data.connected && (
          <span className="ml-auto text-[11px] text-amber-600 dark:text-amber-400">WhatsApp desconectado</span>
        )}
      </div>

      {/* Aviso de não-conectado */}
      {data && !data.hasConnection && (
        <div className="shrink-0 px-4 py-2 text-xs bg-amber-50 dark:bg-amber-500/10 text-amber-800 dark:text-amber-300 border-b border-amber-200/60 dark:border-amber-500/20">
          WhatsApp ainda não conectado nesta organização. Um admin pode conectar em{' '}
          <span className="font-semibold">Configurações → Integrações</span>.
        </div>
      )}

      {/* Mensagens */}
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-custom px-4 py-3 space-y-2 bg-slate-50/40 dark:bg-black/10">
        {isLoading && (
          <div className="h-full flex items-center justify-center text-slate-400">
            <Loader2 className="animate-spin" size={20} />
          </div>
        )}
        {error && <p className="text-sm text-red-500 text-center">{(error as Error).message}</p>}
        {!isLoading && !error && messages.length === 0 && (
          <CenterMsg>Nenhuma mensagem ainda. Envie a primeira mensagem 👇</CenterMsg>
        )}
        {messages.map((m) => (
          <MessageBubble key={m.id} m={m} />
        ))}
        <div ref={endRef} />
      </div>

      {/* Composer */}
      <div className="shrink-0 border-t border-slate-200 dark:border-white/10 p-3 bg-white dark:bg-dark-card">
        {send.isError && (
          <p className="mb-1.5 text-xs text-red-500">{(send.error as Error).message}</p>
        )}
        <div className="flex items-end gap-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                onSend();
              }
            }}
            rows={1}
            placeholder="Escreva uma mensagem..."
            className="flex-1 resize-none max-h-32 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-xl px-3 py-2.5 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-emerald-500"
          />
          <button
            type="button"
            onClick={onSend}
            disabled={!text.trim() || send.isPending}
            className="shrink-0 h-10 w-10 inline-flex items-center justify-center rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white transition-colors"
            aria-label="Enviar mensagem"
            title="Enviar (Enter)"
          >
            {send.isPending ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
          </button>
        </div>
      </div>
    </div>
  );
}
