import { describe, expect, it, vi } from 'vitest';
import { allocateBotBranch, executionBot, recordBotEvent } from './botTelemetry';
import { BotStepSchema, type BotInput, type BotRow, type BotRunRow } from './types';

const split = { id: 'split', type: 'split', mode: 'random', branches: [
  { id: 'a', label: 'A', weight: 50, goto_step_id: 'a' },
  { id: 'b', label: 'B', weight: 50, goto_step_id: 'b' },
] } as const;
describe('distribution schema and telemetry', () => {
  it('validates 2–20 unique connected-or-draft outputs and random weights', () => {
    expect(BotStepSchema.safeParse(split).success).toBe(true);
    expect(BotStepSchema.safeParse({ ...split, branches: [split.branches[0]] }).success).toBe(false);
    expect(BotStepSchema.safeParse({ ...split, branches: [split.branches[0], split.branches[0]] }).success).toBe(false);
    expect(BotStepSchema.safeParse({ ...split, branches: split.branches.map(b => ({ ...b, weight: 20 })) }).success).toBe(false);
    expect(BotStepSchema.safeParse({ ...split, mode: 'round_robin', branches: split.branches.map(b => ({ ...b, weight: 1 })) }).success).toBe(true);
    expect(BotStepSchema.safeParse({ ...split, branches: split.branches.map(b => ({ ...b, weight: 50.5 })) }).success).toBe(false);
    expect(BotStepSchema.safeParse({ ...split, branches: Array.from({ length: 21 }, (_, i) => ({ ...split.branches[0], id: String(i) })) }).success).toBe(false);
  });
  it('does not infer analytics from legacy execution notes', async () => {
    const rpc = vi.fn();
    await recordBotEvent({ rpc } as never, { id: 'legacy' } as BotRunRow, 'x', 'entered');
    expect(rpc).not.toHaveBeenCalled();
  });
  it('fails explicitly if structured logging fails', async () => {
    const rpc = vi.fn().mockResolvedValue({ error: { message: 'db offline' } });
    await expect(recordBotEvent({ rpc } as never, { id: 'r', analytics_version: 1, flow_revision: 'v' } as BotRunRow, 'x', 'entered')).rejects.toThrow('registrar');
  });
  it('rejects an allocator result that does not belong to the frozen graph', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { branch_id: 'a', target_step_id: 'unrelated' }, error: null });
    await expect(allocateBotBranch({ rpc } as never, { analytics_version: 1, flow_snapshot: {} } as BotRunRow, BotStepSchema.parse(split) as never)).rejects.toThrow('inválida');
  });
  it('freezes actions but retains the live stop switch and never sends a rotated secret to an old URL', () => {
    const frozen = { steps: [{ id: 'w', type: 'webhook', url: 'https://old.test', secret: null }], name: 'Frozen' } as BotInput;
    const current = { enabled: false, name: 'Current', steps: [{ id: 'w', type: 'webhook', url: 'https://new.test', secret: 'new-secret' }] } as BotRow;
    const result = executionBot(current, { analytics_version: 1, flow_snapshot: frozen } as BotRunRow);
    expect(result.name).toBe('Frozen');
    expect(result.enabled).toBe(false);
    expect(result.steps[0]).toMatchObject({ url: 'https://old.test', secret: null });
  });
});
