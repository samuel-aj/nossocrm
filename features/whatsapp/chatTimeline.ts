import { Activity, Board } from '@/types';

/**
 * Evento da timeline do lead exibido DENTRO do chat, intercalado com as
 * mensagens por data (estilo Kommo): mudanças de etapa, notas e atividades
 * viram linhas compactas que dividem a conversa em blocos.
 */
export interface ChatTimelineEvent {
  id: string;
  /** ISO usado pra intercalar com o created_at das mensagens */
  at: string;
  kind: 'status' | 'note' | 'activity';
  text: string;
  /** Complemento opcional (conteúdo da nota, motivo da perda) */
  detail?: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Espelho do translateStatus do ActivityRow: acha a etapa pelo id em
// qualquer board (títulos antigos gravam o uuid da etapa)
function stageLabel(status: string, boards: Board[]): string {
  if (!UUID_RE.test(status)) return status;
  for (const b of boards || []) {
    const stage = b.stages.find(s => s.id === status);
    if (stage) return stage.label;
  }
  return 'outra etapa';
}

const ACTIVITY_LABEL: Record<string, string> = {
  CALL: 'Ligação',
  MEETING: 'Reunião',
  EMAIL: 'E-mail',
  TASK: 'Tarefa',
};

/**
 * Converte as atividades do lead nos eventos compactos do chat, em ordem
 * cronológica crescente (mesma ordem das mensagens).
 */
export function buildChatTimelineEvents(
  activities: Activity[],
  dealId: string | null | undefined,
  boards: Board[]
): ChatTimelineEvent[] {
  if (!dealId) return [];
  const out: ChatTimelineEvent[] = [];
  for (const a of activities) {
    if (a.dealId !== dealId) continue;
    if (a.type === 'STATUS_CHANGE') {
      let text = a.title;
      if (a.title.startsWith('Moveu para ')) {
        text = `Movido para ${stageLabel(a.title.slice('Moveu para '.length), boards)}`;
      } else if (a.title === 'Negócio Criado') {
        text = 'Negócio criado';
      }
      out.push({ id: a.id, at: a.date, kind: 'status', text, detail: a.description || undefined });
    } else if (a.type === 'NOTE') {
      out.push({ id: a.id, at: a.date, kind: 'note', text: 'Nota', detail: a.description || a.title });
    } else {
      out.push({
        id: a.id,
        at: a.date,
        kind: 'activity',
        text: `${ACTIVITY_LABEL[a.type] ?? 'Atividade'}: ${a.title}`,
      });
    }
  }
  out.sort((x, y) => new Date(x.at).getTime() - new Date(y.at).getTime());
  return out;
}
