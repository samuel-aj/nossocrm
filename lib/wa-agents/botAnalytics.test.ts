import { describe, expect, it } from 'vitest';
import { presentBotAnalytics, type RawBotAnalytics } from './botAnalytics';

export function analyticsFixture(): RawBotAnalytics {
  return {
    botId: 'bot', botUpdatedAt: '2026-10-29T18:00:00Z', asOf: '2026-10-29T18:00:00Z', measurementStartedAt: null, legacyRuns: 15,
    selectedRevision: 'revision', isCurrentRevision: true, revisions: [], goalStepId: 'goal',
    summary: { runs: 200, uniqueSubjects: 180, running: 0, waiting: 6, done: 190, errored: 4, cancelled: 0 },
    steps: [
      { id: 'split', type: 'split', branches: [{ id: 'a', label: 'A', goto_step_id: 'question' }, { id: 'b', label: 'B', goto_step_id: 'question' }] },
      { id: 'question', type: 'send_template', buttons: ['Agendar', 'Não quero'], button_step_ids: ['goal', 'goal'] },
      { id: 'goal', type: 'end' },
    ],
    groups: [{ id: 'g', name: 'Contato', step_ids: ['split', 'question'] }],
    stepCounts: [{ step_id: 'question', entered: 120, failed: 0, skipped: 0, waiting: 6 }],
    outputCounts: [{ step_id: 'question', output_id: 'button:0', n: 72 }, { step_id: 'question', output_id: 'button:1', n: 18 }, { step_id: 'question', output_id: 'timeout', n: 24 }],
    groupCounts: [{ id: 'g', n: 140 }],
    variantCounts: [{ step_id: 'split', branch_id: 'a', subjects: 100, converted: 40 }, { step_id: 'split', branch_id: 'b', subjects: 80, converted: 16 }],
  };
}
describe('presentBotAnalytics', () => {
  it('uses correct denominators and keeps outputs with a common target separate', () => {
    const result = presentBotAnalytics(analyticsFixture());
    expect(result.steps[1]).toMatchObject({ entered: 120, percent: 60, waiting: 6 });
    expect(result.steps[1].outputs.map(o => [o.label, o.count, o.percent])).toEqual([
      ['Agendar', 72, 60], ['Não quero', 18, 15], ['Outra resposta', 0, 0], ['Sem resposta', 24, 20],
    ]);
    expect(result.groups[0]).toMatchObject({ entered: 140, percent: 70 });
    expect(result.variants.map(v => v.rate)).toEqual([40, 20]);
    expect(result.goalOptions.map(g => g.id)).toEqual(['question', 'goal']);
  });
  it('does not invent success before an objective is chosen or leak raw metadata', () => {
    const raw = { ...analyticsFixture(), goalStepId: null, secret: 'private', steps: [{ id: 'split', type: 'split', secret: 'hidden', branches: [{ id: 'a', label: 'A', goto_step_id: null }] }] };
    const result = presentBotAnalytics(raw);
    expect(result.variants[0]).toMatchObject({ converted: null, rate: null });
    expect(JSON.stringify(result)).not.toMatch(/private|hidden|stepCounts|outputCounts/);
  });
  it('renders zero measured runs without NaN or fabricated legacy rates', () => {
    const raw = analyticsFixture(); raw.summary.runs = 0; raw.stepCounts = []; raw.groupCounts = []; raw.outputCounts = []; raw.variantCounts = [];
    const result = presentBotAnalytics(raw);
    expect(result.steps.every(s => s.entered === 0 && s.percent === 0)).toBe(true);
    expect(result.legacyRuns).toBe(15);
    expect(result.measurementStartedAt).toBeNull();
  });
});
