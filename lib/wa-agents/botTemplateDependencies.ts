import type { BotInput } from './types';

export const DEPENDENCY_KINDS = ['connection', 'board', 'stage', 'message_template', 'agent', 'bot', 'owner', 'custom_field', 'webhook'] as const;
export type DependencyKind = typeof DEPENDENCY_KINDS[number];
export const DEPENDENCY_LABELS: Record<DependencyKind, string> = { connection: 'Número', board: 'Quadro', stage: 'Etapa', message_template: 'Modelo de mensagem', agent: 'Agente', bot: 'Robô', owner: 'Responsável', custom_field: 'Campo personalizado', webhook: 'URL do webhook' };
export type ResourceReference = { kind: DependencyKind; value: string; location: string };
const ID_FIELDS: Record<string, DependencyKind> = { connection_id: 'connection', board_id: 'board', stage_id: 'stage', template_id: 'message_template', agent_id: 'agent', bot_id: 'bot' };
const CUSTOM_VARIABLE = /(\{\{\s*(?:(?:deal|lead|negocio)\.)?(?:custom_fields|campos)\.)([\w-]+)(\s*\}\})/g;

/** All executable resource positions, including legacy conditions and custom field variables. */
export function mapBotResources(bot: BotInput, replace: (ref: ResourceReference) => string): BotInput {
  function visit(value: unknown, path: string): unknown {
    if (Array.isArray(value)) return value.map((v, i) => visit(v, `${path}.${i}`));
    if (!value || typeof value !== 'object') {
      return typeof value === 'string' ? value.replace(CUSTOM_VARIABLE, (_m, a: string, key: string, b: string) => a + replace({ kind: 'custom_field', value: key, location: path }) + b) : value;
    }
    const obj = value as Record<string, unknown>;
    return Object.fromEntries(Object.entries(obj).map(([key, item]) => {
      const location = `${path}.${key}`;
      let kind = ID_FIELDS[key];
      if (key === 'value' && (obj.field === 'stage' || obj.field === 'board')) kind = obj.field;
      if (key === 'value' && obj.field === 'owner_id' && obj.mode !== 'clear') kind = 'owner';
      if (key === 'key' && obj.field === 'custom_field') kind = 'custom_field';
      if (key === 'url' && obj.type === 'webhook') kind = 'webhook';
      if (key === 'connection_ids' && Array.isArray(item)) return [key, item.map((id, i) => replace({ kind: 'connection', value: String(id), location: `${location}.${i}` }))];
      return [key, kind && typeof item === 'string' && item.trim() ? replace({ kind, value: item, location }) : visit(item, location)];
    }));
  }
  return visit(bot, 'bot') as BotInput;
}
export function botResourceReferences(bot: BotInput): ResourceReference[] {
  const refs: ResourceReference[] = [];
  mapBotResources(bot, ref => { refs.push(ref); return ref.value; });
  return refs;
}
export function abstractReference(index: number, kind: DependencyKind): string {
  const id = `eeeeeeee-eeee-4eee-8eee-${String(index + 1).padStart(12, '0')}`;
  return kind === 'webhook' ? `https://configure.invalid/${id}` : id;
}
export function isAbstractReference(value: string): boolean {
  return /^eeeeeeee-eeee-4eee-8eee-\d{12}$/.test(value) || value.startsWith('https://configure.invalid/');
}

/** A missing required slot is still pending even when no abstract reference remains. */
export function missingBotResourceSlots(bot: BotInput): string[] {
  const pending: string[] = [];
  for (const step of bot.steps) {
    if (step.type === 'update_lead' || step.type === 'create_lead') {
      step.changes.forEach((change, index) => {
        const location = `passo "${step.id}", alteração ${index + 1}`;
        if (change.field === 'owner_id' && change.mode !== 'clear' && !change.value?.trim()) {
          pending.push(`Responsável: ${location} está sem responsável`);
        }
        if (change.field === 'custom_field' && !change.key?.trim()) {
          pending.push(`Campo personalizado: ${location} está sem campo`);
        }
      });
    }
    if (step.type === 'condition') {
      step.rules.forEach((rule, ruleIndex) => rule.clauses.forEach((clause, clauseIndex) => {
        if (clause.field === 'custom_field' && !clause.key?.trim()) {
          pending.push(`Campo personalizado: passo "${step.id}", regra ${ruleIndex + 1}, condição ${clauseIndex + 1} está sem campo`);
        }
      }));
    }
  }
  return pending;
}
