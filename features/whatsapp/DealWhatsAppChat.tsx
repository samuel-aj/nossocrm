
'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { traduzErroWhatsApp } from '@/lib/whatsapp/metaErrorsPtBr';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
  Clock,
  Lock,
  Unplug,
  Pause,
  Trash2,
  Info,
  Play,
  User,
  Users,
  Bot,
  Square,
  Reply,
  Forward,
  Link2,
} from 'lucide-react';
import { normalizePhoneE164 } from '@/lib/phone';
import { quotedPreviewText, type QuotedSnapshot } from '@/lib/whatsapp/quote';
import { ForwardMessageModal } from './ForwardMessageModal';
import {
  fillTemplate,
  templateParams,
  toMetaBody,
  TEMPLATE_BUTTON_LABEL,
  TEMPLATE_VARIABLES,
  type TemplateButton,
} from '@/lib/messageTemplates';
import { formatRemaining, getServiceWindow } from '@/lib/whatsapp/serviceWindow';
import { useWhatsAppChat, type WaChatMessage, type WaMediaKind, type WaSender } from './useWhatsAppChat';
import { transcodeToMp3 } from './audioTranscode';
import { useWaAgentsAccess } from '@/hooks/useWaAgentsAccess';
import { useToast } from '@/context/ToastContext';
import { ChatAgentBanner } from '@/features/wa-agents/ChatAgentBanner';
import { AutomationsMenu } from '@/features/wa-agents/AutomationsMenu';
import type { AgentMinimal, BotMinimal, ConversationAiAction } from '@/lib/wa-agents/types';

const TIME_FMT = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });

/** Confirmação (toast) das ações da faixa que trocam quem atende a conversa; as demais só atualizam a faixa. */
const AI_ACTION_DONE_TOAST: Partial<Record<ConversationAiAction, string>> = {
  start: 'Agente iniciado nesta conversa',
  start_bot: 'Robô iniciado nesta conversa. Se havia agente, ele foi parado.',
  cancel_bot: 'Robô cancelado',
  stop: 'Agente parado nesta conversa',
  reset_memory: 'Memória do agente limpa nesta conversa',
};

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

/** Balão de áudio estilo WhatsApp: FOTO do contato antes do play; quando o
 *  áudio toca, o avatar dá lugar (transição suave) ao seletor de velocidade
 *  que cicla 1x → 1.5x → 2x → 1x. */
function AudioBubble({ m, contactName }: { m: WaChatMessage; contactName?: string }) {
  const isOut = m.direction === 'out';
  const audioRef = useRef<HTMLAudioElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const primedRef = useRef(false);
  const primingRef = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState<number | null>(null);
  const [rate, setRate] = useState<1 | 1.5 | 2>(1);

  // 'timeupdate' só dispara ~4x/s, o que faz a bolinha andar em saltos;
  // enquanto toca, lê a posição a cada frame pra ela deslizar suave
  useEffect(() => {
    if (!playing) return;
    let raf = requestAnimationFrame(function tick() {
      const el = audioRef.current;
      if (el && !draggingRef.current && !primingRef.current) setCurrent(el.currentTime);
      raf = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  // "começou" = tocando ou parado no meio; no fim (currentTime volta a 0) o
  // avatar reaparece, como no WhatsApp
  const started = playing || current > 0;
  const initial = (contactName || '').trim().charAt(0).toUpperCase();

  // MediaRecorder às vezes entrega duration=Infinity até tocar inteiro —
  // só habilita a barra quando o número é real
  const syncDuration = () => {
    const el = audioRef.current;
    if (el && isFinite(el.duration) && el.duration > 0) setDuration(el.duration);
  };

  // Áudio gravado (MediaRecorder/mp3 sem header de duração) chega com a
  // duração inflada ou Infinity nos metadados — a bolinha corre sobre uma
  // duração falsa e o som acaba antes dela chegar no fim. Um seek "pro
  // infinito" força o navegador a escanear o arquivo e corrigir pra duração
  // real (dispara durationchange → syncDuration), depois volta pro início.
  const primeDuration = () => {
    const el = audioRef.current;
    if (!el || primedRef.current) return;
    primedRef.current = true;
    primingRef.current = true;
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      el.removeEventListener('seeked', done);
      el.currentTime = 0;
      primingRef.current = false;
    };
    el.addEventListener('seeked', done);
    window.setTimeout(done, 3000); // fallback se 'seeked' não vier
    el.currentTime = 1e10;
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
    if (el.paused) {
      el.playbackRate = rate; // o elemento perde o rate quando o src renova
      void el.play();
    } else {
      el.pause();
    }
  };

  const cycleRate = () => {
    const next = rate === 1 ? 1.5 : rate === 1.5 ? 2 : 1;
    setRate(next as 1 | 1.5 | 2);
    const el = audioRef.current;
    if (el) el.playbackRate = next;
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
        onEmptied={() => {
          setPlaying(false); // src renovado (URL assinada) aborta sem 'pause'
          primedRef.current = false; // src novo precisa primar a duração de novo
          primingRef.current = false;
        }}
        onEnded={() => {
          const el = audioRef.current;
          if (el) el.currentTime = 0; // volta pro início, como no WhatsApp
          setCurrent(0);
        }}
        onTimeUpdate={e => {
          if (!draggingRef.current && !primingRef.current) setCurrent((e.target as HTMLAudioElement).currentTime);
        }}
        onLoadedMetadata={e => {
          syncDuration();
          (e.target as HTMLAudioElement).playbackRate = rate;
          primeDuration();
        }}
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
        {/* Slot avatar ↔ velocidade, do LADO DIREITO da barra: foto/inicial
            do contato antes do play; tocando, vira o botão de velocidade
            com crossfade suave */}
        <div className="relative h-10 w-10 shrink-0">
          <span
            aria-hidden={started}
            className={`absolute inset-0 rounded-full flex items-center justify-center transition-all duration-300 ${
              started ? 'opacity-0 scale-75 pointer-events-none' : 'opacity-100 scale-100'
            } ${
              isOut
                ? 'bg-white/25 text-white'
                : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
            }`}
          >
            {!isOut && initial ? (
              <span className="text-base font-bold">{initial}</span>
            ) : (
              <User size={18} />
            )}
            <span
              className={`absolute -bottom-1 -right-1 h-4 w-4 rounded-full flex items-center justify-center ${
                isOut ? 'bg-emerald-800 text-emerald-100' : 'bg-emerald-500 text-white'
              }`}
            >
              <Mic size={10} />
            </span>
          </span>
          <button
            type="button"
            onClick={cycleRate}
            tabIndex={started ? 0 : -1}
            className={`absolute inset-0 rounded-full flex items-center justify-center text-[11px] font-bold transition-all duration-300 ${
              started ? 'opacity-100 scale-100' : 'opacity-0 scale-75 pointer-events-none'
            } ${btn}`}
            aria-label={`Velocidade do áudio: ${rate}x`}
            title="Mudar a velocidade"
          >
            {rate}x
          </button>
        </div>
      </div>
      {/* Só UM tempo, à esquerda (estilo WhatsApp): a DURAÇÃO parado, o tempo
          decorrido tocando. O horário da mensagem sobe pra esta mesma linha,
          à direita (o footer do balão usa -mt no modo áudio). */}
      <div
        className={`mt-0.5 h-4 flex items-center pl-[46px] text-[9px] tabular-nums ${
          isOut ? 'text-emerald-100' : 'text-slate-400'
        }`}
      >
        <span>
          {started
            ? fmtSeconds(Math.floor(current))
            : duration
              ? fmtSeconds(Math.floor(duration))
              : '--:--'}
        </span>
      </div>
    </div>
  );
}

function MediaContent({ m, contactName }: { m: WaChatMessage; contactName?: string }) {
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
      return <AudioBubble m={m} contactName={contactName} />;
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

type BubbleAction = 'reply' | 'forward';

/** GRUPO: cor estável por participante (nome em cima da bolha, como no WhatsApp). */
const SENDER_COLORS = [
  'text-emerald-600 dark:text-emerald-400',
  'text-sky-600 dark:text-sky-400',
  'text-violet-600 dark:text-violet-400',
  'text-amber-600 dark:text-amber-400',
  'text-rose-600 dark:text-rose-400',
  'text-teal-600 dark:text-teal-400',
  'text-indigo-600 dark:text-indigo-400',
  'text-orange-600 dark:text-orange-400',
];
function senderColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return SENDER_COLORS[h % SENDER_COLORS.length];
}

/** Bloco da mensagem CITADA dentro da bolha (estilo WhatsApp): barra colorida
 *  à esquerda, quem escreveu, prévia e miniatura quando a original é imagem.
 *  Clicável quando a original está carregada ("pular para"). */
function QuotedBlock({
  q,
  isOut,
  contactName,
  original,
  onJump,
}: {
  q: QuotedSnapshot;
  isOut: boolean;
  contactName?: string;
  original: WaChatMessage | null;
  onJump?: () => void;
}) {
  const mine = q.direction === 'out';
  // grupo: a citada de outro participante mostra o nome dele (sender_name da original)
  const title =
    q.direction === 'out' ? 'Você' : q.direction === 'in' ? original?.sender_name || contactName || 'Contato' : 'Mensagem';
  const thumb =
    original?.media_url && (original.media_type === 'image' || original.media_type === 'sticker')
      ? original.media_url
      : null;
  return (
    <div
      role={onJump ? 'button' : undefined}
      tabIndex={onJump ? 0 : undefined}
      onClick={onJump}
      onKeyDown={e => {
        if (onJump && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onJump();
        }
      }}
      title={onJump ? 'Ir para a mensagem original' : undefined}
      className={`mb-1.5 flex items-stretch gap-2 rounded-lg overflow-hidden border-l-4 ${
        mine ? 'border-emerald-300' : 'border-sky-400'
      } ${isOut ? 'bg-black/15' : 'bg-slate-100 dark:bg-white/10'} ${
        onJump ? 'cursor-pointer hover:brightness-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400' : ''
      }`}
    >
      <div className="min-w-0 flex-1 px-2 py-1.5">
        <p
          className={`text-[11px] font-bold ${
            mine
              ? isOut
                ? 'text-emerald-100'
                : 'text-emerald-600 dark:text-emerald-400'
              : isOut
                ? 'text-sky-100'
                : 'text-sky-600 dark:text-sky-400'
          }`}
        >
          {title}
        </p>
        <p className={`text-xs line-clamp-2 break-words ${isOut ? 'text-emerald-50/90' : 'text-slate-600 dark:text-slate-300'}`}>
          {quotedPreviewText(q)}
        </p>
      </div>
      {thumb && (
        // eslint-disable-next-line @next/next/no-img-element -- miniatura da URL assinada do Storage
        <img src={thumb} alt="" className="h-12 w-12 object-cover shrink-0" />
      )}
    </div>
  );
}

function MessageBubble({
  m,
  searchQuery = '',
  isCurrentMatch = false,
  contactName,
  onAction,
  quotedOriginal = null,
  onJumpToQuoted,
  flash = false,
  senderName,
}: {
  m: WaChatMessage;
  searchQuery?: string;
  isCurrentMatch?: boolean;
  contactName?: string;
  /** Responder / Encaminhar / Copiar (menu da bolha); ausente = bolha sem ações */
  onAction?: (action: BubbleAction, m: WaChatMessage) => void;
  /** A mensagem citada, quando está carregada (miniatura + "pular para") */
  quotedOriginal?: WaChatMessage | null;
  onJumpToQuoted?: (id: string) => void;
  /** Destaque temporário (chegou aqui pelo "pular para a original") */
  flash?: boolean;
  /** GRUPO: quem escreveu (nome colorido em cima da bolha recebida) */
  senderName?: string;
}) {
  const isOut = m.direction === 'out';
  const failed = m.status === 'failed';
  // Menu de ações da bolha (▾ no hover, toque longo no celular ou botão
  // direito), estilo WhatsApp Web. Bolha otimista (temp-) ainda não tem id.
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuAbove, setMenuAbove] = useState(false);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const pressTimerRef = useRef<number | null>(null);
  const pressStartRef = useRef<{ x: number; y: number } | null>(null);
  const canAct = !!onAction && !m.id.startsWith('temp-');
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: Event) => {
      if (bubbleRef.current && !bubbleRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);
  const openMenu = () => {
    if (!canAct) return;
    // perto do fim da lista o menu abre pra CIMA (senão some no rodapé)
    const el = bubbleRef.current;
    const scroller = el?.closest('.overflow-y-auto');
    if (el && scroller) {
      const room = scroller.getBoundingClientRect().bottom - el.getBoundingClientRect().bottom;
      setMenuAbove(room < 150);
    }
    setMenuOpen(true);
  };
  const cancelPress = () => {
    if (pressTimerRef.current) {
      window.clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
    pressStartRef.current = null;
  };
  const act = (action: BubbleAction) => {
    setMenuOpen(false);
    onAction?.(action, m);
  };
  // Degradê da cor da bolha por trás da seta (estilo WhatsApp Web), SEMPRE na
  // cor da bolha. Em texto simples é um degradê reto (esquerda -> direita).
  // Onde esse bloco reto cortaria algo de cor diferente (citação no topo,
  // foto do áudio, foto/vídeo/figurinha), o degradê é RADIAL a partir do
  // canto: esmaece em todas as direções, sem linha de corte. O degradê é só
  // decorativo (não recebe clique); o botão é do tamanho da seta. A bolha
  // nunca muda de tamanho por causa da seta.
  const chevronSoft =
    m.media_type === 'audio' ||
    m.media_type === 'image' ||
    m.media_type === 'video' ||
    m.media_type === 'sticker' ||
    !!m.quoted;
  const chevronTone = isOut
    ? 'text-emerald-50 hover:text-white'
    : 'text-slate-400 hover:text-slate-600 dark:text-slate-300 dark:hover:text-white';
  const chevronBackdrop = chevronSoft
    ? `h-9 w-16 ${
        isOut
          ? 'bg-[radial-gradient(ellipse_at_top_right,#059669_30%,transparent_72%)]'
          : 'bg-[radial-gradient(ellipse_at_top_right,#ffffff_30%,transparent_72%)] dark:bg-[radial-gradient(ellipse_at_top_right,#334155_30%,transparent_72%)]'
      }`
    : `h-7 w-14 bg-gradient-to-l from-50% to-transparent ${isOut ? 'from-emerald-600' : 'from-white dark:from-slate-700'}`;
  const chevronVisible = menuOpen
    ? 'opacity-100'
    : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100';
  // Motivo real devolvido pela Meta/Evolution (truncado), ou um texto
  // genérico quando o provedor não explicou — vai no cartão do selo "Erro"
  // Erro do provedor traduzido pra pt-BR (o texto cru da Meta é técnico e em
  // inglês); o código fica junto, pequeno, pra facilitar suporte.
  const failReason = failed
    ? (m.error || '').trim()
      ? (() => {
          const { explicacao, codigo } = traduzErroWhatsApp((m.error as string).trim());
          return codigo ? `${explicacao} (código ${codigo})` : explicacao;
        })()
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
        ref={bubbleRef}
        style={{ WebkitTouchCallout: 'none' }}
        onPointerDown={e => {
          // toque longo (celular) abre o menu; mouse usa o ▾ ou o botão direito
          if (!canAct || e.pointerType === 'mouse') return;
          pressStartRef.current = { x: e.clientX, y: e.clientY };
          pressTimerRef.current = window.setTimeout(() => {
            pressTimerRef.current = null;
            openMenu();
          }, 500);
        }}
        onPointerMove={e => {
          const s = pressStartRef.current;
          if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > 10) cancelPress();
        }}
        onPointerUp={cancelPress}
        onPointerCancel={cancelPress}
        onContextMenu={e => {
          if (!canAct) return;
          e.preventDefault();
          openMenu();
        }}
        className={`group relative max-w-[78%] rounded-2xl px-3 py-2 text-sm shadow-sm ${
          isOut
            ? 'bg-emerald-600 text-white rounded-br-sm'
            : 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white rounded-bl-sm border border-slate-200 dark:border-white/10'
        } ${failed ? 'ring-1 ring-red-400/80' : ''} ${
          isCurrentMatch || flash ? 'ring-2 ring-amber-400' : ''
        } ${flash ? 'transition-shadow duration-500' : ''}`}
      >
        {canAct && (
          <>
            {/* degradê decorativo (não clicável) no canto da bolha */}
            <span
              aria-hidden
              className={`absolute top-0 right-0 z-10 pointer-events-none rounded-tr-2xl transition-opacity ${chevronVisible} ${chevronBackdrop}`}
            />
            {/* a seta em si: só ela recebe o clique */}
            <button
              type="button"
              onClick={e => {
                e.stopPropagation();
                if (menuOpen) setMenuOpen(false);
                else openMenu();
              }}
              aria-label="Opções da mensagem"
              aria-expanded={menuOpen}
              title="Responder ou encaminhar"
              className={`absolute top-1 right-1.5 z-20 h-5 w-5 inline-flex items-center justify-center rounded transition-opacity focus-visible:opacity-100 ${chevronVisible} ${chevronTone}`}
            >
              <ChevronDown size={18} strokeWidth={2.2} />
            </button>
          </>
        )}
        {menuOpen && (
          <div
            role="menu"
            className={`absolute ${menuAbove ? 'bottom-full mb-1' : 'top-7'} ${
              isOut ? 'right-1' : 'left-1'
            } z-30 w-44 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-dark-card p-1.5 shadow-lg text-slate-700 dark:text-slate-200`}
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => act('reply')}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm hover:bg-slate-100 dark:hover:bg-white/10"
            >
              <Reply size={16} className="text-emerald-500" /> Responder
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => act('forward')}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm hover:bg-slate-100 dark:hover:bg-white/10"
            >
              <Forward size={16} className="text-sky-500" /> Encaminhar
            </button>
          </div>
        )}
        {senderName && (
          <p className={`mb-0.5 pr-5 text-[11px] font-bold truncate ${senderColor(senderName)}`}>{senderName}</p>
        )}
        {m.forwarded && (
          <p className={`mb-1 inline-flex items-center gap-1 text-[10px] italic ${isOut ? 'text-emerald-100/90' : 'text-slate-400'}`}>
            <Forward size={11} /> Encaminhada
          </p>
        )}
        {m.quoted && (
          <QuotedBlock
            q={m.quoted}
            isOut={isOut}
            contactName={contactName}
            original={quotedOriginal}
            onJump={m.quoted_message_id && onJumpToQuoted ? () => onJumpToQuoted(m.quoted_message_id as string) : undefined}
          />
        )}
        <MediaContent m={m} contactName={contactName} />
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
          className={`flex items-center justify-end gap-1.5 ${
            // áudio: o horário SOBE pra linha da duração (à direita dela) e
            // fica um tico maior que o texto da duração; -10px (não -16px)
            // pra dar 6px de respiro abaixo da foto do contato
            m.media_type === 'audio' ? '-mt-[10px] h-4 text-[11px]' : 'mt-1 text-[10px]'
          } ${isOut ? 'text-emerald-100' : 'text-slate-400'}`}
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
  connectionId = null,
  group = null,
}: {
  contact: { id: string; name?: string | null; phone?: string | null } | null;
  /** Valores extras pras variáveis dos modelos (lead.titulo, escritorio.nome...) */
  templateContext?: Record<string, string>;
  /** Conversa PRESA a um número conectado (página Chats com conversas por
   * número): só as mensagens dele, e o envio sai por ele — o seletor de
   * remetente some. null = visão unificada do contato (card do lead). */
  connectionId?: string | null;
  /** GRUPO do WhatsApp: a conversa é o grupo (sem contato nem telefone); as
   * mensagens recebidas mostram quem escreveu; sem agente, robô nem janela de 24 h. */
  group?: { conversationId: string; name: string; participantsCount?: number | null } | null;
}) {
  const isGroup = !!group;
  const phone = useMemo(() => (isGroup ? '' : normalizePhoneE164(contact?.phone || '')), [contact?.phone, isGroup]);
  const { data, isLoading, error, send } = useWhatsAppChat(phone || null, connectionId, group?.conversationId ?? null);
  const [text, setText] = useState('');
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  // Popover Automações (beta): iniciar agente/robô, limpar memória
  const [automationsOpen, setAutomationsOpen] = useState(false);
  // RESPONDER (citar) e ENCAMINHAR, estilo WhatsApp
  const [replyTo, setReplyTo] = useState<WaChatMessage | null>(null);
  const replyToRef = useRef<WaChatMessage | null>(null); // o onstop do gravador roda fora do render
  const [forwardMsg, setForwardMsg] = useState<WaChatMessage | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null); // bolha citada em destaque após "pular para"
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // GRUPO: buscando/copiando o link de convite
  const [inviteBusy, setInviteBusy] = useState(false);
  useEffect(() => {
    replyToRef.current = replyTo;
  }, [replyTo]);
  // Esc cancela a resposta armada
  useEffect(() => {
    if (!replyTo) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setReplyTo(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [replyTo]);
  // Modelos de mensagem GERAIS (aba Modelos): prontos pra inserir no composer
  // com as variáveis já preenchidas com os dados reais do lead/contato
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const templatesQ = useQuery<{
    data: {
      id: string;
      name: string;
      type: string;
      body: string;
      language?: string;
      meta_name?: string | null;
      meta_status?: string | null;
      connectionId?: string | null;
      buttons?: TemplateButton[] | null;
    }[];
  }>({
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
  const templateValues = useMemo(
    () => ({
      'contato.nome': contact?.name || '',
      'contato.telefone': contact?.phone || '',
      ...templateContext,
    }),
    [contact?.name, contact?.phone, templateContext]
  );
  const applyTemplate = (body: string) => {
    const filled = fillTemplate(body, templateValues);
    setText(t => (t.trim() ? `${t}\n${filled}` : filled));
    setTemplatesOpen(false);
  };
  // Modelo da API oficial escolhido: fica "armado" no composer (prévia já
  // preenchida) e sai como TEMPLATE de verdade pela Meta no Enviar — é o
  // único jeito de falar com o lead fora da janela de 24h.
  const [pendingTemplate, setPendingTemplate] = useState<{
    id: string;
    name: string;
    metaName: string;
    language: string;
    body: string;
    buttons: TemplateButton[] | null;
  } | null>(null);
  // Variáveis do modelo armado: o que o CRM resolveu sozinho (templateValues) e o que
  // a pessoa digitou por cima (para as que ele não achou, ou para corrigir)
  const [templateOverrides, setTemplateOverrides] = useState<Record<string, string>>({});
  useEffect(() => {
    setTemplateOverrides({});
  }, [pendingTemplate?.id]);
  const templateEffective = useMemo(() => {
    const out: Record<string, string | undefined> = { ...templateValues };
    for (const [k, v] of Object.entries(templateOverrides)) out[k] = v;
    return out;
  }, [templateValues, templateOverrides]);
  const templateVarKeys = pendingTemplate ? toMetaBody(pendingTemplate.body).variables : [];
  const templateMissing = templateVarKeys.some(k => !(templateEffective[k.replace(/[{}]/g, '')] ?? '').trim());
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
  // AGENTE DE IA nesta conversa: pausa sozinho quando um atendente responde
  // (gatilho no banco); aqui o usuário pausa/retoma na mão.
  const qc = useQueryClient();
  const { showToast } = useToast();
  const aiState = data?.ai ?? null;
  const [aiBusy, setAiBusy] = useState(false);
  // Versão beta (agentes nativos): faixa completa com iniciar/pausar/parar/aprovar.
  // Fora do beta, a faixa antiga (pausar/retomar do agente externo) continua igual.
  const waBeta = useWaAgentsAccess();
  const nativeBanner = waBeta.agentsApproved || !!aiState?.native;
  const { data: agentsMinimal } = useQuery<{ agents: AgentMinimal[] }>({
    queryKey: ['waAgents', 'minimal'],
    queryFn: async () => {
      const res = await fetch('/api/wa-agents/agents', {
        credentials: 'include',
        headers: { accept: 'application/json' },
      });
      const j = (await res.json().catch(() => null)) as { agents?: AgentMinimal[]; error?: string } | null;
      if (!res.ok) throw new Error(j?.error || `HTTP ${res.status}`);
      return { agents: j?.agents ?? [] };
    },
    enabled: waBeta.agentsApproved,
    staleTime: 60_000,
    retry: false,
  });
  // Robôs ligados da org (menu "Iniciar" da faixa): qualquer membro pode listar.
  const { data: botsMinimal } = useQuery<{ bots: BotMinimal[] }>({
    queryKey: ['waBots', 'minimal'],
    queryFn: async () => {
      const res = await fetch('/api/wa-agents/bots', {
        credentials: 'include',
        headers: { accept: 'application/json' },
      });
      const j = (await res.json().catch(() => null)) as { bots?: BotMinimal[]; error?: string } | null;
      if (!res.ok) throw new Error(j?.error || `HTTP ${res.status}`);
      return {
        bots: (j?.bots ?? [])
          .filter(b => b.enabled)
          .map(b => ({
            id: b.id,
            name: b.name,
            enabled: b.enabled,
            connection_id: b.connection_id ?? null,
            connection_ids: b.connection_ids?.length ? b.connection_ids : b.connection_id ? [b.connection_id] : [],
          })),
      };
    },
    enabled: waBeta.agentsApproved,
    staleTime: 60_000,
    retry: false,
  });
  /** `id` = agentId em "start"; botId em "start_bot". */
  const runAiAction = async (action: ConversationAiAction, id?: string, context?: string) => {
    if (aiBusy) return;
    const conversationId = aiState?.conversationId ?? data?.conversation?.id ?? null;
    if (!conversationId) return;
    setAiBusy(true);
    try {
      const res = nativeBanner
        ? await fetch('/api/wa-agents/conversation', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              conversationId,
              action,
              agentId: action === 'start' ? id : undefined,
              botId: action === 'start_bot' ? id : undefined,
              // contexto adicional escrito pela equipe (Automações → Iniciar)
              context: context && (action === 'start' || action === 'start_bot') ? context : undefined,
            }),
          })
        : await fetch('/api/whatsapp/conversations/ai', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              conversationId,
              status: action === 'pause' ? 'paused' : action === 'stop' ? 'stopped' : 'active',
            }),
          });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      await qc.invalidateQueries({ queryKey: ['waChat'] });
      const done = AI_ACTION_DONE_TOAST[action];
      if (done) showToast(done, 'success');
    } catch (e) {
      // 409/403 etc. chegam ao usuário (antes só iam para o console).
      showToast((e as Error).message || 'Falha ao acionar o agente', 'error');
    } finally {
      setAiBusy(false);
    }
  };
  const toggleAi = async () => {
    if (!aiState) return;
    await runAiAction(aiState.status === 'active' ? 'pause' : 'resume');
  };
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
  // Mensagens por id: a bolha de resposta acha a original (miniatura + pular para)
  const messagesById = useMemo(() => new Map(messages.map(m => [m.id, m])), [messages]);
  // Números conectados + o remetente ATIVO (escolhido ou o padrão). O ref
  // espelha pro onstop do gravador (roda fora do render) enviar pelo certo.
  const senders = data?.senders ?? [];
  // Conversa presa a um número: o remetente é ELE, sem escolha nem fallback
  // pra outro número (se ele desconectar, o composer avisa em vez de enviar
  // pelo número errado).
  const activeSender = connectionId
    ? senders.find(s => s.id === connectionId) ?? null
    : senders.find(s => s.id === senderId) ?? senders[0] ?? null;
  const senderRef = useRef<WaSender | null>(null);
  useEffect(() => {
    senderRef.current = activeSender;
  }, [activeSender]);
  // Modelos APROVADOS do número que vai enviar (cada número tem os seus na Meta)
  const senderIsApi = ['meta_cloud', 'evolution_business'].includes(String(activeSender?.provider ?? '').toLowerCase());
  // JANELA DE 24 H: só a API oficial da Meta trava (Evolution não tem a regra).
  // Conta da ÚLTIMA MENSAGEM RECEBIDA do contato: a rota manda a data olhando
  // todas as conversas do telefone; reserva = mensagens já carregadas.
  const senderIsMeta = String(activeSender?.provider ?? '').toLowerCase() === 'meta_cloud';
  const lastInboundAt = useMemo(() => {
    const fromApi = data?.conversation?.last_inbound_at ?? null;
    if (fromApi) return fromApi;
    let latest: string | null = null;
    for (const m of messages) {
      if (m.direction !== 'in') continue;
      const ts = m.wa_timestamp || m.created_at;
      if (!latest || Date.parse(ts) > Date.parse(latest)) latest = ts;
    }
    return latest;
  }, [data?.conversation?.last_inbound_at, messages]);
  // Relógio da faixa "fecha em X" (e da trava): tique a cada 30 s, só com a API oficial
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!senderIsMeta) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, [senderIsMeta]);
  const win = getServiceWindow(lastInboundAt, now);
  // Fechada: texto/anexo/áudio somem do composer; só um modelo aprovado reabre
  const windowLocked = senderIsMeta && !win.open;
  const apiTemplates = senderIsApi
    ? (templatesQ.data?.data ?? []).filter(
        t => t.type === 'whatsapp_api' && t.meta_status === 'APPROVED' && t.connectionId === activeSender?.id
      )
    : [];
  const pickApiTemplate = (t: (typeof apiTemplates)[number]) => {
    setTemplatesOpen(false);
    if (String(activeSender?.provider ?? '').toLowerCase() !== 'meta_cloud' || !t.meta_name) {
      // Evolution business: sem envio de template pela API dela; vai como texto
      applyTemplate(t.body);
      return;
    }
    setPendingTemplate({
      id: t.id,
      name: t.name,
      metaName: t.meta_name,
      language: t.language || 'pt_BR',
      body: t.body,
      buttons: t.buttons ?? null,
    });
  };
  const sendPendingTemplate = () => {
    if (!pendingTemplate || send.isPending || sendGateRef.current) return;
    const tpl = pendingTemplate;
    setPendingTemplate(null);
    forceScrollRef.current = true;
    send.mutate(
      {
        text: fillTemplate(tpl.body, templateEffective),
        template: { name: tpl.metaName, language: tpl.language, params: templateParams(tpl.body, templateEffective) },
        connectionId: connectionId ?? senderRef.current?.id,
      },
      { onError: () => setPendingTemplate(curr => curr ?? tpl) }
    );
  };

  // Divisórias por número na visão unificada: rótulo de cada número da org
  // (inclui desconectados/removidos) e flag pra dividir só quando a conversa
  // realmente passou por 2+ números.
  const numbersById = data?.numbers ?? {};
  const connLabel = (id: string | null | undefined): string => {
    const n = id ? numbersById[id] : undefined;
    if (n) return n.phoneNumber || n.profileName || 'Número';
    return 'número removido';
  };
  const showConnDividers = useMemo(() => {
    if (connectionId) return false; // chat preso a um número: tudo é dele
    const distintos = new Set(messages.map(m => m.connection_id ?? null));
    return distintos.size > 1;
  }, [connectionId, messages]);
  // Sem conexão ativa (nunca conectou OU desconectou): troca o composer pelo
  // aviso de conectar, em vez de deixar o envio falhar com erro técnico
  const notConnected =
    !!data &&
    (!data.hasConnection ||
      !data.connected ||
      // conversa presa a um número que caiu: avisa em vez de enviar por outro
      (!!connectionId && !senders.some(s => s.id === connectionId)));
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
    // resposta armada e encaminhamento eram da conversa anterior
    setReplyTo(null);
    setForwardMsg(null);
    setFlashId(null);
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

  if (!isGroup && !contact) return <CenterMsg>Este lead não tem contato vinculado.</CenterMsg>;
  if (!isGroup && !phone)
    return <CenterMsg>O contato não tem telefone. Adicione um número pra conversar pelo WhatsApp.</CenterMsg>;

  const contactName = group?.name ?? (contact?.name || data?.conversation?.wa_name || 'Contato');
  const participantsCount = data?.conversation?.participants_count ?? group?.participantsCount ?? null;

  const clearAttachment = () => {
    setAttachment(prev => {
      if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
      return null;
    });
  };

  /** "Pular para" a mensagem citada: rola até ela e destaca por um instante. */
  const jumpToMessage = (id: string) => {
    const el = msgRefs.current.get(id);
    if (!el) {
      showToast('A mensagem original não está carregada neste chat', 'error');
      return;
    }
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setFlashId(id);
    window.setTimeout(() => setFlashId(curr => (curr === id ? null : curr)), 1800);
  };

  /** GRUPO: copia o link de convite (busca no provedor se ainda não estiver guardado). */
  const copyInviteLink = async () => {
    if (!group || inviteBusy) return;
    setInviteBusy(true);
    try {
      let link = data?.conversation?.group_invite_link ?? null;
      if (!link) {
        const res = await fetch('/api/whatsapp/groups/invite', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ conversationId: group.conversationId }),
        });
        const j = (await res.json().catch(() => ({}))) as { inviteLink?: string; error?: string };
        if (!res.ok || !j.inviteLink) throw new Error(j.error || 'Não deu para obter o link de convite');
        link = j.inviteLink;
        void qc.invalidateQueries({ queryKey: ['waChat'] });
      }
      await navigator.clipboard.writeText(link);
      showToast('Link de convite do grupo copiado', 'success');
    } catch (e) {
      showToast((e as Error).message || 'Não deu para copiar o link de convite', 'error');
    } finally {
      setInviteBusy(false);
    }
  };

  /** Menu da bolha: Responder arma a citação no composer; Encaminhar abre o modal. */
  const onBubbleAction = (action: BubbleAction, m: WaChatMessage) => {
    if (action === 'reply') {
      setReplyTo(m);
      setEmojiOpen(false);
      setAttachMenuOpen(false);
      setTemplatesOpen(false);
      window.setTimeout(() => textareaRef.current?.focus(), 0);
      return;
    }
    if (action === 'forward') setForwardMsg(m);
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
    // windowLocked: janela de 24 h fechada (API oficial) — texto/anexo não saem, só modelo
    if ((!t && !attachment) || send.isPending || recording || sendGateRef.current || windowLocked) return;
    sendGateRef.current = true;
    const releaseGate = () => {
      sendGateRef.current = false;
    };
    // resposta armada vai junto (e volta pro composer se o envio falhar)
    const replySnapshot = replyTo;

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
        setReplyTo(null);
        forceScrollRef.current = true;
        send.mutate(
          {
            text: t,
            file,
            kind,
            fileName,
            connectionId: connectionId ?? senderRef.current?.id,
            replyTo: replySnapshot ?? undefined,
          },
          {
            onSettled: releaseGate,
            onError: () => {
              // restaura sem clobberar o que o usuário fez enquanto enviava,
              // e recria o preview (o blob URL antigo foi revogado no clear)
              setText(curr => curr || t);
              setReplyTo(curr => curr ?? replySnapshot);
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
        setReplyTo(null);
        forceScrollRef.current = true;
        send.mutate(
          { text: t, connectionId: connectionId ?? senderRef.current?.id, replyTo: replySnapshot ?? undefined },
          {
            onSettled: releaseGate,
            onError: () => {
              setText(curr => curr || t);
              setReplyTo(curr => curr ?? replySnapshot);
            },
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
      // áudio também pode ser resposta a uma mensagem (o onstop roda fora do render: usa o ref)
      const replySnapshot = replyToRef.current;
      setReplyTo(null);
      forceScrollRef.current = true;
      send.mutate(
        {
          file: blob,
          kind: 'audio',
          fileName,
          connectionId: connectionId ?? senderRef.current?.id,
          replyTo: replySnapshot ?? undefined,
        },
        {
          onError: () => {
            setReplyTo(curr => curr ?? replySnapshot);
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
          {isGroup ? <Users size={15} /> : <MessageCircle size={15} />}
        </span>
        <div className="min-w-0">
          <p className="text-sm font-bold text-slate-900 dark:text-white truncate">
            {isGroup ? data?.conversation?.wa_name || contactName : contact?.name || data?.conversation?.wa_name || 'Contato'}
          </p>
          <p className="text-[11px] text-slate-500">
            {isGroup
              ? `Grupo do WhatsApp${participantsCount ? ` · ${participantsCount} participantes` : ''}`
              : phone}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {data && !data.connected && (
            <span className="text-[11px] text-amber-600 dark:text-amber-400">WhatsApp desconectado</span>
          )}
          {isGroup && (
            <button
              type="button"
              onClick={() => void copyInviteLink()}
              disabled={inviteBusy}
              className="h-8 px-2 inline-flex items-center gap-1.5 rounded-lg text-xs font-bold text-slate-500 dark:text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors disabled:opacity-60"
              title="Copiar o link de convite do grupo"
            >
              {inviteBusy ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />}
              Convite
            </button>
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
        {messages.map((m, i) => (
          <div
            key={m.id}
            ref={el => {
              if (el) msgRefs.current.set(m.id, el);
              else msgRefs.current.delete(m.id);
            }}
          >
            {showConnDividers &&
              (i === 0 || (messages[i - 1].connection_id ?? null) !== (m.connection_id ?? null)) && (
                <div className="flex items-center gap-2 pt-2 pb-1 select-none">
                  <span className="flex-1 h-px bg-slate-200 dark:bg-white/10" />
                  <span className="inline-flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-1 rounded-full bg-sky-50 dark:bg-sky-900/30 text-sky-600 dark:text-sky-300 border border-sky-200/70 dark:border-sky-500/20">
                    <MessageCircle size={11} />
                    via {connLabel(m.connection_id)}
                  </span>
                  <span className="flex-1 h-px bg-slate-200 dark:bg-white/10" />
                </div>
              )}
            <MessageBubble
              m={m}
              searchQuery={activeQuery}
              isCurrentMatch={m.id === currentMatchId}
              contactName={isGroup ? undefined : contact?.name || data?.conversation?.wa_name || undefined}
              onAction={notConnected ? undefined : onBubbleAction}
              quotedOriginal={m.quoted_message_id ? messagesById.get(m.quoted_message_id) ?? null : null}
              onJumpToQuoted={jumpToMessage}
              flash={m.id === flashId}
              senderName={isGroup && m.direction === 'in' ? m.sender_name || m.from_phone || undefined : undefined}
            />
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
              {windowLocked ? 'Reiniciar a conversa com um modelo' : 'Modelos de mensagem'}
            </p>
            {templatesQ.isLoading ? (
              <p className="px-3 py-2 text-sm text-slate-400">Carregando...</p>
            ) : windowLocked ? (
              /* Janela de 24 h fechada: só modelo da API reabre a conversa — um
                 modelo geral sairia como texto e a Meta recusaria */
              apiTemplates.length === 0 ? (
                <p className="px-3 py-2 text-sm text-slate-400">
                  Nenhum modelo aprovado para este número. Crie em Configurações → Modelos (WhatsApp API).
                </p>
              ) : null
            ) : generalTemplates.length === 0 && apiTemplates.length === 0 ? (
              <p className="px-3 py-2 text-sm text-slate-400">
                {senderIsApi
                  ? 'Nenhum modelo ainda. Crie em Modelos (gerais ou do WhatsApp API deste número).'
                  : 'Nenhum modelo geral ainda. Crie em Configurações, aba Modelos.'}
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
            {apiTemplates.length > 0 && (
              <>
                <p
                  className={`px-3 pt-2 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-sky-600 dark:text-sky-400 ${
                    windowLocked ? '' : 'border-t border-slate-100 dark:border-white/10 mt-1'
                  }`}
                >
                  WhatsApp API · aprovados pela Meta
                </p>
                {apiTemplates.map(t => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => pickApiTemplate(t)}
                    className="w-full text-left px-3 py-2 rounded-lg hover:bg-sky-50 dark:hover:bg-sky-900/20 transition-colors"
                  >
                    <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-800 dark:text-slate-100">
                      <span className="truncate">{t.name}</span>
                      {t.buttons && t.buttons.length > 0 && (
                        <span className="shrink-0 text-[9px] font-bold uppercase px-1 py-0.5 rounded bg-sky-100 dark:bg-sky-900/40 text-sky-600 dark:text-sky-300">
                          {t.buttons.length} botão{t.buttons.length === 1 ? '' : 'es'}
                        </span>
                      )}
                    </span>
                    <span className="block text-xs text-slate-500 dark:text-slate-400 truncate">
                      {t.body}
                    </span>
                  </button>
                ))}
              </>
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

        {/* AGENTE DE IA E ROBÔ. Beta (agentes nativos): faixa só enquanto há algo em
            andamento (pausar/parar/aprovar/cancelar robô); iniciar é pelo botão
            Automações do compositor. Fora do beta: a faixa antiga, só quando um
            agente (externo) já atuou nesta conversa. */}
        {!isGroup && nativeBanner && (aiState || data?.bot) && (
          <ChatAgentBanner
            ai={aiState}
            bot={data?.bot ?? null}
            busy={aiBusy}
            onAction={action => void runAiAction(action)}
          />
        )}
        {!isGroup && !nativeBanner && aiState && aiState.status !== 'stopped' && (
          <div
            className={`flex items-center justify-between gap-2 mb-1.5 px-3 py-1.5 rounded-xl border text-xs ${
              aiState.status === 'active'
                ? 'border-violet-200 dark:border-violet-500/30 bg-violet-50 dark:bg-violet-900/15 text-violet-700 dark:text-violet-300'
                : 'border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-900/15 text-amber-700 dark:text-amber-300'
            }`}
          >
            <span className="inline-flex items-center gap-1.5 font-bold min-w-0">
              <Bot size={13} className="shrink-0" />
              <span className="truncate">
                {aiState.status === 'active'
                  ? 'Agente de IA ativo nesta conversa'
                  : 'Agente de IA pausado (atendimento humano)'}
              </span>
            </span>
            <button
              type="button"
              onClick={() => void toggleAi()}
              disabled={aiBusy}
              title={
                aiState.status === 'active'
                  ? 'Pausar o agente: ele para de responder este contato até você retomar'
                  : 'Retomar: o agente volta a responder este contato'
              }
              className={`shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-colors disabled:opacity-60 ${
                aiState.status === 'active'
                  ? 'border-violet-300 dark:border-violet-500/40 bg-white dark:bg-black/20 hover:bg-violet-100 dark:hover:bg-violet-900/30'
                  : 'border-amber-300 dark:border-amber-500/40 bg-white dark:bg-black/20 hover:bg-amber-100 dark:hover:bg-amber-900/30'
              }`}
            >
              {aiBusy ? (
                <Loader2 size={12} className="animate-spin" />
              ) : aiState.status === 'active' ? (
                <Pause size={12} />
              ) : (
                <Play size={12} />
              )}
              {aiState.status === 'active' ? 'Pausar' : 'Retomar'}
            </button>
            <button
              type="button"
              onClick={() => void runAiAction('stop')}
              disabled={aiBusy}
              title="Parar de vez: o agente sai desta conversa e só volta se alguém retomar na mão"
              className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold border border-red-300 dark:border-red-500/40 bg-white dark:bg-black/20 text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors disabled:opacity-60"
            >
              <Square size={12} />
              Parar
            </button>
          </div>
        )}

        {/* API oficial DENTRO da janela de 24 h: quanto falta pra fechar (o
            relógio atualiza a cada 30 s). Âmbar na última hora. */}
        {senderIsMeta && win.open && (
          <div
            title="Regra do WhatsApp: a API oficial só aceita mensagem livre por 24 h contadas da última mensagem recebida do contato. Depois disso, só um modelo aprovado reabre a conversa."
            className={`flex items-center gap-1.5 mb-1.5 px-3 py-1.5 rounded-xl border text-xs ${
              win.remainingMs < 60 * 60 * 1000
                ? 'border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-900/15 text-amber-700 dark:text-amber-300'
                : 'border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/20 text-slate-500 dark:text-slate-400'
            }`}
          >
            <Clock size={13} className="shrink-0" />
            <span className="truncate">Janela de 24 h aberta: fecha em {formatRemaining(win.remainingMs)}</span>
          </div>
        )}

        {/* Por QUAL número esta mensagem sai — colado no campo de texto pra
            não restar dúvida. Preso a um número (página Chats): rótulo fixo;
            visão unificada com 2+ números: seletor (menu abre pra cima). */}
        {activeSender &&
          (connectionId ||
            senders.length > 1 ||
            (!!senderId && senderId !== activeSender.id)) && (
          <div className="flex items-center gap-1.5 pb-1.5 px-0.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Enviando por
            </span>
            {connectionId ? (
              <span className="inline-flex items-center gap-1.5 text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400">
                <MessageCircle size={11} />
                {activeSender.phoneNumber || activeSender.profileName || 'Número'}
              </span>
            ) : (
              <div ref={senderMenuRef} className="relative">
                <button
                  type="button"
                  onClick={() => setSenderMenuOpen(o => !o)}
                  aria-expanded={senderMenuOpen}
                  className="inline-flex items-center gap-1.5 text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 transition-colors"
                  title="Trocar o número que envia"
                >
                  <MessageCircle size={11} />
                  {activeSender.phoneNumber || activeSender.profileName || 'Número'}
                  <ChevronDown
                    size={12}
                    className={`transition-transform ${senderMenuOpen ? 'rotate-180' : ''}`}
                  />
                </button>
                {senderMenuOpen && (
                  <div className="absolute left-0 bottom-full mb-1.5 z-20 w-64 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-dark-card p-1.5 shadow-lg">
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
          </div>
        )}

        {/* RESPONDENDO A: citação armada acima do campo (Esc ou × cancela) */}
        {replyTo && !recording && !voiceNote && !pendingTemplate && !windowLocked && (
          <div className="mb-2 flex items-stretch gap-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/20 overflow-hidden">
            <span className={`w-1 shrink-0 ${replyTo.direction === 'out' ? 'bg-emerald-500' : 'bg-sky-500'}`} />
            <button
              type="button"
              onClick={() => jumpToMessage(replyTo.id)}
              className="min-w-0 flex-1 py-1.5 text-left"
              title="Ir para a mensagem"
            >
              <p
                className={`text-[11px] font-bold ${
                  replyTo.direction === 'out' ? 'text-emerald-600 dark:text-emerald-400' : 'text-sky-600 dark:text-sky-400'
                }`}
              >
                Respondendo a {replyTo.direction === 'out' ? 'você' : replyTo.sender_name || contactName}
              </p>
              <p className="text-xs text-slate-600 dark:text-slate-300 truncate">{quotedPreviewText(replyTo)}</p>
            </button>
            {replyTo.media_url && (replyTo.media_type === 'image' || replyTo.media_type === 'sticker') && (
              // eslint-disable-next-line @next/next/no-img-element -- miniatura da URL assinada do Storage
              <img src={replyTo.media_url} alt="" className="h-12 w-12 object-cover shrink-0" />
            )}
            <button
              type="button"
              onClick={() => setReplyTo(null)}
              className="shrink-0 px-2.5 text-slate-400 hover:text-red-500 transition-colors"
              aria-label="Cancelar resposta"
              title="Cancelar resposta (Esc)"
            >
              <X size={16} />
            </button>
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
        ) : pendingTemplate ? (
          /* Modelo da API armado: prévia preenchida + Enviar (sai como template) */
          <div className="rounded-xl border border-sky-200 dark:border-sky-500/30 bg-sky-50 dark:bg-sky-900/15 p-3">
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-sky-700 dark:text-sky-300">
                <ClipboardList size={13} /> Modelo: {pendingTemplate.name}
              </span>
              <button
                type="button"
                onClick={() => setPendingTemplate(null)}
                className="text-slate-400 hover:text-red-500 p-1 rounded"
                aria-label="Cancelar modelo"
                title="Cancelar"
              >
                <X size={15} />
              </button>
            </div>
            <p className="text-sm text-slate-800 dark:text-slate-100 whitespace-pre-wrap break-words">
              {fillTemplate(pendingTemplate.body, templateEffective)}
            </p>
            {templateVarKeys.length > 0 && (
              <div className="mt-2 space-y-1">
                <p className="text-[10px] font-bold uppercase tracking-wider text-sky-700/80 dark:text-sky-300/80">
                  Variáveis do modelo (confira ou preencha)
                </p>
                {templateVarKeys.map(key => {
                  const bare = key.replace(/[{}]/g, '');
                  const label = TEMPLATE_VARIABLES.find(v => v.key === key)?.label ?? bare;
                  const missing = !(templateEffective[bare] ?? '').trim();
                  return (
                    <label key={key} className="flex items-center gap-2 text-xs">
                      <span className="w-36 shrink-0 text-slate-600 dark:text-slate-300 truncate" title={key}>
                        {label}
                      </span>
                      <input
                        value={templateOverrides[bare] ?? templateValues[bare] ?? ''}
                        onChange={e => setTemplateOverrides(o => ({ ...o, [bare]: e.target.value }))}
                        placeholder={missing ? 'Preencha' : ''}
                        className={`flex-1 min-w-0 px-2 py-1 rounded-lg border bg-white dark:bg-black/20 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500 ${
                          missing ? 'border-amber-400 dark:border-amber-500/60' : 'border-sky-200 dark:border-sky-500/30'
                        }`}
                      />
                    </label>
                  );
                })}
                {templateMissing && (
                  <p className="text-[11px] text-amber-700 dark:text-amber-300">
                    O CRM não achou o valor de alguma variável: preencha à mão para enviar.
                  </p>
                )}
              </div>
            )}
            {pendingTemplate.buttons && pendingTemplate.buttons.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {pendingTemplate.buttons.map((b, i) => (
                  <span
                    key={i}
                    className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-white dark:bg-black/20 border border-sky-200 dark:border-sky-500/30 text-sky-700 dark:text-sky-300"
                    title={TEMPLATE_BUTTON_LABEL[b.type]}
                  >
                    {b.text}
                  </span>
                ))}
              </div>
            )}
            <div className="flex items-center justify-between gap-2 mt-2">
              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                Vai como modelo aprovado da Meta (funciona fora da janela de 24h).
              </span>
              <button
                type="button"
                onClick={sendPendingTemplate}
                disabled={send.isPending || templateMissing}
                title={templateMissing ? 'Preencha as variáveis em branco antes de enviar' : undefined}
                className="shrink-0 h-9 px-4 inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-bold"
              >
                {send.isPending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />} Enviar modelo
              </button>
            </div>
          </div>
        ) : windowLocked ? (
          /* API oficial FORA da janela de 24 h: sem texto/anexo/áudio; só um
             modelo aprovado reabre a conversa (o popover lista só os da API) */
          <div className="rounded-xl border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-900/15 p-3">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-300">
              <Lock size={13} /> Janela de 24 h encerrada
            </span>
            <p className="mt-1 text-sm text-slate-700 dark:text-slate-200">
              {lastInboundAt
                ? 'O contato não manda mensagem há mais de 24 h.'
                : 'O contato ainda não mandou nenhuma mensagem.'}{' '}
              Pela regra do WhatsApp, só dá para retomar a conversa enviando um modelo aprovado. Quando ele
              responder, o chat abre de novo.
            </p>
            <div className="flex items-center justify-end gap-2 mt-2">
              {/* Fora da janela dá para iniciar um robô/agente: se o primeiro passo
                  for um Modelo de mensagem, ele reabre a conversa sozinho. */}
              {!isGroup && waBeta.agentsApproved && data?.conversation && (
                <AutomationsMenu
                  open={automationsOpen}
                  onOpenChange={open => {
                    setAutomationsOpen(open);
                    if (open) {
                      setEmojiOpen(false);
                      setAttachMenuOpen(false);
                      setTemplatesOpen(false);
                    }
                  }}
                  agents={agentsMinimal?.agents ?? []}
                  bots={(botsMinimal?.bots ?? []).filter(
                    b => b.connection_ids.length === 0 || !connectionId || b.connection_ids.includes(connectionId)
                  )}
                  ai={aiState}
                  bot={data?.bot ?? null}
                  busy={aiBusy}
                  hasHistory={!!aiState || (data?.messages?.length ?? 0) > 0}
                  onStart={(kind, id, context) => void runAiAction(kind === 'agent' ? 'start' : 'start_bot', id, context)}
                  onResetMemory={() => void runAiAction('reset_memory')}
                />
              )}
              <button
                type="button"
                onClick={() => {
                  setTemplatesOpen(o => !o);
                  setEmojiOpen(false);
                  setAttachMenuOpen(false);
                }}
                className="shrink-0 h-9 px-4 inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold transition-colors"
              >
                <ClipboardList size={15} /> Reiniciar com um modelo
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-end gap-1.5">
            <button
              type="button"
              onClick={() => {
                setEmojiOpen(o => !o);
                setAttachMenuOpen(false);
                setTemplatesOpen(false);
                setAutomationsOpen(false);
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
                setAutomationsOpen(false);
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
                setAutomationsOpen(false);
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
            {/* AUTOMAÇÕES (beta): iniciar um agente de IA ou um robô nesta conversa, com
                contexto adicional opcional; também "Limpar memória do agente" */}
            {!isGroup && waBeta.agentsApproved && data?.conversation && (
              <AutomationsMenu
                open={automationsOpen}
                onOpenChange={open => {
                  setAutomationsOpen(open);
                  if (open) {
                    setEmojiOpen(false);
                    setAttachMenuOpen(false);
                    setTemplatesOpen(false);
                  }
                }}
                agents={agentsMinimal?.agents ?? []}
                bots={(botsMinimal?.bots ?? []).filter(
                  // O robô é exclusivo dos números dele: numa conversa de outro número não aparece
                  b => b.connection_ids.length === 0 || !connectionId || b.connection_ids.includes(connectionId)
                )}
                ai={aiState}
                bot={data?.bot ?? null}
                busy={aiBusy}
                hasHistory={!!aiState || (data?.messages?.length ?? 0) > 0}
                onStart={(kind, id, context) => void runAiAction(kind === 'agent' ? 'start' : 'start_bot', id, context)}
                onResetMemory={() => void runAiAction('reset_memory')}
              />
            )}
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
              ref={textareaRef}
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

      {/* ENCAMINHAR: escolhe um ou mais contatos/conversas e reenvia */}
      {forwardMsg && (
        <ForwardMessageModal
          messages={[forwardMsg]}
          defaultConnectionId={connectionId ?? activeSender?.id ?? null}
          senders={senders}
          onClose={() => {
            setForwardMsg(null);
            // parte pode ter saído antes de uma falha: atualiza os chats abertos
            void qc.invalidateQueries({ queryKey: ['waChat'] });
          }}
          onDone={result => {
            setForwardMsg(null);
            const okCount = result.results.filter(r => r.ok).length;
            showToast(
              okCount <= 1 ? 'Mensagem encaminhada' : `Mensagem encaminhada para ${okCount} contatos`,
              'success'
            );
            void qc.invalidateQueries({ queryKey: ['waChat'] });
          }}
        />
      )}
    </div>
  );
}
