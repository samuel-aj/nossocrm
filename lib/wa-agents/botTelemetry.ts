import type { SupabaseClient } from '@supabase/supabase-js';
import type { BotRow, BotRunRow, BotStep } from './types';

export type BotEventKind = 'entered' | 'exited' | 'failed' | 'skipped';
export class BotTelemetryError extends Error {}

/** Legacy executions retain their original behavior and never invent old reach metrics. */
export function executionBot(current: BotRow, run: BotRunRow): BotRow {
  if (run.analytics_version !== 1 || !run.flow_snapshot) return current;
  const frozen = run.flow_snapshot;
  return {
    ...current, ...frozen, enabled: current.enabled,
    steps: frozen.steps.map(step => {
      if (step.type !== 'webhook') return step;
      const live = current.steps.find(s => s.id === step.id && s.type === 'webhook');
      return { ...step, secret: live?.type === 'webhook' && live.url === step.url ? live.secret : null };
    }),
  };
}

/** Database deduplicates by run, step and event kind. Retries never add visits. */
export async function recordBotEvent(admin: SupabaseClient, run: BotRunRow, stepId: string,
  kind: BotEventKind, outputId: string | null = null, targetId: string | null = null): Promise<void> {
  if (run.analytics_version !== 1 || !run.flow_revision) return;
  const { error } = await admin.rpc('wa_bot_record_event', {
    p_org: run.organization_id, p_run: run.id, p_step: stepId,
    p_kind: kind, p_output: outputId, p_target: targetId,
  });
  if (error) throw new BotTelemetryError(`Não foi possível registrar o avanço do robô: ${error.message}`);
}

export async function allocateBotBranch(admin: SupabaseClient, run: BotRunRow, step: Extract<BotStep, { type: 'split' }>) {
  if (run.analytics_version !== 1 || !run.flow_snapshot) throw new Error('Distribuição exige uma nova execução do robô');
  const { data, error } = await admin.rpc('wa_bot_allocate_branch', {
    p_org: run.organization_id, p_run: run.id, p_step: step.id,
  });
  if (error) throw new Error(`Falha ao distribuir o caminho: ${error.message}`);
  const branchId = (data as { branch_id?: string } | null)?.branch_id;
  const branch = step.branches.find(b => b.id === branchId);
  if (!branch || !branch.goto_step_id || branch.goto_step_id !== (data as { target_step_id?: string }).target_step_id) {
    throw new Error('Distribuição retornou uma saída inválida');
  }
  return branch;
}
