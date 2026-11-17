import type { ReplySegment } from './replyOutput';
export const VOICE_NOTICE = 'A voz que você vai ouvir é gerada por inteligência artificial.';

/** A scripted voice clip defines the format of its turn. The remaining text stays written. */
export function voiceDelivery(segments: readonly ReplySegment[], mirrorAudio: boolean): ReplySegment[] {
  if (!mirrorAudio || segments.some(s => s.kind === 'text' && s.voice)) return [...segments];
  return segments.flatMap((segment): ReplySegment[] => {
    if (segment.kind !== 'text') return [segment];
    return segment.text.split(/((?:https?:\/\/|www\.)\S+)/gi).flatMap((piece, i) => {
      const text = piece.trim();
      if (!text) return [];
      return [{ ...segment, text, ...(i % 2 === 0 ? { voice: true as const } : {}) }];
    });
  });
}
