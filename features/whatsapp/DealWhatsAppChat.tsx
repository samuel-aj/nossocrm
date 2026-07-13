'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Send,
  MessageCircle,
  Loader2,
  Paperclip,
  Smile,
  Mic,
  X,
  FileText,
  Image as ImageIcon,
  Video as VideoIcon,
  Check,
  CheckCheck,
  Clock3,
  AlertCircle,
} from 'lucide-react';
import { normalizePhoneE164 } from '@/lib/phone';
import { useWhatsAppChat, type WaChatMessage, type WaMediaKind } from './useWhatsAppChat';

const TIME_FMT = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });

const MEDIA_LABEL: Record<string, string> = {
  image: 'imagem',
  video: 'vídeo',
  audio: 'áudio',
  document: 'documento',
  sticker: 'figurinha',
};

const EMOJIS = [
  '😀', '😁', '😂', '🤣', '😊', '😍', '😘', '😎',
  '🤔', '🙄', '😅', '😢', '😭', '😡', '🥳', '🤝',
  '👍', '👎', '👏', '🙏', '💪', '🤙', '👋', '✌️',
  '❤️', '💚', '💙', '💛', '🖤', '💔', '🔥', '⭐',
  '✨', '🎉', '🎊', '✅', '❌', '⚠️', '📌', '📄',
  '📷', '🎤', '💰', '💵', '📅', '⏰', '⚖️', '🚀',
];

/** Ticks estilo WhatsApp: ⏱ enviando · ✓ enviada · ✓✓ entregue · ✓✓ AZUL lida. */
function StatusTicks({ status }: { status: string }) {
  switch (status) {
    case 'read':
      return <CheckCheck size={15} className="text-sky-300" strokeWidth={2.6} />;
    case 'delivered':
      return <CheckCheck size={15} strokeWidth={2.4} />;
    case 'sent':
      return <Check size={15} strokeWidth={2.4} />;
    case 'failed':
      return <AlertCircle size={13} className="text-red-200" />;
    case 'queued':
      return <Clock3 size={12} />;
    default:
      return null;
  }
}

/** Nome "humano" do arquivo a partir da URL assinada (último segmento do caminho). */
function fileNameFromUrl(url: string): string {
  try {
    const path = new URL(url).pathname;
    const base = decodeURIComponent(path.split('/').pop() || '');
    // uploads de saída têm prefixo "<timestamp>_" — remove pra exibir
    return base.replace(/^\d{10,}_/, '') || 'arquivo';
  } catch {
    return 'arquivo';
  }
}

function MediaContent({ m }: { m: WaChatMessage }) {
  if (!m.media_type) return null;
  if (!m.media_url) {
    const label = MEDIA_LABEL[m.media_type] ?? m.media_type;
    return (
      <p className="italic opacity-70 text-xs">
        {m.status === 'queued' ? `Enviando ${label}…` : `[${label} indisponível]`}
      </p>
    );
  }
  switch (m.media_type) {
    case 'image':
      return (
        <a href={m.media_url} target="_blank" rel="noreferrer" className="block">
          {/* eslint-disable-next-line @next/next/no-img-element -- URL assinada dinâmica do Storage */}
          <img src={m.media_url} alt="Imagem recebida" className="rounded-lg max-h-64 max-w-full object-contain" />
        </a>
      );
    case 'sticker':
      return (
        // eslint-disable-next-line @next/next/no-img-element -- URL assinada dinâmica do Storage
        <img src={m.media_url} alt="Figurinha" className="h-28 w-28 object-contain" />
      );
    case 'video':
      return <video controls src={m.media_url} className="rounded-lg max-h-64 max-w-full" preload="metadata" />;
    case 'audio':
      return <audio controls src={m.media_url} className="max-w-[240px]" preload="metadata" />;
    case 'document':
      return (
        <a
          href={m.media_url}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 underline underline-offset-2 break-all"
        >
          <FileText size={16} className="shrink-0" />
          <span className="text-xs">{fileNameFromUrl(m.media_url)}</span>
        </a>
      );
    default:
      return <p className="italic opacity-70 text-xs">[{m.media_type}]</p>;
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
        <MediaContent m={m} />
        {m.body ? (
          <p className={`whitespace-pre-wrap break-words ${m.media_type ? 'mt-1.5' : ''}`}>{m.body}</p>
        ) : !m.media_type ? (
          <p className="italic opacity-70">[sem conteúdo]</p>
        ) : null}
        <div
          className={`mt-1 flex items-center justify-end gap-1 text-[10px] ${
            isOut ? 'text-emerald-100' : 'text-slate-400'
          }`}
        >
          <span>{time}</span>
          {isOut && (
            <span
              className="inline-flex items-center"
              title={
                m.status === 'read'
                  ? 'Lida'
                  : m.status === 'delivered'
                    ? 'Entregue'
                    : m.status === 'sent'
                      ? 'Enviada'
                      : m.status === 'failed'
                        ? 'Falhou'
                        : 'Enviando…'
              }
            >
              <StatusTicks status={m.status} />
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

/** Converte uma imagem em figurinha webp 512x512 (client-side, via canvas). */
async function toWebpSticker(file: File): Promise<Blob | null> {
  try {
    const bmp = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const scale = Math.min(512 / bmp.width, 512 / bmp.height);
    const w = bmp.width * scale;
    const h = bmp.height * scale;
    ctx.drawImage(bmp, (512 - w) / 2, (512 - h) / 2, w, h);
    return await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/webp', 0.9));
  } catch {
    return null;
  }
}

function kindFromFile(file: File): WaMediaKind {
  const t = file.type;
  if (t.startsWith('image/')) return 'image';
  if (t.startsWith('video/')) return 'video';
  if (t.startsWith('audio/')) return 'audio';
  return 'document';
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtSeconds(s: number): string {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

interface Attachment {
  file: File;
  kind: WaMediaKind;
  previewUrl: string | null;
  asSticker: boolean;
}

export function DealWhatsAppChat({
  contact,
}: {
  contact: { id: string; name?: string | null; phone?: string | null } | null;
}) {
  const phone = useMemo(() => normalizePhoneE164(contact?.phone || ''), [contact?.phone]);
  const { data, isLoading, error, send } = useWhatsAppChat(phone || null);
  const [text, setText] = useState('');
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  // escolha do menu de anexo: "documento" força enviar como documento
  // (mesmo sendo imagem/vídeo), igual ao WhatsApp
  const forcedKindRef = useRef<'document' | null>(null);
  const [recording, setRecording] = useState(false);
  const [recSeconds, setRecSeconds] = useState(0);
  const [micError, setMicError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const cancelRecRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  // guards SÍNCRONOS (state só atualiza no próximo render):
  const sendGateRef = useRef(false); // evita envio duplo durante awaits do onSend
  const recStartingRef = useRef(false); // evita 2º mic durante o prompt de permissão
  const disposedRef = useRef(false); // componente desmontado (getUserMedia pendente)
  const previewUrlRef = useRef<string | null>(null); // p/ revogar blob URL no unmount
  const forceScrollRef = useRef(false); // rola pro fim após envio próprio

  const messages = data?.messages ?? [];
  useEffect(() => {
    // só auto-rola se o usuário já está perto do fim (ou acabou de enviar) —
    // senão o polling arranca a rolagem de quem está lendo o histórico
    const el = listRef.current;
    const nearBottom = !el || el.scrollHeight - el.scrollTop - el.clientHeight < 300;
    if (nearBottom || forceScrollRef.current) {
      forceScrollRef.current = false;
      endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [messages.length]);

  // espelha o previewUrl atual num ref pra conseguir revogar no unmount
  useEffect(() => {
    previewUrlRef.current = attachment?.previewUrl ?? null;
  }, [attachment]);

  // fecha os popovers (emoji / menu do clipe) com clique fora ou Escape
  useEffect(() => {
    if (!emojiOpen && !attachMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (composerRef.current && !composerRef.current.contains(e.target as Node)) {
        setEmojiOpen(false);
        setAttachMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setEmojiOpen(false);
        setAttachMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [emojiOpen, attachMenuOpen]);

  // limpeza ao desmontar: para gravação/timer e libera o preview
  useEffect(() => {
    return () => {
      disposedRef.current = true;
      if (timerRef.current) window.clearInterval(timerRef.current);
      try {
        cancelRecRef.current = true;
        recorderRef.current?.stop();
      } catch {
        // já parado
      }
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, []);

  if (!contact) return <CenterMsg>Este lead não tem contato vinculado.</CenterMsg>;
  if (!phone)
    return <CenterMsg>O contato não tem telefone. Adicione um número pra conversar pelo WhatsApp.</CenterMsg>;

  const clearAttachment = () => {
    setAttachment(prev => {
      if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
      return null;
    });
  };

  const onPickFile = (f: File | null) => {
    if (!f) return;
    clearAttachment();
    const kind = forcedKindRef.current === 'document' ? 'document' : kindFromFile(f);
    forcedKindRef.current = null;
    setAttachment({
      file: f,
      kind,
      previewUrl: kind === 'image' ? URL.createObjectURL(f) : null,
      asSticker: false,
    });
  };

  /** Abre o seletor de arquivo já filtrado pela opção escolhida no menu do 📎. */
  const pickWithAccept = (accept: string, forceDocument: boolean) => {
    setAttachMenuOpen(false);
    forcedKindRef.current = forceDocument ? 'document' : null;
    const input = fileInputRef.current;
    if (!input) return;
    input.accept = accept;
    input.click();
  };

  const onSend = async () => {
    const t = text.trim();
    // sendGateRef fecha a janela dos awaits (isPending só vira true no render)
    if ((!t && !attachment) || send.isPending || recording || sendGateRef.current) return;
    sendGateRef.current = true;
    const releaseGate = () => {
      sendGateRef.current = false;
    };

    try {
      if (attachment) {
        let file: File | Blob = attachment.file;
        let kind: WaMediaKind = attachment.kind;
        let fileName = attachment.file.name || `arquivo_${Date.now()}`;
        if (attachment.asSticker && attachment.kind === 'image') {
          const webp = await toWebpSticker(attachment.file);
          if (webp) {
            file = webp;
            kind = 'sticker';
            fileName = fileName.replace(/\.[^.]+$/, '') + '.webp';
          }
        }
        const snapshot = attachment;
        setText('');
        clearAttachment();
        forceScrollRef.current = true;
        send.mutate(
          { text: t, file, kind, fileName },
          {
            onSettled: releaseGate,
            onError: () => {
              // restaura sem clobberar o que o usuário fez enquanto enviava,
              // e recria o preview (o blob URL antigo foi revogado no clear)
              setText(curr => curr || t);
              setAttachment(curr =>
                curr
                  ? curr
                  : {
                      ...snapshot,
                      previewUrl:
                        snapshot.kind === 'image' ? URL.createObjectURL(snapshot.file) : null,
                    }
              );
            },
          }
        );
      } else {
        setText('');
        forceScrollRef.current = true;
        send.mutate(t, {
          onSettled: releaseGate,
          onError: () => setText(curr => curr || t),
        });
      }
    } catch {
      releaseGate();
    }
    setEmojiOpen(false);
    setAttachMenuOpen(false);
  };

  const startRecording = async () => {
    // reentrância: um 2º clique no mic durante o prompt de permissão criaria
    // outro stream/recorder e o 1º ficaria gravando pra sempre
    if (recStartingRef.current || recording) return;
    recStartingRef.current = true;
    setMicError(null);
    setEmojiOpen(false);
    setAttachMenuOpen(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // usuário fechou o card enquanto o prompt estava aberto: solta o mic
      if (disposedRef.current) {
        stream.getTracks().forEach(tr => tr.stop());
        return;
      }
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/mp4')
          ? 'audio/mp4'
          : '';
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      cancelRecRef.current = false;
      rec.ondataavailable = e => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        stream.getTracks().forEach(tr => tr.stop());
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' });
        if (!cancelRecRef.current && blob.size > 0) {
          const ext = (rec.mimeType || '').includes('mp4') ? 'm4a' : 'webm';
          const fileName = `voz_${Date.now()}.${ext}`;
          forceScrollRef.current = true;
          send.mutate(
            { file: blob, kind: 'audio', fileName },
            {
              onError: () => {
                // não perde a gravação: vira anexo pro usuário reenviar
                setAttachment(curr =>
                  curr
                    ? curr
                    : {
                        file: new File([blob], fileName, { type: blob.type }),
                        kind: 'audio',
                        previewUrl: null,
                        asSticker: false,
                      }
                );
              },
            }
          );
        }
      };
      recorderRef.current = rec;
      rec.start();
      setRecording(true);
      setRecSeconds(0);
      timerRef.current = window.setInterval(() => setRecSeconds(s => s + 1), 1000);
    } catch {
      setMicError('Não foi possível acessar o microfone. Verifique a permissão do navegador.');
    } finally {
      recStartingRef.current = false;
    }
  };

  const stopRecording = (cancel: boolean) => {
    cancelRecRef.current = cancel;
    try {
      recorderRef.current?.stop();
    } catch {
      // já parado
    }
    setRecording(false);
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
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
      <div
        ref={listRef}
        className="flex-1 min-h-0 overflow-y-auto scrollbar-custom px-4 py-3 space-y-2 bg-slate-50/40 dark:bg-black/10"
      >
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
      <div
        ref={composerRef}
        className="shrink-0 border-t border-slate-200 dark:border-white/10 p-3 bg-white dark:bg-dark-card relative"
      >
        {send.isError && (
          <p className="mb-1.5 text-xs text-red-500">{(send.error as Error).message}</p>
        )}
        {micError && <p className="mb-1.5 text-xs text-red-500">{micError}</p>}

        {/* Chip do anexo selecionado */}
        {attachment && (
          <div className="mb-2 flex items-center gap-3 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/20 px-3 py-2">
            {attachment.previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- preview local (blob URL)
              <img src={attachment.previewUrl} alt="Pré-visualização" className="h-12 w-12 rounded-lg object-cover" />
            ) : (
              <FileText size={20} className="text-slate-400 shrink-0" />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-slate-800 dark:text-slate-100 truncate">
                {attachment.file.name || 'arquivo'}
              </p>
              <p className="text-[11px] text-slate-400">
                {MEDIA_LABEL[attachment.kind]} · {fmtBytes(attachment.file.size)}
              </p>
              {attachment.kind === 'image' && (
                <label className="mt-0.5 inline-flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={attachment.asSticker}
                    onChange={e =>
                      setAttachment(a => (a ? { ...a, asSticker: e.target.checked } : a))
                    }
                    className="accent-emerald-600"
                  />
                  Enviar como figurinha
                </label>
              )}
            </div>
            <button
              type="button"
              onClick={clearAttachment}
              className="shrink-0 text-slate-400 hover:text-red-500 transition-colors"
              aria-label="Remover anexo"
            >
              <X size={16} />
            </button>
          </div>
        )}

        {/* Menu do anexo (📎): foto, vídeo ou documento */}
        {attachMenuOpen && (
          <div className="absolute bottom-full left-12 mb-1 z-10 w-44 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-dark-card p-1.5 shadow-lg">
            <button
              type="button"
              onClick={() => pickWithAccept('image/*', false)}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10"
            >
              <ImageIcon size={17} className="text-violet-500" /> Foto
            </button>
            <button
              type="button"
              onClick={() => pickWithAccept('video/*', false)}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10"
            >
              <VideoIcon size={17} className="text-rose-500" /> Vídeo
            </button>
            <button
              type="button"
              onClick={() => pickWithAccept('*/*', true)}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10"
            >
              <FileText size={17} className="text-sky-500" /> Documento
            </button>
          </div>
        )}

        {/* Popover de emojis */}
        {emojiOpen && (
          <div className="absolute bottom-full left-3 mb-1 z-10 grid grid-cols-8 gap-1 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-dark-card p-2 shadow-lg">
            {EMOJIS.map(e => (
              <button
                key={e}
                type="button"
                onClick={() => setText(t => t + e)}
                className="h-8 w-8 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10 text-lg leading-none"
              >
                {e}
              </button>
            ))}
          </div>
        )}

        {recording ? (
          /* Modo gravação de voz */
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-2 text-sm text-red-500 font-semibold">
              <span className="h-2.5 w-2.5 rounded-full bg-red-500 animate-pulse" />
              Gravando… {fmtSeconds(recSeconds)}
            </span>
            <div className="flex-1" />
            <button
              type="button"
              onClick={() => stopRecording(true)}
              className="h-10 px-3 inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-white/10 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10"
            >
              <X size={16} /> Cancelar
            </button>
            <button
              type="button"
              onClick={() => stopRecording(false)}
              className="h-10 px-4 inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold"
            >
              <Send size={16} /> Enviar áudio
            </button>
          </div>
        ) : (
          <div className="flex items-end gap-1.5">
            <button
              type="button"
              onClick={() => {
                setEmojiOpen(o => !o);
                setAttachMenuOpen(false);
              }}
              className={`shrink-0 h-10 w-10 inline-flex items-center justify-center rounded-xl transition-colors ${
                emojiOpen
                  ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600'
                  : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10'
              }`}
              aria-label="Emojis"
              title="Emojis"
            >
              <Smile size={19} />
            </button>
            <button
              type="button"
              onClick={() => {
                setAttachMenuOpen(o => !o);
                setEmojiOpen(false);
              }}
              className={`shrink-0 h-10 w-10 inline-flex items-center justify-center rounded-xl transition-colors ${
                attachMenuOpen
                  ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600'
                  : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10'
              }`}
              aria-label="Anexar arquivo"
              title="Anexar foto, vídeo ou documento"
            >
              <Paperclip size={18} />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={e => {
                onPickFile(e.target.files?.[0] ?? null);
                e.target.value = '';
              }}
            />
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
              placeholder={attachment ? 'Legenda (opcional)...' : 'Escreva uma mensagem...'}
              className="flex-1 resize-none max-h-32 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-xl px-3 py-2.5 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-emerald-500"
            />
            {!text.trim() && !attachment ? (
              <button
                type="button"
                onClick={startRecording}
                disabled={send.isPending}
                className="shrink-0 h-10 w-10 inline-flex items-center justify-center rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white transition-colors"
                aria-label="Gravar áudio"
                title="Gravar mensagem de voz"
              >
                <Mic size={18} />
              </button>
            ) : (
              <button
                type="button"
                onClick={onSend}
                disabled={send.isPending}
                className="shrink-0 h-10 w-10 inline-flex items-center justify-center rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white transition-colors"
                aria-label="Enviar mensagem"
                title="Enviar (Enter)"
              >
                {send.isPending ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
