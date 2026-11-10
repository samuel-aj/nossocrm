import type { ReplySegment } from './replyOutput';
import type { AgentMediaKind, AgentMediaRow } from './types';

const kinds: Record<string, AgentMediaKind> = {
  audio: 'audio', voz: 'audio', video: 'video', imagem: 'image', foto: 'image',
  documento: 'document', arquivo: 'document',
};
const marker = /(?<!\[)\[\s*(?:([aá]udio)\s*\]([\s\S]*?)\[\s*\/[aá]udio|([aá]udio|voz|v[ií]deo|imagem|foto|documento|arquivo))\s*\](?!\])/giu;
type Slot = { kind: 'placeholder'; mediaKind: AgentMediaKind; step?: number };

/** Templates define spoken words. Bare model markers request an actual media tool. */
export function planMediaMarkers(segments: ReplySegment[], media: AgentMediaRow[], clips: string[]) {
  const parts: (ReplySegment | Slot)[] = [];
  const existing = new Set<AgentMediaKind>();
  const requested = new Set<AgentMediaKind>();
  let matched = false;
  for (const segment of segments) {
    if (segment.kind === 'media') {
      const kind = media.find(item => item.name === segment.name)?.kind;
      if (kind) existing.add(kind);
    } else if (segment.voice) existing.add('audio');
    const raw = segment.kind === 'text' ? segment.text : segment.caption ?? '';
    const matches = [...raw.normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g, '').matchAll(marker)];
    if (!matches.length) { parts.push(segment); continue; }
    matched = true;
    let cursor = 0;
    const full = matches[0].input!;
    let caption = '';
    const appendText = (text: string) => {
      if (segment.kind === 'media') caption += text;
      else if (text.trim()) parts.push({ ...segment, text: text.trim() });
    };
    for (const match of matches) {
      appendText(full.slice(cursor, match.index));
      cursor = match.index! + match[0].length;
      if (match[1]) {
        const speech = match[2].trim();
        if (!clips.includes(speech)) throw new Error('Trecho de voz fora do roteiro cadastrado.');
        parts.push({ kind: 'text', text: speech, voice: true, step: segment.step });
        existing.add('audio');
      } else {
        const key = match[3].normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
        const mediaKind = kinds[key];
        requested.add(mediaKind);
        parts.push({ kind: 'placeholder', mediaKind, step: segment.step });
      }
    }
    appendText(full.slice(cursor));
    if (segment.kind === 'media') parts.push({ ...segment, caption: caption.trim() || undefined });
  }
  const missing = [...requested].filter(kind => !existing.has(kind));
  return {
    matched, missing,
    resolve(recovered: Map<AgentMediaKind, ReplySegment>) {
      const used = new Set<AgentMediaKind>();
      return parts.flatMap((part): ReplySegment[] => {
        if (part.kind !== 'placeholder') return [part];
        if (existing.has(part.mediaKind) || used.has(part.mediaKind)) return [];
        const replacement = recovered.get(part.mediaKind);
        if (!replacement) throw new Error('A ferramenta não preparou a mídia solicitada.');
        used.add(part.mediaKind);
        return [{ ...replacement, step: part.step }];
      });
    },
  };
}
