import { quotedPreviewText, type QuotedSnapshot } from '@/lib/whatsapp/quote';
import type { WaChatMessage } from './useWhatsAppChat';

export interface QuotedBlockProps {
  q: QuotedSnapshot;
  isOut: boolean;
  contactName?: string;
  isGroup?: boolean;
  original: WaChatMessage | null;
  onJump?: () => void;
}

/** Stored snapshot keeps this preview useful when the original is outside the loaded page. */
export function QuotedBlock({ q, isOut, contactName, isGroup, original, onJump }: QuotedBlockProps) {
  const mine = q.direction === 'out';
  const deleted = !!(q.deleted || original?.deleted_at);
  const title = mine
    ? 'Você'
    : q.sender_name || original?.sender_name || (q.direction === 'in'
      ? isGroup ? 'Participante' : contactName || 'Contato'
      : 'Mensagem');
  const thumb = !deleted && original?.media_url && (original.media_type === 'image' || original.media_type === 'sticker')
    ? original.media_url
    : null;
  const jump = !deleted ? onJump : undefined;
  return (
    <div
      role={jump ? 'button' : undefined}
      tabIndex={jump ? 0 : undefined}
      onClick={jump}
      onKeyDown={e => {
        if (jump && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          jump();
        }
      }}
      title={jump ? 'Ir para a mensagem original' : undefined}
      className={`mb-1.5 flex items-stretch gap-2 rounded-lg overflow-hidden border-l-4 ${
        mine ? 'border-emerald-300' : 'border-sky-400'
      } ${isOut ? 'bg-black/15' : 'bg-slate-100 dark:bg-white/10'} ${
        jump ? 'cursor-pointer hover:brightness-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400' : ''
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
          {deleted ? 'Mensagem indisponível' : quotedPreviewText(q)}
        </p>
      </div>
      {thumb && (
        // eslint-disable-next-line @next/next/no-img-element -- miniatura da URL assinada do Storage
        <img src={thumb} alt="" className="h-12 w-12 object-cover shrink-0" />
      )}
    </div>
  );
}
