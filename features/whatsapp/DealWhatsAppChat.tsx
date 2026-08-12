'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery } from '@tanstack/react-query';
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
  Search,
  ChevronUp,
  ChevronDown,
  ClipboardList,
  Unplug,
  Pause,
  Trash2,
  Info,
  Play,
} from 'lucide-react';
import { normalizePhoneE164 } from '@/lib/phone';
import { fillTemplate } from '@/lib/messageTemplates';
import { useWhatsAppChat, type WaChatMessage, type WaMediaKind, type WaSender } from './useWhatsAppChat';
import { transcodeToMp3 } from './audioTranscode';

const TIME_FMT = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });

const MEDIA_LABEL: Record<string, string> = {
  image: 'imagem',
  video: 'vídeo',
  audio: 'áudio',
  document: 'documento',
  sticker: 'figurinha',
  contact: 'contato',
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

const URL_RE = /(https?:\/\/[^\s]+)/g;

/** Normaliza pra busca: minúsculas e sem acentos (acha "João" com "joao"). */
function normText(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * Ocorrências da busca no texto ORIGINAL (índices), com casamento
 * insensível a caixa/acentos — mapeia os índices normalizados de volta.
 */
function findTextMatches(text: string, query: string): Array<[number, number]> {
  const nq = normText(query);
  if (!nq) return [];
  let acc = '';
  const map: number[] = []; // índice normalizado -> índice original
  for (let i = 0; i < text.length; i++) {
    const n = normText(text[i]);
    for (let j = 0; j < n.length; j++) map.push(i);
    acc += n;
  }
  const out: Array<[number, number]> = [];
  let pos = acc.indexOf(nq);
  while (pos !== -1 && map[pos] !== undefined) {
    out.push([map[pos], (map[pos + nq.length - 1] ?? map[pos]) + 1]);
    pos = acc.indexOf(nq, pos + nq.length);
  }
  return out;
}

/** Texto com as ocorrências da busca destacadas. */
function HighlightedText({ text, query, className }: { text: string; query: string; className?: string }) {
  const ranges = findTextMatches(text, query);
  if (ranges.length === 0) return <p className={className}>{text}</p>;
  const nodes: React.ReactNode[] = [];
  let last = 0;
  ranges.forEach(([s, e], i) => {
    if (s > last) nodes.push(text.slice(last, s));
    nodes.push(
      <mark key={i} className="bg-amber-300/80 text-slate-900 rounded px-0.5">
        {text.slice(s, e)}
      </mark>
    );
    last = e;
  });
  if (last < text.length) nodes.push(text.slice(last));
  return <p className={className}>{nodes}</p>;
}

/** Texto da bolha com URLs clicáveis (ex.: link do Maps em localizações). */
function LinkifiedText({ text, className }: { text: string; className?: string }) {
  const parts = text.split(URL_RE);
  return (
    <p className={className}>
      {parts.map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2 break-all"
          >
            {part}
          </a>
        ) : (
          part
        )
      )}
    </p>
  );
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

/** Balão de áudio custom (estilo dos CRMs de chat): play/pausa redondo,
 *  barra de progresso arrastável, tempos e botão "T" que transcreve o áudio
 *  com a IA da organização (resultado cacheado no banco, transcreve 1x). */
function AudioBubble({ m }: { m: WaChatMessage }) {
  const isOut = m.direction === 'out';
  const audioRef = useRef<HTMLAudioElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState<number | null>(null);
  const [showText, setShowText] = useState(true);

  const transcribeMut = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/whatsapp/transcribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ messageId: m.id }),
      });
      const json = (await res.json().catch(() => ({}))) as { transcription?: string; error?: string };
      if (!res.ok || !json.transcription) throw new Error(json.error || 'Falha ao transcrever');
      return json.transcription;
    },
    onSuccess: () => setShowText(true),
  });

  // transcrição persistida (polling hidrata) ou recém-gerada nesta sessão
  const text = m.transcription || transcribeMut.data || null;

  // MediaRecorder às vezes entrega duration=Infinity até tocar inteiro —
  // só habilita a barra quando o número é real
  const syncDuration = () => {
    const el = audioRef.current;
    if (el && isFinite(el.duration) && el.duration > 0) setDuration(el.duration);
  };

  const seekFromPointer = (clientX: number) => {
    const el = audioRef.current;
    const track = trackRef.current;
    if (!el || !track || !duration) return;
    const rect = track.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    el.currentTime = ratio * duration;
    setCurrent(ratio * duration);
  };

  const toggle = () => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) void el.play();
    else el.pause();
  };

  const pct = duration ? Math.min(100, (current / duration) * 100) : 0;
  const btn = isOut
    ? 'bg-white/25 hover:bg-white/35 text-white'
    : 'bg-slate-200 hover:bg-slate-300 text-slate-700 dark:bg-white/10 dark:hover:bg-white/20 dark:text-white';

  return (
    <div className="w-64 max-w-full">
      <audio
        ref={audioRef}
        src={m.media_url ?? undefined}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEmptied={() => setPlaying(false)} // src renovado (URL assinada) aborta sem 'pause'
        onEnded={() => {
          const el = audioRef.current;
          if (el) el.currentTime = 0; // volta pro início, como no WhatsApp
          setCurrent(0);
        }}
        onTimeUpdate={e => {
          if (!draggingRef.current) setCurrent((e.target as HTMLAudioElement).currentTime);
        }}
        onLoadedMetadata={syncDuration}
        onDurationChange={syncDuration}
      />
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={toggle}
          className={`shrink-0 h-9 w-9 rounded-full inline-flex items-center justify-center transition-colors ${btn}`}
          aria-label={playing ? 'Pausar' : 'Ouvir áudio'}
        >
          {playing ? <Pause size={16} /> : <Play size={16} className="ml-0.5" />}
        </button>
        <div
          ref={trackRef}
          role="slider"
          tabIndex={0}
          aria-label="Posição do áudio"
          aria-valuemin={0}
          aria-valuemax={Math.floor(duration ?? 0)}
          aria-valuenow={Math.floor(current)}
          className="relative flex-1 h-5 cursor-pointer touch-none rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-400"
          onPointerDown={e => {
            draggingRef.current = true;
            e.currentTarget.setPointerCapture?.(e.pointerId);
            seekFromPointer(e.clientX);
          }}
          onPointerMove={e => {
            if (draggingRef.current) seekFromPointer(e.clientX);
          }}
          onPointerUp={() => {
            draggingRef.current = false;
          }}
          onPointerCancel={() => {
            draggingRef.current = false;
          }}
          onKeyDown={e => {
            const el = audioRef.current;
            if (!el || !duration) return;
            if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
              e.preventDefault();
              const next =
                e.key === 'ArrowRight'
                  ? Math.min(duration, el.currentTime + 5)
                  : Math.max(0, el.currentTime - 5);
              el.currentTime = next;
              setCurrent(next);
            }
          }}
        >
          <div
            className={`absolute top-1/2 -translate-y-1/2 left-0 right-0 h-1 rounded-full ${
              isOut ? 'bg-white/30' : 'bg-slate-300 dark:bg-white/20'
            }`}
          />
          <div
            className={`absolute top-1/2 -translate-y-1/2 left-0 h-1 rounded-full ${
              isOut ? 'bg-white' : 'bg-emerald-500'
            }`}
            style={{ width: `${pct}%` }}
          />
          <div
            className={`absolute top-1/2 -translate-y-1/2 h-3 w-3 rounded-full shadow ${
              isOut ? 'bg-white' : 'bg-emerald-500'
            }`}
            style={{ left: `calc(${pct}% - 6px)` }}
          />
        </div>
        <button
          type="button"
          onClick={() => {
            if (text) setShowText(s => !s);
            else if (!transcribeMut.isPending) transcribeMut.mutate();
          }}
          disabled={transcribeMut.isPending}
          className={`shrink-0 h-8 w-8 rounded-full inline-flex items-center justify-center text-[13px] font-bold transition-colors disabled:opacity-60 ${btn}`}
          aria-label="Transcrever áudio"
          title={text ? 'Mostrar/ocultar transcrição' : 'Transcrever áudio'}
        >
          {transcribeMut.isPending ? <Loader2 size={14} className="animate-spin" /> : 'T'}
        </button>
      </div>
      <div
        className={`mt-0.5 flex items-center justify-between pl-[46px] pr-[42px] text-[10px] tabular-nums ${
          isOut ? 'text-emerald-100' : 'text-slate-400'
        }`}
      >
        <span>{fmtSeconds(Math.floor(current))}</span>
        <span>{duration ? fmtSeconds(Math.floor(duration)) : '--:--'}</span>
      </div>
      {transcribeMut.isError && (
        <p className={`mt-1 text-[11px] ${isOut ? 'text-red-200' : 'text-red-500'}`}>
          {(transcribeMut.error as Error).message}
        </p>
      )}
      {text && showText && <p className="mt-1.5 whitespace-pre-wrap break-words text-sm">{text}</p>}
    </div>
  );
}

function MediaContent({ m }: { m: WaChatMessage }) {
  if (!m.media_type) return null;

  // Cartão de contato compartilhado (estilo WhatsApp): avatar + nome + telefone
  if (m.media_type === 'contact') {
    const [name, ...rest] = (m.body ?? 'Contato').split('\n');
    const phone = rest.join(' ').trim();
    const digits = phone.replace(/\D/g, '');
    return (
      <div className="min-w-[220px]">
        <div className="flex items-center gap-3 p-1">
          {m.media_url ? (
            // eslint-disable-next-line @next/next/no-img-element -- avatar assinado do Storage
            <img src={m.media_url} alt="" className="h-11 w-11 rounded-full object-cover shrink-0" />
          ) : (
            <span className="h-11 w-11 rounded-full bg-slate-500/25 flex items-center justify-center text-base font-bold shrink-0">
              {(name || '?').charAt(0).toUpperCase()}
            </span>
          )}
          <div className="min-w-0">
            <p className="text-sm font-bold truncate">{name || 'Contato'}</p>
            {phone && <p className="text-xs opacity-80">{phone}</p>}
          </div>
        </div>
        {digits && (
          <a
            href={`https://wa.me/${digits}`}
            target="_blank"
            rel="noreferrer"
            className="mt-1.5 block text-center text-xs font-bold border-t border-slate-400/40 pt-1.5 hover:underline"
          >
            Conversar
          </a>
        )}
      </div>
    );
  }

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
      // Caixa de ALTURA FIXA: o <video> sem metadata nasce 300x150 (paisagem)
      // e "pulava" pro formato real ao carregar, mexendo o layout inteiro.
      // Com a altura travada, vídeo vertical ocupa o mesmo alto desde o
      // primeiro frame e só a largura acomoda (uma vez, dentro da bolha).
      return (
        <div className="h-64 w-fit max-w-full rounded-lg overflow-hidden bg-slate-950/70 flex items-center justify-center">
          <video controls src={m.media_url} className="h-full max-w-full object-contain" preload="metadata" />
        </div>
      );
    case 'audio':
      return <AudioBubble m={m} />;
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

/** Selo "Erro" da mensagem que falhou: pill vermelha + cartão com o motivo
 *  (hover no desktop, toque no celular), no estilo dos CRMs de chat. */
function FailBadge({ reason }: { reason: string }) {
  const [open, setOpen] = useState(false);
  // cartão abre pra CIMA por padrão; perto do topo da lista (1ª mensagem
  // falhada) o overflow do scroll cortaria — aí abre pra BAIXO
  const [below, setBelow] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);

  // fecha com toque/clique fora e Escape (hover só existe no desktop)
  useEffect(() => {
    if (!open) return;
    const onDown = (e: Event) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // sempre ABRE (nunca alterna): no toque, o mouseenter sintético + click
  // chegam juntos e um toggle abriria e fecharia na mesma batida
  const show = () => {
    const el = rootRef.current;
    const scroller = el?.closest('.overflow-y-auto');
    if (el && scroller) {
      const room = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
      setBelow(room < 200);
    }
    setOpen(true);
  };

  return (
    <span
      ref={rootRef}
      className="relative inline-flex"
      onMouseEnter={show}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        onClick={show}
        aria-expanded={open}
        className="inline-flex items-center gap-1 rounded-full bg-red-500 px-1.5 py-px text-[10px] font-bold uppercase tracking-wide text-white shadow-sm"
        aria-label="Ver motivo da falha"
      >
        <Info size={10} strokeWidth={2.5} /> Erro
      </button>
      {open && (
        <span
          className={`absolute right-0 z-20 w-72 max-w-[70vw] whitespace-normal rounded-xl border border-red-400 bg-white p-3 text-left text-xs font-normal normal-case tracking-normal leading-relaxed text-slate-700 shadow-xl dark:border-red-500/70 dark:bg-slate-900 dark:text-slate-200 ${
            below ? 'top-full mt-2' : 'bottom-full mb-2'
          }`}
        >
          <span className="block font-semibold text-red-600 dark:text-red-400">
            Não conseguimos enviar sua mensagem.
          </span>
          <span className="mt-1 block">{reason}</span>
        </span>
      )}
    </span>
  );
}

function MessageBubble({
  m,
  searchQuery = '',
  isCurrentMatch = false,
}: {
  m: WaChatMessage;
  searchQuery?: string;
  isCurrentMatch?: boolean;
}) {
  const isOut = m.direction === 'out';
  const failed = m.status === 'failed';
  // Motivo real devolvido pela Meta/Evolution (truncado), ou um texto
  // genérico quando o provedor não explicou — vai no cartão do selo "Erro"
  const failReason = failed
    ? (m.error || '').trim()
      ? (m.error as string).trim().slice(0, 300)
      : 'O provedor não informou o motivo. Verifique a conexão e tente de novo.'
    : null;
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
        } ${failed ? 'ring-1 ring-red-400/80' : ''} ${isCurrentMatch ? 'ring-2 ring-amber-400' : ''}`}
      >
        <MediaContent m={m} />
        {m.body && m.media_type !== 'contact' ? (
          searchQuery ? (
            <HighlightedText
              text={m.body}
              query={searchQuery}
              className={`whitespace-pre-wrap break-words ${m.media_type ? 'mt-1.5' : ''}`}
            />
          ) : (
            <LinkifiedText
              text={m.body}
              className={`whitespace-pre-wrap break-words ${m.media_type ? 'mt-1.5' : ''}`}
            />
          )
        ) : !m.media_type ? (
          <p className="italic opacity-70">[mensagem não suportada]</p>
        ) : null}
        <div
          className={`mt-1 flex items-center justify-end gap-1.5 text-[10px] ${
            isOut ? 'text-emerald-100' : 'text-slate-400'
          }`}
        >
          {failReason && <FailBadge reason={failReason} />}
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
  templateContext,
}: {
  contact: { id: string; name?: string | null; phone?: string | null } | null;
  /** Valores extras pras variáveis dos modelos (lead.titulo, escritorio.nome...) */
  templateContext?: Record<string, string>;
}) {
  const phone = useMemo(() => normalizePhoneE164(contact?.phone || ''), [contact?.phone]);
  const { data, isLoading, error, send } = useWhatsAppChat(phone || null);
  const [text, setText] = useState('');
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  // Modelos de mensagem GERAIS (aba Modelos): prontos pra inserir no composer
  // com as variáveis já preenchidas com os dados reais do lead/contato
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const templatesQ = useQuery<{ data: { id: string; name: string; type: string; body: string }[] }>({
    queryKey: ['messageTemplates'],
    queryFn: async () => {
      const res = await fetch('/api/message-templates', { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    enabled: templatesOpen,
    staleTime: 60000,
  });
  const generalTemplates = (templatesQ.data?.data ?? []).filter(t => t.type === 'general');
  const applyTemplate = (body: string) => {
    const filled = fillTemplate(body, {
      'contato.nome': contact?.name || '',
      'contato.telefone': contact?.phone || '',
      ...templateContext,
    });
    setText(t => (t.trim() ? `${t}\n${filled}` : filled));
    setTemplatesOpen(false);
  };
  // escolha do menu de anexo: "documento" força enviar como documento
  // (mesmo sendo imagem/vídeo), igual ao WhatsApp
  const forcedKindRef = useRef<'document' | null>(null);
  const [recording, setRecording] = useState(false);
  const [recSeconds, setRecSeconds] = useState(0);
  const [micError, setMicError] = useState<string | null>(null);
  // Gravação PAUSADA virando prévia: o usuário ouve antes de enviar/descartar
  const [voiceNote, setVoiceNote] = useState<{
    blob: Blob;
    mime: string;
    url: string;
    seconds: number;
  } | null>(null);
  // conversão MP3 em andamento entre o "Enviar áudio" e o send.mutate: trava
  // o Mic (que aparece no MESMO lugar do botão) contra duplo clique
  const [preparingVoice, setPreparingVoice] = useState(false);
  // MULTI-NÚMERO: qual conexão ENVIA as mensagens deste usuário. Persistido
  // no navegador; validado contra os números conectados a cada render.
  const [senderId, setSenderId] = useState<string | null>(() =>
    typeof window !== 'undefined' ? window.localStorage.getItem('wa-sender-connection') : null
  );
  const [senderMenuOpen, setSenderMenuOpen] = useState(false);
  const senderMenuRef = useRef<HTMLDivElement>(null);
  // Pesquisa de mensagens (estilo WhatsApp): barra + navegação entre matches
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [matchIndex, setMatchIndex] = useState(-1); // -1 = match mais recente
  const msgRefs = useRef(new Map<string, HTMLDivElement>());
  const endRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  // Flags POR SESSÃO de gravação (objeto novo a cada startRecording): o
  // onstop de um recorder antigo nunca lê flags/chunks da sessão seguinte
  const recSessionRef = useRef<{ cancel: boolean; pause: boolean } | null>(null);
  const recSecondsRef = useRef(0); // espelho síncrono do timer (o onstop lê fora do render)
  const voiceNoteUrlRef = useRef<string | null>(null); // p/ revogar blob URL da prévia no unmount
  const providerRef = useRef<string | null>(null); // provider ATUAL (o onstop roda fora do render)
  const timerRef = useRef<number | null>(null);
  // guards SÍNCRONOS (state só atualiza no próximo render):
  const sendGateRef = useRef(false); // evita envio duplo durante awaits do onSend
  const recStartingRef = useRef(false); // evita 2º mic durante o prompt de permissão
  const disposedRef = useRef(false); // componente desmontado (getUserMedia pendente)
  const previewUrlRef = useRef<string | null>(null); // p/ revogar blob URL no unmount
  const forceScrollRef = useRef(false); // rola pro fim após envio próprio

  const messages = data?.messages ?? [];
  // Números conectados + o remetente ATIVO (escolhido ou o padrão). O ref
  // espelha pro onstop do gravador (roda fora do render) enviar pelo certo.
  const senders = data?.senders ?? [];
  const activeSender = senders.find(s => s.id === senderId) ?? senders[0] ?? null;
  const senderRef = useRef<WaSender | null>(null);
  useEffect(() => {
    senderRef.current = activeSender;
  }, [activeSender]);
  // Sem conexão ativa (nunca conectou OU desconectou): troca o composer pelo
  // aviso de conectar, em vez de deixar o envio falhar com erro técnico
  const notConnected = !!data && (!data.hasConnection || !data.connected);
  // primeira carga da conversa: abre DIRETO na mensagem mais recente (embaixo)
  const initialScrollDoneRef = useRef(false);
  useEffect(() => {
    initialScrollDoneRef.current = false;
  }, [phone]);
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (!initialScrollDoneRef.current) {
      if (messages.length > 0) {
        el.scrollTop = el.scrollHeight; // instantâneo, sem animação
        // mídias carregam depois e aumentam a altura — reancora no fim
        window.setTimeout(() => {
          el.scrollTop = el.scrollHeight;
        }, 250);
        initialScrollDoneRef.current = true;
      }
      return;
    }
    // depois: só auto-rola se o usuário já está perto do fim (ou acabou de
    // enviar) — senão o polling arranca a rolagem de quem lê o histórico
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 300;
    if (nearBottom || forceScrollRef.current) {
      forceScrollRef.current = false;
      endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [messages.length, phone]);

  // espelha o previewUrl atual num ref pra conseguir revogar no unmount
  useEffect(() => {
    previewUrlRef.current = attachment?.previewUrl ?? null;
  }, [attachment]);
  useEffect(() => {
    voiceNoteUrlRef.current = voiceNote?.url ?? null;
  }, [voiceNote]);
  useEffect(() => {
    // provider do número que VAI enviar (guarda do áudio cru por formato)
    providerRef.current = activeSender?.provider ?? data?.provider ?? null;
  }, [activeSender?.provider, data?.provider]);

  // menu do número: fecha com clique/toque fora e Escape
  useEffect(() => {
    if (!senderMenuOpen) return;
    const onDown = (e: Event) => {
      if (senderMenuRef.current && !senderMenuRef.current.contains(e.target as Node)) {
        setSenderMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSenderMenuOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [senderMenuOpen]);

  // Trocou de contato/telefone SEM remontar (host sem key, ex.: modal do
  // lead): gravação e prévia pertencem à conversa ANTERIOR — descarta pra
  // nunca enviar o áudio de um contato pro número de outro
  useEffect(() => {
    const rec = recorderRef.current;
    if (rec && rec.state !== 'inactive') {
      const session = recSessionRef.current;
      if (session) {
        session.cancel = true;
        session.pause = false;
      }
      try {
        rec.stop();
      } catch {
        // já parado
      }
      setRecording(false);
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
    setVoiceNote(v => {
      if (v) URL.revokeObjectURL(v.url);
      return null;
    });
  }, [phone]);

  // ==== Pesquisa de mensagens ====
  const activeQuery = searchOpen ? searchQuery.trim() : '';
  const searchMatches = useMemo(() => {
    if (!activeQuery) return [] as string[];
    const nq = normText(activeQuery);
    return messages.filter(m => m.body && normText(m.body).includes(nq)).map(m => m.id);
  }, [messages, activeQuery]);

  // mudou a busca: volta pro match mais recente (comportamento do WhatsApp)
  useEffect(() => {
    setMatchIndex(-1);
  }, [searchQuery, searchOpen]);

  const effMatchIndex =
    searchMatches.length === 0
      ? -1
      : matchIndex === -1
        ? searchMatches.length - 1
        : Math.min(matchIndex, searchMatches.length - 1);
  const currentMatchId = effMatchIndex >= 0 ? searchMatches[effMatchIndex] : null;

  // rola até o match atual
  useEffect(() => {
    if (!currentMatchId) return;
    msgRefs.current.get(currentMatchId)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [currentMatchId]);

  const gotoMatch = (dir: 1 | -1) => {
    const len = searchMatches.length;
    if (len === 0) return;
    const base = effMatchIndex === -1 ? len - 1 : effMatchIndex;
    setMatchIndex((base + dir + len) % len);
  };

  const closeSearch = () => {
    setSearchOpen(false);
    setSearchQuery('');
    setMatchIndex(-1);
  };

  // fecha os popovers (emoji / clipe / modelos) com clique fora ou Escape
  useEffect(() => {
    if (!emojiOpen && !attachMenuOpen && !templatesOpen) return;
    const onDown = (e: MouseEvent) => {
      if (composerRef.current && !composerRef.current.contains(e.target as Node)) {
        setEmojiOpen(false);
        setAttachMenuOpen(false);
        setTemplatesOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setEmojiOpen(false);
        setAttachMenuOpen(false);
        setTemplatesOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [emojiOpen, attachMenuOpen, templatesOpen]);

  // limpeza ao desmontar: para gravação/timer e libera o preview
  useEffect(() => {
    return () => {
      disposedRef.current = true;
      if (timerRef.current) window.clearInterval(timerRef.current);
      try {
        if (recSessionRef.current) recSessionRef.current.cancel = true;
        recorderRef.current?.stop();
      } catch {
        // já parado
      }
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      if (voiceNoteUrlRef.current) URL.revokeObjectURL(voiceNoteUrlRef.current);
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
          { text: t, file, kind, fileName, connectionId: senderRef.current?.id },
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
        send.mutate(
          { text: t, connectionId: senderRef.current?.id },
          {
            onSettled: releaseGate,
            onError: () => setText(curr => curr || t),
          }
        );
      }
    } catch {
      releaseGate();
    }
    setEmojiOpen(false);
    setAttachMenuOpen(false);
  };

  /** Prepara (conversão pra MP3) e envia uma gravação de voz — usado tanto
   *  pelo "Enviar áudio" direto quanto pela prévia pausada. */
  const sendVoiceBlob = async (recorded: Blob, recMime: string) => {
    setPreparingVoice(true);
    try {
      let blob = recorded;
      const lower = (recMime || '').toLowerCase();
      let ext = lower.includes('mp4') ? 'm4a' : lower.includes('ogg') ? 'ogg' : 'webm';
      // Só o ogg/opus (Firefox) vai como gravado — todo o resto vira MP3.
      // Motivo: o navegador DECLARA um formato e entrega outro por dentro
      // (Chrome gravou "mp4 AAC" com opus dentro; a Meta processa e recusa
      // como octet-stream). MP3 gerado por nós é garantido em qualquer
      // provedor. isMetaFriendlyAudio fica pra anexos de arquivo.
      if (!lower.includes('ogg')) {
        try {
          blob = await transcodeToMp3(blob);
          ext = 'mp3';
        } catch {
          // Conversão falhou (decodificação/wasm indisponível neste
          // navegador). Só manda o formato CRU quando temos CERTEZA que a
          // conexão é Evolution (lá funciona); na Meta — ou com o provider
          // ainda não carregado — seria RECUSADO na certa: guarda a
          // gravação como anexo e avisa.
          const prov = providerRef.current;
          if (prov !== 'evolution' && prov !== 'evolution_business') {
            const fileName = `voz_${Date.now()}.${ext}`;
            setAttachment(curr =>
              curr
                ? curr
                : {
                    file: new File([recorded], fileName, { type: recorded.type }),
                    kind: 'audio',
                    previewUrl: null,
                    asSticker: false,
                  }
            );
            setMicError(
              'Não deu pra preparar o áudio neste navegador. Atualize a página (Ctrl+Shift+R) e tente de novo.'
            );
            return;
          }
        }
      }
      const fileName = `voz_${Date.now()}.${ext}`;
      forceScrollRef.current = true;
      send.mutate(
        { file: blob, kind: 'audio', fileName, connectionId: senderRef.current?.id },
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
    } finally {
      setPreparingVoice(false);
    }
  };

  const startRecording = async () => {
    // reentrância: um 2º clique no mic durante o prompt de permissão criaria
    // outro stream/recorder e o 1º ficaria gravando pra sempre
    if (recStartingRef.current || recording || preparingVoice) return;
    recStartingRef.current = true;
    setMicError(null);
    setEmojiOpen(false);
    setAttachMenuOpen(false);
    setTemplatesOpen(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // usuário fechou o card enquanto o prompt estava aberto: solta o mic
      if (disposedRef.current) {
        stream.getTracks().forEach(tr => tr.stop());
        return;
      }
      // Ordem importa: a Cloud API da Meta SÓ aceita ogg/opus, mp4/AAC, mpeg
      // e amr. Firefox grava ogg/opus (aceito, vira mensagem de VOZ); Safari
      // grava mp4/AAC (aceito). O Chrome/Edge grava opus em webm OU em mp4 —
      // os DOIS são recusados no processamento da Meta (131053) — então a
      // gravação dele é CONVERTIDA pra MP3 no navegador antes do envio.
      const mime = ['audio/ogg;codecs=opus', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm;codecs=opus'].find(
        t => MediaRecorder.isTypeSupported(t)
      ) ?? '';
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      // sessão NOVA por gravação: chunks e flags são DESTE recorder — o
      // onstop de um recorder antigo não corrompe a gravação seguinte
      const session = { cancel: false, pause: false };
      recSessionRef.current = session;
      const chunks: Blob[] = [];
      rec.ondataavailable = e => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      rec.onstop = async () => {
        stream.getTracks().forEach(tr => tr.stop());
        if (session.cancel) return;
        const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
        if (session.pause) {
          // "Pausar": não envia — vira PRÉVIA pro usuário ouvir e decidir.
          // O recorder é PARADO de verdade (não pause()): só o arquivo
          // finalizado toca de forma confiável em todo container (mp4/webm).
          if (disposedRef.current) return;
          setRecording(false); // o painel "Gravando" segurou até a prévia ficar pronta
          if (blob.size === 0) {
            setMicError('Gravação muito curta. Tente de novo.');
            return;
          }
          const url = URL.createObjectURL(blob);
          voiceNoteUrlRef.current = url; // síncrono: unmount antes do commit ainda revoga
          setVoiceNote(v => {
            if (v) URL.revokeObjectURL(v.url);
            return {
              blob,
              mime: rec.mimeType || 'audio/webm',
              url,
              seconds: Math.max(1, recSecondsRef.current),
            };
          });
          return;
        }
        if (blob.size === 0) {
          setPreparingVoice(false);
          return;
        }
        await sendVoiceBlob(blob, rec.mimeType || 'audio/webm');
      };
      recorderRef.current = rec;
      rec.start();
      setRecording(true);
      setRecSeconds(0);
      recSecondsRef.current = 0;
      timerRef.current = window.setInterval(() => {
        recSecondsRef.current += 1;
        setRecSeconds(recSecondsRef.current);
      }, 1000);
    } catch {
      setMicError('Não foi possível acessar o microfone. Verifique a permissão do navegador.');
    } finally {
      recStartingRef.current = false;
    }
  };

  const stopRecording = (mode: 'cancel' | 'send' | 'pause') => {
    const session = recSessionRef.current;
    if (mode === 'pause' && session?.pause) return; // 2º clique no Pausar: já finalizando
    if (session) {
      session.cancel = mode === 'cancel';
      session.pause = mode === 'pause';
    }
    let willStop = false;
    try {
      const rec = recorderRef.current;
      if (rec && rec.state !== 'inactive') {
        rec.stop();
        willStop = true;
      }
    } catch {
      // já parado
    }
    // "Pausar" MANTÉM o painel de gravação até o onstop entregar a prévia:
    // o recorder finaliza async e, se o composer voltasse nesse vão, um
    // clique no Mic começaria outra gravação por cima da pausada.
    if (mode !== 'pause' || !willStop) setRecording(false);
    // "Enviar" já trava o Mic aqui (o onstop/conversão vem async depois)
    if (mode === 'send' && willStop) setPreparingVoice(true);
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const discardVoiceNote = () => {
    setVoiceNote(v => {
      if (v) URL.revokeObjectURL(v.url);
      return null;
    });
  };

  const sendVoiceNote = () => {
    const v = voiceNote;
    if (!v || send.isPending || preparingVoice) return;
    setVoiceNote(null);
    URL.revokeObjectURL(v.url);
    void sendVoiceBlob(v.blob, v.mime);
  };

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
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
        <div className="ml-auto flex items-center gap-2">
          {data && !data.connected && (
            <span className="text-[11px] text-amber-600 dark:text-amber-400">WhatsApp desconectado</span>
          )}
          {/* MULTI-NÚMERO: escolhe por qual número conectado as mensagens saem.
              Também aparece com 1 número quando o ESCOLHIDO caiu e o envio
              passou pro reserva — troca de remetente nunca é silenciosa. */}
          {(senders.length > 1 || (!!senderId && !!activeSender && senderId !== activeSender.id)) &&
            activeSender && (
            <div ref={senderMenuRef} className="relative">
              <button
                type="button"
                onClick={() => setSenderMenuOpen(o => !o)}
                aria-expanded={senderMenuOpen}
                className="h-8 max-w-[180px] px-2.5 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-white/10 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10 transition-colors"
                title="Número que envia as mensagens"
              >
                <MessageCircle size={13} className="shrink-0 text-emerald-500" />
                <span className="truncate">
                  {activeSender.phoneNumber || activeSender.profileName || 'Número'}
                </span>
                <ChevronDown size={13} className="shrink-0" />
              </button>
              {senderMenuOpen && (
                <div className="absolute right-0 top-full mt-1 z-20 w-64 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-dark-card p-1.5 shadow-lg">
                  <p className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Enviar pelo número
                  </p>
                  {senders.map(s => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => {
                        setSenderId(s.id);
                        try {
                          window.localStorage.setItem('wa-sender-connection', s.id);
                        } catch {
                          // navegação anônima sem storage: só não persiste
                        }
                        setSenderMenuOpen(false);
                      }}
                      className="w-full flex items-center gap-2 text-left px-3 py-2 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10 transition-colors"
                    >
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">
                          {s.profileName || s.phoneNumber || 'Número'}
                        </span>
                        <span className="block text-xs text-slate-500 dark:text-slate-400 truncate">
                          {s.phoneNumber || ''}
                          {s.provider === 'evolution' ? ' · QR' : ' · API oficial'}
                        </span>
                      </span>
                      {activeSender.id === s.id && (
                        <Check size={15} className="text-emerald-500 shrink-0" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <button
            type="button"
            onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
            className={`h-8 w-8 inline-flex items-center justify-center rounded-lg transition-colors ${
              searchOpen
                ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600'
                : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10'
            }`}
            aria-label="Pesquisar mensagens"
            title="Pesquisar mensagens"
          >
            <Search size={16} />
          </button>
        </div>
      </div>

      {/* Barra de pesquisa de mensagens */}
      {searchOpen && (
        <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-slate-200 dark:border-white/10 bg-white dark:bg-dark-card">
          <Search size={15} className="text-slate-400 shrink-0" />
          <input
            autoFocus
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault();
                gotoMatch(e.shiftKey ? 1 : -1);
              }
              if (e.key === 'Escape') closeSearch();
            }}
            placeholder="Pesquisar mensagens..."
            className="flex-1 bg-transparent text-sm outline-none text-slate-900 dark:text-white"
          />
          {activeQuery && (
            <span className="text-xs text-slate-400 tabular-nums shrink-0">
              {searchMatches.length > 0 ? `${effMatchIndex + 1}/${searchMatches.length}` : '0 resultados'}
            </span>
          )}
          <button
            type="button"
            onClick={() => gotoMatch(-1)}
            disabled={searchMatches.length === 0}
            className="h-7 w-7 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10 disabled:opacity-40"
            aria-label="Resultado anterior (mais antigo)"
            title="Mais antigo"
          >
            <ChevronUp size={16} />
          </button>
          <button
            type="button"
            onClick={() => gotoMatch(1)}
            disabled={searchMatches.length === 0}
            className="h-7 w-7 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10 disabled:opacity-40"
            aria-label="Próximo resultado (mais recente)"
            title="Mais recente"
          >
            <ChevronDown size={16} />
          </button>
          <button
            type="button"
            onClick={closeSearch}
            className="h-7 w-7 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-red-500"
            aria-label="Fechar pesquisa"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* O aviso de não-conectado agora fica no lugar do composer, embaixo */}

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
          <div
            key={m.id}
            ref={el => {
              if (el) msgRefs.current.set(m.id, el);
              else msgRefs.current.delete(m.id);
            }}
          >
            <MessageBubble m={m} searchQuery={activeQuery} isCurrentMatch={m.id === currentMatchId} />
          </div>
        ))}
        <div ref={endRef} />
      </div>

      {/* Sem WhatsApp ativo: aviso claro no LUGAR da caixa de digitação
          (nem deixa tentar enviar; o botão leva direto pra Conexão) */}
      {notConnected && (
        <div className="shrink-0 border-t border-slate-200 dark:border-white/10 p-3 bg-white dark:bg-dark-card">
          <div className="flex items-center gap-3 rounded-xl border border-amber-300 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-900/15 px-4 py-3">
            <span className="w-9 h-9 rounded-xl bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
              <Unplug size={17} />
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-amber-800 dark:text-amber-300">WhatsApp não conectado</p>
              <p className="text-xs text-amber-700/90 dark:text-amber-400/90">
                Conecte o número do escritório na aba Conexão pra enviar e receber mensagens por aqui.
              </p>
            </div>
            <Link
              href="/conexao-whatsapp"
              className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-white text-xs font-bold transition-colors"
            >
              Conectar
            </Link>
          </div>
        </div>
      )}

      {/* Composer */}
      <div
        ref={composerRef}
        className={`shrink-0 border-t border-slate-200 dark:border-white/10 p-3 bg-white dark:bg-dark-card relative ${
          notConnected ? 'hidden' : ''
        }`}
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

        {/* Popover de MODELOS (mensagens gerais da aba Modelos): clicou,
            entra no campo com as variáveis preenchidas com os dados reais */}
        {templatesOpen && (
          <div className="absolute bottom-full left-3 right-3 mb-1 z-10 max-h-64 overflow-y-auto scrollbar-custom rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-dark-card p-1.5 shadow-lg">
            <p className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Modelos de mensagem
            </p>
            {templatesQ.isLoading ? (
              <p className="px-3 py-2 text-sm text-slate-400">Carregando...</p>
            ) : generalTemplates.length === 0 ? (
              <p className="px-3 py-2 text-sm text-slate-400">
                Nenhum modelo geral ainda. Crie em Configurações, aba Modelos.
              </p>
            ) : (
              generalTemplates.map(t => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => applyTemplate(t.body)}
                  className="w-full text-left px-3 py-2 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10 transition-colors"
                >
                  <span className="block text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">
                    {t.name}
                  </span>
                  <span className="block text-xs text-slate-500 dark:text-slate-400 truncate">
                    {t.body}
                  </span>
                </button>
              ))
            )}
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
          <div className="flex items-center gap-3 max-md:flex-wrap max-md:gap-y-2">
            <span className="flex items-center gap-2 text-sm text-red-500 font-semibold">
              <span className="h-2.5 w-2.5 rounded-full bg-red-500 animate-pulse" />
              Gravando… {fmtSeconds(recSeconds)}
            </span>
            <div className="flex-1" />
            <button
              type="button"
              onClick={() => stopRecording('cancel')}
              className="h-10 px-3 inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-white/10 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10"
            >
              <X size={16} /> Cancelar
            </button>
            <button
              type="button"
              onClick={() => stopRecording('pause')}
              className="h-10 px-3 inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-white/10 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10"
              title="Pausar e ouvir antes de enviar"
            >
              <Pause size={16} /> Pausar
            </button>
            <button
              type="button"
              onClick={() => stopRecording('send')}
              className="h-10 px-4 inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold"
            >
              <Send size={16} /> Enviar áudio
            </button>
          </div>
        ) : voiceNote ? (
          /* Prévia da gravação pausada: ouve antes de enviar ou descartar */
          <div className="flex items-center gap-3 max-md:flex-wrap max-md:gap-y-2">
            <button
              type="button"
              onClick={discardVoiceNote}
              className="shrink-0 h-10 w-10 inline-flex items-center justify-center rounded-xl border border-slate-200 dark:border-white/10 text-slate-500 dark:text-slate-300 hover:text-red-500 hover:bg-slate-100 dark:hover:bg-white/10"
              aria-label="Descartar gravação"
              title="Descartar gravação"
            >
              <Trash2 size={17} />
            </button>
            <audio
              controls
              src={voiceNote.url}
              className="flex-1 min-w-0 h-10 max-md:order-first max-md:basis-full"
              preload="metadata"
            />
            <span className="shrink-0 text-xs text-slate-400 tabular-nums">{fmtSeconds(voiceNote.seconds)}</span>
            <button
              type="button"
              onClick={sendVoiceNote}
              disabled={send.isPending || preparingVoice}
              className="shrink-0 h-10 px-4 inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-bold"
            >
              {send.isPending || preparingVoice ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Send size={16} />
              )}{' '}
              Enviar áudio
            </button>
          </div>
        ) : (
          <div className="flex items-end gap-1.5">
            <button
              type="button"
              onClick={() => {
                setEmojiOpen(o => !o);
                setAttachMenuOpen(false);
                setTemplatesOpen(false);
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
                setTemplatesOpen(o => !o);
                setEmojiOpen(false);
                setAttachMenuOpen(false);
              }}
              className={`shrink-0 h-10 w-10 inline-flex items-center justify-center rounded-xl transition-colors ${
                templatesOpen
                  ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600'
                  : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10'
              }`}
              aria-label="Modelos de mensagem"
              title="Modelos de mensagem"
            >
              <ClipboardList size={19} />
            </button>
            <button
              type="button"
              onClick={() => {
                setAttachMenuOpen(o => !o);
                setEmojiOpen(false);
                setTemplatesOpen(false);
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
                disabled={send.isPending || preparingVoice}
                className="shrink-0 h-10 w-10 inline-flex items-center justify-center rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white transition-colors"
                aria-label="Gravar áudio"
                title="Gravar mensagem de voz"
              >
                {preparingVoice ? <Loader2 size={18} className="animate-spin" /> : <Mic size={18} />}
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
