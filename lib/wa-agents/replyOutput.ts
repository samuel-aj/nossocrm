/** Preparation shared by the live agent, its simulator and history filtering. */
import { NO_REPLY_TOKEN } from './savedData';
import { normalizeKeyword } from './text';

export type ReplySegment =
  | { kind: 'text'; text: string; step?: number }
  | { kind: 'media'; name: string; caption?: string; step?: number };
export type OutputIssue = { segment: number; step?: number; field: 'text' | 'caption'; reason: string };

/** Reserved internal envelopes, not arbitrary JSON or ordinary words such as "dados". */
export function internalOutputReason(raw: string): string | null {
  const text = raw.replace(/\\(["'])/g, '$1');
  if (/\{\s*["'“”]?dados["'“”]?\s*:/iu.test(text) || /,\s*["'“”]dados["'“”]\s*:/iu.test(text) ||
      /["'](?:proxima_pergunta|apresentacao_enviada|memoria_desde)["']\s*:/iu.test(text)) return 'internal_data';
  if (/["'](?:tool_calls?|tool_results?|function_call|replacements)["']\s*:/iu.test(text) ||
      /\b(?:salvar_dados|encerrar_atendimento|executar_acao|enviar_midia|consultar_agente|consultar_documentos)\s*\(/iu.test(text) ||
      /["'](?:name|tool|toolName)["']\s*:\s*["'](?:salvar_dados|encerrar_atendimento|executar_acao|enviar_midia|calcular|consultar_agente|consultar_documentos)["']/iu.test(text)) return 'tool_call';
  if (/<<<\s*(?:dados|fim(?: dos dados)?)\s*>>>|<\/?(?:tool_call|tool_result|function_call)>|(?:^|\n)\s*#{0,3}\s*INSTRUÇÕES DO SISTEMA\b/iu.test(text)) return 'internal_marker';
  return null;
}

export function segmentText(seg: ReplySegment): string {
  return seg.kind === 'text' ? cleanText(seg.text) : '';
}

function cleanText(text: string): string {
  return text.split(NO_REPLY_TOKEN).join('').trim();
}

/** Never feeds a previously leaked agent envelope back to the model. The stored chat is unchanged. */
export function agentHistoryText(text: string): string {
  return internalOutputReason(text) ? '' : cleanText(text);
}

export function prepareReplyOutput(input: readonly ReplySegment[]) {
  const issues: OutputIssue[] = [];
  input.forEach((s, segment) => {
    const field = s.kind === 'text' ? 'text' : 'caption';
    const reason = internalOutputReason(s.kind === 'text' ? s.text : s.caption ?? '');
    if (reason) issues.push({ segment, step: s.step, field, reason });
  });
  // Validate the entire draft before allowing even its first otherwise-valid line out.
  if (issues.length > 0) return { segments: [] as ReplySegment[], text: '', issues, duplicatesRemoved: 0 };

  const captions = new Set(input.flatMap(s => s.kind === 'media' && s.caption ? [normalizeKeyword(cleanText(s.caption))] : []));
  const seen = new Set<string>();
  const segments: ReplySegment[] = [];
  let duplicatesRemoved = 0;
  for (const segment of input) {
    if (segment.kind === 'media') {
      segments.push({ ...segment, caption: segment.caption ? cleanText(segment.caption) : undefined });
      continue;
    }
    const kept: string[] = [];
    for (const raw of cleanText(segment.text).replace(/\r\n?/g, '\n').split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      // Preserve case, accents, numbers and punctuation: only whitespace differs.
      const key = line.normalize('NFC').replace(/\s+/g, ' ');
      if (seen.has(key) || captions.has(normalizeKeyword(line))) {
        duplicatesRemoved++;
        continue;
      }
      seen.add(key);
      kept.push(line);
    }
    if (kept.length === 0) continue;
    const text = kept.join('\n');
    const previous = segments.at(-1);
    if (previous?.kind === 'text') previous.text += '\n' + text;
    else segments.push({ kind: 'text', text, step: segment.step });
  }
  return { segments, text: segments.map(segmentText).filter(Boolean).join('\n'), issues, duplicatesRemoved };
}
