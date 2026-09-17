'use client';

import React, { useEffect, useRef, useState } from 'react';
import { MessageCircle, Paperclip, RotateCcw, Send, X } from 'lucide-react';
import { MessageBubble } from './DealWhatsAppChat';
import { EditMessageModal } from './EditMessageModal';
import { useChatImageTransfer } from './useChatImageTransfer';
import type { WaChatMessage } from './useWhatsAppChat';
import { messageEditError } from '@/lib/whatsapp/messageEditing';

const SELF = 'demo-self';
function demoMessage(body: string, createdAt: string, id: string): WaChatMessage {
  return { id, body, direction: 'out', status: 'sent', media_type: null, media_mime: null,
    media_url: null, from_phone: null, to_phone: null, wa_timestamp: createdAt, created_at: createdAt,
    sent_by: SELF, sent_by_name: 'Você', source: 'crm', error: null, transcription: null };
}

/** Local-only fixture: no chat hook, upload, provider, or persistence is called. */
export function WhatsAppChatDemo({ startedAt, embedded = false }: { startedAt: string; embedded?: boolean }) {
  const [messages, setMessages] = useState<WaChatMessage[]>(() => [demoMessage('Esta é sua mensagem de teste. Abra a seta e escolha Editar.', startedAt, 'demo-initial')]);
  const [now, setNow] = useState(() => Date.parse(startedAt));
  const [text, setText] = useState('');
  const [editing, setEditing] = useState<WaChatMessage | null>(null);
  const [attachment, setAttachment] = useState<{ file: File; url: string } | null>(null);
  const [notice, setNotice] = useState('');
  const urls = useRef(new Set<string>());
  const input = useRef<HTMLInputElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const owned = urls.current;
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => { window.clearInterval(timer); owned.forEach(url => URL.revokeObjectURL(url)); };
  }, []);
  useEffect(() => { bottom.current?.scrollIntoView({ block: 'nearest' }); }, [messages]);
  const release = (url: string) => { URL.revokeObjectURL(url); urls.current.delete(url); };
  const clearAttachment = () => { if (attachment) release(attachment.url); setAttachment(null); };
  const onFile = (file: File) => {
    if (!file.type.startsWith('image/')) { setNotice('Escolha um arquivo de imagem.'); return; }
    if (attachment) release(attachment.url);
    const url = URL.createObjectURL(file);
    urls.current.add(url); setAttachment({ file, url }); setNotice('Imagem pronta para o envio simulado.');
  };
  const transfer = useChatImageTransfer({ onFile, blocked: !!editing, onError: setNotice });
  const canEdit = (m: WaChatMessage, at = now) => messageEditError({ ...m, evolution_message_id: m.id }, SELF, 'evolution', at) === null;
  const reset = () => {
    urls.current.forEach(url => URL.revokeObjectURL(url)); urls.current.clear();
    const date = new Date().toISOString();
    setMessages([demoMessage('Esta é sua mensagem de teste. Abra a seta e escolha Editar.', date, 'demo-initial')]);
    setNow(Date.parse(date)); setText(''); setAttachment(null); setEditing(null); setNotice('Demonstração reiniciada.');
  };
  const send = () => {
    if ((!text.trim() && !attachment) || editing) return;
    const date = new Date().toISOString();
    const m = demoMessage(text.trim(), date, crypto.randomUUID());
    if (attachment) Object.assign(m, { media_type: 'image', media_mime: attachment.file.type, media_url: attachment.url });
    setMessages(previous => [...previous, m]); setNow(Date.parse(date)); setText(''); setAttachment(null);
    setNotice('Adicionada apenas nesta demonstração. Nada foi enviado ao WhatsApp.');
  };
  return <div className={`flex h-full min-h-0 flex-col text-slate-900 dark:text-white ${embedded ? 'p-3' : 'p-3 sm:p-6'}`}>
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-xl font-bold">{embedded ? 'Número de teste · QR' : 'Teste do chat'}</h1><p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Número comum simulado · sem janela de API</p></div>
      <button type="button" onClick={reset} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm dark:border-white/10"><RotateCcw size={15} /> Reiniciar teste</button>
    </div>
    <p className="mb-4 rounded-xl border border-purple-200 bg-purple-50 p-3 text-sm text-purple-800 dark:border-purple-500/30 dark:bg-purple-500/10 dark:text-purple-200">
      <strong>Simulação — nenhum envio real.</strong> Edite o texto pela seta da mensagem. Cole uma imagem no campo ou arraste-a para a conversa. Ao atualizar a página, o teste recomeça.
    </p>
    <div {...transfer.dropHandlers} className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 dark:border-white/10 dark:bg-dark-bg">
      <header className="flex items-center gap-3 border-b border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-dark-card">
        <MessageCircle size={22} className="text-emerald-600" /><div><h2 className="font-bold">Contato de demonstração</h2><p className="text-xs text-slate-500 dark:text-slate-400">Conversa fictícia · edição de textos por até 15 minutos</p></div>
      </header>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-6">
        {messages.map(m => <MessageBubble key={m.id} m={{ ...m, can_edit: canEdit(m) }} onAction={(action, message) => {
          if (action === 'edit') setEditing(message);
          else setNotice('Nesta demonstração, teste a edição de texto e o envio de imagens.');
        }} />)}
        <div ref={bottom} />
      </div>
      <div className="border-t border-slate-200 bg-white p-3 dark:border-white/10 dark:bg-dark-card">
        <p role="status" className="mb-2 min-h-5 text-xs text-slate-500 dark:text-slate-400">{notice || 'A imagem aparecerá em uma prévia antes do envio simulado.'}</p>
        {attachment && <div className="mb-3 flex items-center gap-3 rounded-xl bg-slate-100 p-3 dark:bg-white/5">
          {/* eslint-disable-next-line @next/next/no-img-element -- Local blob preview, never uploaded. */}
          <img src={attachment.url} alt="Prévia da imagem" className="h-24 w-24 rounded-lg object-contain" />
          <span className="min-w-0 flex-1 truncate text-sm">{attachment.file.name}</span>
          <button type="button" onClick={clearAttachment} aria-label="Remover imagem" className="p-2"><X size={18} /></button>
        </div>}
        <form onSubmit={event => { event.preventDefault(); send(); }} className="flex items-end gap-2">
          <input ref={input} type="file" accept="image/*" className="hidden" aria-label="Arquivo de imagem" onChange={event => { const file = event.target.files?.[0]; if (file) onFile(file); event.target.value = ''; }} />
          <button type="button" aria-label="Anexar imagem" onClick={() => input.current?.click()} className="rounded-xl p-3 text-slate-500"><Paperclip size={21} /></button>
          <textarea aria-label="Mensagem de teste" placeholder="Escreva ou cole uma imagem…" value={text} onChange={event => setText(event.target.value)}
            onPaste={transfer.onPaste} maxLength={4096} rows={2} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(); } }}
            className="min-w-0 flex-1 resize-none rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm focus:ring-2 focus:ring-emerald-500 dark:border-white/10 dark:bg-dark-bg" />
          <button type="submit" aria-label="Enviar na simulação" title="Enviar na simulação" disabled={!text.trim() && !attachment} className="rounded-xl bg-emerald-600 p-3 text-white disabled:opacity-40"><Send size={21} /></button>
        </form>
      </div>
      {transfer.draggingImage && <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center border-2 border-dashed border-emerald-500 bg-emerald-50/95 text-lg font-semibold text-emerald-800 dark:bg-slate-900/95 dark:text-emerald-300">Solte a imagem para anexar</div>}
    </div>
    {editing && <EditMessageModal key={editing.id} message={editing} onClose={() => setEditing(null)} onSave={async ({ messageId, text: body }) => {
      if (!canEdit(editing, Date.now())) throw new Error('O prazo de edição terminou. Reinicie o teste para tentar novamente.');
      setMessages(previous => previous.map(m => m.id === messageId ? { ...m, body, edited_at: new Date().toISOString() } : m));
      setNotice('Texto editado somente nesta demonstração.');
    }} />}
  </div>;
}
