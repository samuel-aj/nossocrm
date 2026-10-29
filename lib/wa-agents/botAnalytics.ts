import type { BotAnalyticsResult } from '@/features/wa-agents/analytics/types';

type Step = {
  id: string; type: string; next_step_id?: string | null; on_timeout_step_id?: string | null;
  else_step_id?: string | null; buttons?: string[] | null; button_step_ids?: Array<string | null> | null;
  rules?: Array<{ label?: string; goto_step_id: string }> | null;
  branches?: Array<{ id: string; label: string; goto_step_id: string | null }> | null;
};
export type RawBotAnalytics = Pick<BotAnalyticsResult, 'botId' | 'botUpdatedAt' | 'asOf' | 'measurementStartedAt' | 'legacyRuns' | 'selectedRevision' | 'isCurrentRevision' | 'revisions' | 'summary' | 'goalStepId'> & {
  steps: Step[];
  groups: Array<{ id: string; name: string; step_ids: string[] }>;
  stepCounts: Array<{ step_id: string; entered: number; failed: number; skipped: number; waiting: number }>;
  outputCounts: Array<{ step_id: string; output_id: string; n: number }>;
  groupCounts: Array<{ id: string; n: number }>;
  variantCounts: Array<{ step_id: string; branch_id: string; subjects: number; converted: number | null }>;
};
const labels: Record<string, string> = {
  send_text: 'Mensagem', send_template: 'Modelo de mensagem', wait: 'Esperar', wait_reply: 'Esperar resposta',
  typing: 'Digitando', condition: 'Condição', split: 'Distribuir caminhos', move_stage: 'Mover etapa',
  create_lead: 'Criar lead', update_lead: 'Editar lead', add_tag: 'Adicionar tag', remove_tag: 'Remover tag',
  activate_alert: 'Ativar alerta', webhook: 'Webhook', start_bot: 'Iniciar outro robô', handoff_agent: 'Entregar a agente', end: 'Encerrar',
};
const percent = (count: number, base: number) => base > 0 ? Math.round(count / base * 1000) / 10 : 0;

function outputDefinitions(step: Step): Array<{ id: string; label: string; targetStepId: string | null }> {
  if (step.type === 'split') return (step.branches ?? []).map(b => ({ id: `branch:${b.id}`, label: b.label, targetStepId: b.goto_step_id }));
  if (step.type === 'condition') return [
    ...(step.rules ?? []).map((r, i) => ({ id: `rule:${i}`, label: r.label || `Caminho ${i + 1}`, targetStepId: r.goto_step_id })),
    { id: 'else', label: 'Senão', targetStepId: step.else_step_id ?? null },
  ];
  if (step.type === 'send_template' || step.type === 'wait_reply') return [
    ...(step.buttons ?? []).map((label, i) => ({ id: `button:${i}`, label, targetStepId: step.button_step_ids?.[i] ?? null })),
    { id: 'next', label: step.type === 'send_template' ? 'Outra resposta' : 'Respondeu', targetStepId: step.next_step_id ?? null },
    { id: 'timeout', label: 'Sem resposta', targetStepId: step.on_timeout_step_id ?? null },
  ];
  if (['end', 'handoff_agent', 'start_bot'].includes(step.type)) return [{ id: 'done', label: 'Concluído', targetStepId: null }];
  return [{ id: 'next', label: 'Depois', targetStepId: step.next_step_id ?? null }];
}

/** Only aggregated counts and graph labels leave the server. No run identifiers or content. */
export function presentBotAnalytics(raw: RawBotAnalytics): BotAnalyticsResult {
  const counts = new Map(raw.stepCounts.map(s => [s.step_id, s]));
  const groups = new Map(raw.groupCounts.map(g => [g.id, Number(g.n)]));
  const steps = raw.steps.map((s, i) => {
    const group = raw.groups.find(g => g.step_ids.includes(s.id));
    const label = `${group?.name || `Bloco ${i + 1}`} · ${labels[s.type] || s.type}`;
    const count = counts.get(s.id);
    const entered = Number(count?.entered ?? 0);
    return { id: s.id, type: s.type, label, entered, percent: percent(entered, raw.summary.runs),
      failed: Number(count?.failed ?? 0), skipped: Number(count?.skipped ?? 0), waiting: Number(count?.waiting ?? 0),
      outputs: outputDefinitions(s).map(output => {
        const count = Number(raw.outputCounts.find(c => c.step_id === s.id && c.output_id === output.id)?.n ?? 0);
        return { ...output, count, percent: percent(count, entered) };
      }),
    };
  });
  return {
    botId: raw.botId, botUpdatedAt: raw.botUpdatedAt, asOf: raw.asOf, measurementStartedAt: raw.measurementStartedAt, legacyRuns: Number(raw.legacyRuns),
    selectedRevision: raw.selectedRevision, isCurrentRevision: raw.isCurrentRevision, revisions: raw.revisions,
    summary: raw.summary, steps,
    groups: raw.groups.map(g => ({ id: g.id, label: g.name || 'Balão', entered: groups.get(g.id) ?? 0, percent: percent(groups.get(g.id) ?? 0, raw.summary.runs) })),
    variants: raw.steps.filter(s => s.type === 'split').flatMap(s => (s.branches ?? []).map(b => {
      const count = raw.variantCounts.find(v => v.step_id === s.id && v.branch_id === b.id);
      const subjects = Number(count?.subjects ?? 0);
      const converted = raw.goalStepId ? Number(count?.converted ?? 0) : null;
      return { stepId: s.id, branchId: b.id, label: b.label, subjects, converted, rate: converted === null ? null : percent(converted, subjects) };
    })),
    goalStepId: raw.goalStepId,
    goalOptions: steps.filter(s => s.type !== 'split').map(s => ({ id: s.id, label: s.label })),
  };
}
