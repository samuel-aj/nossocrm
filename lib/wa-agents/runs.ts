/**
 * Histórico de execuções dos agentes (wa_ai_agent_runs). Nunca lança.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { RunRow, RunStatus, RunTrigger } from './types';

export type LogRunInput = Partial<RunRow> & {
  organization_id: string;
  trigger: RunTrigger;
  status: RunStatus;
};

function clip(text: string | null | undefined, max: number): string | null {
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** Grava uma execução e devolve o id (null se a gravação falhar). */
export async function logRun(admin: SupabaseClient, row: LogRunInput): Promise<string | null> {
  try {
    const { data, error } = await admin
      .from('wa_ai_agent_runs')
      .insert({
        organization_id: row.organization_id,
        agent_id: row.agent_id ?? null,
        conversation_id: row.conversation_id ?? null,
        trigger: row.trigger,
        status: row.status,
        reason: clip(row.reason, 500),
        input_text: clip(row.input_text, 20000),
        output_text: clip(row.output_text, 20000),
        tool_calls: row.tool_calls ?? [],
        events: row.events ?? [],
        usage: row.usage ?? null,
        model: row.model ?? null,
        duration_ms: row.duration_ms ?? null,
        error: clip(row.error, 2000),
      })
      .select('id')
      .single();
    if (error) {
      console.error('[wa-agents] falha ao gravar execução:', error.message);
      return null;
    }
    return (data as { id: string }).id;
  } catch (e) {
    console.error('[wa-agents] falha ao gravar execução:', (e as Error).message);
    return null;
  }
}
