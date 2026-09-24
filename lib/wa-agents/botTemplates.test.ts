import { describe, expect, it } from 'vitest';
import { BotInputSchema } from './types';
import { createBotTemplate, parseBotTemplate, applyBotTemplate, pendingBotBindings } from './botTemplates';
const sourceId = '11111111-1111-4111-8111-111111111111';
const targetId = '22222222-2222-4222-8222-222222222222';
const bot = () => BotInputSchema.parse({ name: 'Fluxo', enabled: true, connection_id: sourceId, connection_ids: [sourceId], trigger: { type: 'manual' }, start_step_id: 'condition', steps: [
  { id: 'condition', type: 'condition', rules: [{ clauses: [{ field: 'stage', op: 'equals', value: sourceId }], goto_step_id: 'message' }], else_step_id: 'end', ui: { x: 1, y: 2 } },
  { id: 'message', type: 'send_template', template_id: sourceId, buttons: ['Sim'], button_step_ids: ['end'], on_timeout_step_id: 'end' },
  { id: 'end', type: 'end' },
], layout: { groups: [{ id: 'group', name: 'Início', x: 20, y: 30, step_ids: ['condition'] }] } });
describe('portable bot templates', () => {
  it('roundtrips branches and layout without source resource IDs; copies stay disabled and independent', () => {
    const template = parseBotTemplate(JSON.parse(JSON.stringify(createBotTemplate(bot()))));
    expect(JSON.stringify(template)).not.toContain(sourceId);
    const copy = applyBotTemplate(template, Object.fromEntries(template.dependencies.map(d => [d.ref, targetId])));
    expect(copy.enabled).toBe(false);
    expect(copy.layout).toEqual(bot().layout);
    expect(copy.steps[0]).toMatchObject({ else_step_id: 'end', rules: [{ goto_step_id: 'message', clauses: [{ value: targetId }] }] });
    copy.steps.pop(); expect(template.bot.steps).toHaveLength(3);
    expect(pendingBotBindings(copy)).toEqual([]);
  });
  it('removes webhook URL credentials, payload and secret', () => {
    const source = bot(); source.steps.push({ id: 'hook', type: 'webhook', url: 'https://example.com/private?token=secret-token', secret: 'secret-password', body_template: '{"Authorization":"Bearer secret-bearer"}' });
    const template = createBotTemplate(source);
    expect(JSON.stringify(template)).not.toMatch(/secret-token|secret-password|secret-bearer|example.com/);
    expect(pendingBotBindings(applyBotTemplate(template, {})).length).toBeGreaterThan(0);
  });
  it('abstracts owners, custom fields, other bots, agents, trigger resources and legacy stages', () => {
    const source = bot(); source.trigger = { type: 'deal_stage_entered', board_id: sourceId, stage_id: sourceId, connection_id: sourceId };
    source.steps.push(
      { id: 'owner', type: 'update_lead', changes: [{ field: 'owner_id', mode: 'replace', value: sourceId }, { field: 'custom_field', key: 'documento', mode: 'replace', value: '{{campos.documento}}' }] },
      { id: 'bot', type: 'start_bot', bot_id: sourceId },
      { id: 'agent', type: 'handoff_agent', agent_id: sourceId },
      { id: 'legacy', type: 'condition', rules: [{ kind: 'stage_is', stage_id: sourceId, match: 'all', clauses: [], keywords: [], goto_step_id: 'end' }] },
      { id: 'text', type: 'send_text', text: '{{deal.custom_fields.documento}} https://files.test/file?signature=private-secret' },
    );
    const template = createBotTemplate(source);
    expect(JSON.stringify(template)).not.toMatch(/private-secret|documento|11111111-1111/);
    const copy = applyBotTemplate(template, Object.fromEntries(template.dependencies.map(d => [d.ref, d.kind === 'custom_field' ? 'documento_destino' : targetId])));
    expect(copy.steps.find(s => s.id === 'owner')).toMatchObject({ changes: [{ value: targetId }, { key: 'documento_destino', value: '{{campos.documento_destino}}' }] });
    expect(pendingBotBindings(copy)).toContain('URL removida: revise os textos do fluxo');
    expect(copy.trigger).toMatchObject({ board_id: targetId, stage_id: targetId, connection_id: targetId });
  });
  it('rejects invalid version, oversized JSON, orphan edges and forged manifests', () => {
    const template = createBotTemplate(bot());
    expect(() => parseBotTemplate({ ...template, version: 90 })).toThrow();
    expect(() => parseBotTemplate({ ...template, junk: 'x'.repeat(1_050_000) })).toThrow();
    expect(() => parseBotTemplate({ ...template, dependencies: [] })).toThrow();
    template.bot.steps[0].next_step_id = 'missing';
    expect(() => parseBotTemplate(template)).toThrow();
  });
});

it('exports and imports recovery alert blocks without adding resource dependencies', () => {
  const source = bot();
  source.steps.push({ id: 'alert', type: 'activate_alert', message: 'Respondeu à recuperação', next_step_id: 'end' });
  const template = parseBotTemplate(JSON.parse(JSON.stringify(createBotTemplate(source))));
  const copy = applyBotTemplate(template, Object.fromEntries(template.dependencies.map(d => [d.ref, targetId])));
  expect(copy.steps.find(s => s.id === 'alert')).toMatchObject({ type: 'activate_alert', message: 'Respondeu à recuperação', next_step_id: 'end' });
});
