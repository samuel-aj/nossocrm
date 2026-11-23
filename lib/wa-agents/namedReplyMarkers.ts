import type { ModelMessage, ToolSet } from 'ai';
import type { CollectedToolCall } from './replyGeneration';
import { planMediaMarkers } from './mediaMarkers';
import { prepareReplyOutput, type ReplySegment } from './replyOutput';
import { findByName, uniqueNames } from './tools';
import type { AgentMediaRow, AgentRow } from './types';

// Only exact, delimited script references in the assistant's draft are eligible.
// Captions, quoted commands, voice scripts and structured annotations stay in ordinary review.
const reference = /\[\[[ \t]*(enviar_midia|midia|executar_acao|acao)[ \t]*:[ \t]*([^\[\]\r\n]{1,80}?)[ \t]*\]\]/giu;
type Command = { tool: 'enviar_midia' | 'executar_acao'; name: string; step?: number };

export async function recoverNamedReplyMarkers(
  segments: ReplySegment[], previous: CollectedToolCall[], agent: AgentRow, media: AgentMediaRow[],
  tools: ToolSet, messages: ModelMessage[], voiceClips: string[],
): Promise<{ segments: ReplySegment[]; calls: CollectedToolCall[] } | null> {
  const parts: (Command | ReplySegment)[] = [];
  const commands: Command[] = [];
  for (const segment of segments) {
    if (segment.kind !== 'text' || segment.voice) { parts.push(segment); continue; }
    if (!segment.text.includes('[[')) { parts.push(segment); continue; }
    if (/[`{}]|(?:^|\n)\s*>/.test(segment.text)) return null;
    for (const line of segment.text.split(/\r?\n/)) {
      const matches = [...line.matchAll(reference)];
      if (!matches.length) {
        if (line.trim()) parts.push({ ...segment, text: line });
        continue;
      }
      // A natural-language example or quotation must not move a real deal.
      if (line.replace(reference, '').trim()) return null;
      for (const match of matches) {
        const tool = /midia/i.test(match[1]) ? 'enviar_midia' : 'executar_acao';
        const command: Command = { tool, name: match[2].trim(), step: segment.step };
        commands.push(command);
        parts.push(command);
      }
    }
  }
  if (!commands.length) return null;
  // A customer may quote a marker while discussing a problem. Never replay it as a command.
  if (messages.some(m => m.role === 'user' &&
    (typeof m.content === 'string' ? [m.content] : m.content.flatMap(p => p.type === 'text' ? [p.text] : []))
      .some(text => /\[\[\s*(?:enviar_midia|midia|executar_acao|acao)\s*:/iu.test(text)))) return null;
  const prose = parts.filter((p): p is ReplySegment => 'kind' in p);
  if (prepareReplyOutput(planMediaMarkers(prose, media, voiceClips).content).issues.length) return null;

  // Preflight the entire draft before reserving even its first media item.
  const catalog = uniqueNames(media);
  for (const command of commands) {
    if (!tools[command.tool]?.execute) return null;
    if (command.tool === 'enviar_midia') {
      const item = findByName(catalog, command.name);
      if (!item || item.agent_id !== agent.id || item.organization_id !== agent.organization_id) return null;
      command.name = item.name;
    } else {
      const rule = agent.custom_actions.find(action => action.key === command.name);
      // Calls that need business data, knowledge, external effects or a handoff
      // need a native model tool call with its full arguments.
      if (!rule?.actions.length || !rule.actions.every(a => a.type === 'move_stage' || a.type === 'add_tag' || a.type === 'note')) return null;
    }
  }
  const calls: CollectedToolCall[] = [];
  const rebuilt: ReplySegment[] = [];
  for (const part of parts) {
    if ('kind' in part) { rebuilt.push(part); continue; }
    const isMedia = part.tool === 'enviar_midia';
    const field = isMedia ? 'nome' : 'acao';
    const done = [...previous, ...calls].find(c => c.tool === part.tool &&
      (c.input as Record<string, unknown> | undefined)?.[field] === part.name && (c.output as { ok?: boolean } | undefined)?.ok);
    if (done) continue;
    const args = isMedia ? { nome: part.name } : { acao: part.name, detalhes: 'Ação indicada pelo agente na resposta deste turno.' };
    const output = await tools[part.tool].execute!(args, { toolCallId: 'script-' + calls.length, messages }) as { ok?: boolean; ja_enviada?: boolean; midia?: string };
    if (isMedia && output?.ja_enviada) continue;
    if (!output?.ok) throw new Error('A ferramenta não confirmou o marcador da resposta.');
    calls.push({ tool: part.tool, input: args, output });
    if (isMedia) rebuilt.push({ kind: 'media', name: output.midia ?? part.name, step: part.step });
  }
  return { segments: rebuilt, calls };
}
