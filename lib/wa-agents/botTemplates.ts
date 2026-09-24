import { z } from 'zod';
import { BotInputSchema, type BotInput } from './types';
import { abstractReference, botResourceReferences, DEPENDENCY_KINDS, DEPENDENCY_LABELS, isAbstractReference, mapBotResources } from './botTemplateDependencies';

export const MAX_BOT_TEMPLATE_BYTES = 1_048_576;
const TemplateSchema = z.object({
  format: z.literal('nossocrm.bot'), version: z.literal(1),
  bot: BotInputSchema,
  dependencies: z.array(z.object({ kind: z.enum(DEPENDENCY_KINDS), ref: z.string().max(160), label: z.string().max(160) }).strict()).max(2000),
}).strict();
export type BotTemplate = z.infer<typeof TemplateSchema>;
export type BotTemplateRow = { id: string; name: string; description: string; official: boolean; published: boolean; snapshot: BotTemplate };

/** Remove credential-bearing URLs even from free-form text. Webhooks always require new configuration. */
function sanitize(bot: BotInput): BotInput {
  const clean = JSON.parse(JSON.stringify(bot, (key, value) => {
    if (key === 'secret' || key === 'body_template') return null;
    if (typeof value !== 'string') return value;
    return value.replace(/https?:\/\/[^\s<>"']+/gi, (url: string) => {
      try { const u = new URL(url); return u.username || u.password || u.search || u.hash || /\/object\/sign\//i.test(u.pathname) ? '[URL removida: configure no destino]' : url; } catch { return '[URL removida]'; }
    });
  })) as BotInput;
  clean.enabled = false;
  for (const step of clean.steps) {
    if (step.type === 'webhook') { step.url = 'https://configure.invalid/webhook'; step.secret = null; step.body_template = null; }
    if (step.type === 'send_template') { delete step.template_name; delete step.template_body; }
    if (step.type === 'start_bot') delete step.bot_name;
  }
  return clean;
}
function checkGraph(bot: BotInput) {
  if (bot.steps.length > 1000) throw new Error('O modelo excede 1.000 passos');
  const ids = new Set(bot.steps.map(s => s.id));
  if (ids.size !== bot.steps.length) throw new Error('IDs de passos repetidos');
  const refs: Array<string | null | undefined> = [bot.start_step_id];
  for (const s of bot.steps) {
    refs.push(s.next_step_id);
    if ('on_timeout_step_id' in s) refs.push(s.on_timeout_step_id);
    if (s.type === 'send_template') refs.push(...s.button_step_ids);
    if (s.type === 'condition') refs.push(s.else_step_id, ...s.rules.map(r => r.goto_step_id));
  }
  const grouped = bot.layout.groups.flatMap(g => g.step_ids);
  if (new Set(grouped).size !== grouped.length || new Set(bot.layout.groups.map(g => g.id)).size !== bot.layout.groups.length) throw new Error('Balões repetidos ou passos em mais de um balão');
  refs.push(...grouped);
  if (refs.some(id => id && !ids.has(id))) throw new Error('O modelo aponta para um passo inexistente');
}
export function createBotTemplate(raw: unknown): BotTemplate {
  const original = BotInputSchema.parse(raw);
  const parsed = sanitize(original);
  parsed.steps.forEach((step, i) => { if (step.type === 'webhook') step.url = `https://configure.invalid/source-${i}`; });
  // Each webhook is configured independently; original URLs and payloads never enter the manifest.
  const dependencies: BotTemplate['dependencies'] = [];
  const byResource = new Map<string, string>();
  const abstract = mapBotResources(parsed, resource => {
    const key = `${resource.kind}:${resource.value}`;
    let ref = byResource.get(key);
    if (!ref) {
      ref = abstractReference(dependencies.length, resource.kind); byResource.set(key, ref);
      dependencies.push({ kind: resource.kind, ref, label: `${DEPENDENCY_LABELS[resource.kind]} ${dependencies.filter(d => d.kind === resource.kind).length + 1} (${resource.location.replace(/^bot\./, '')})`.slice(0, 160) });
    }
    return ref;
  });
  const clean = sanitize(abstract);
  // Sanitization resets webhooks; restore only their already abstract URLs.
  clean.steps.forEach((step, i) => { const before = abstract.steps[i]; if (step.type === 'webhook' && before.type === 'webhook') step.url = before.url; });
  return parseBotTemplate({ format: 'nossocrm.bot', version: 1, bot: clean, dependencies });
}
export function parseBotTemplate(raw: unknown): BotTemplate {
  if (new TextEncoder().encode(JSON.stringify(raw)).length > MAX_BOT_TEMPLATE_BYTES) throw new Error('O arquivo excede 1 MB');
  const template = TemplateSchema.parse(raw);
  checkGraph(template.bot);
  const declared = new Map(template.dependencies.map(d => [`${d.kind}:${d.ref}`, d]));
  if (declared.size !== template.dependencies.length || new Set(template.dependencies.map(d => d.ref)).size !== template.dependencies.length) throw new Error('Dependências repetidas');
  const used = new Set<string>();
  for (const r of botResourceReferences(template.bot)) {
    const key = `${r.kind}:${r.value}`;
    if (!isAbstractReference(r.value) || !declared.has(key)) throw new Error('Referência externa ou dependência não declarada');
    used.add(key);
  }
  if (used.size !== declared.size) throw new Error('Dependência sem uso');
  const clean = sanitize(template.bot);
  clean.steps.forEach((step, i) => { const before = template.bot.steps[i]; if (step.type === 'webhook' && before.type === 'webhook') step.url = before.url; });
  return { ...template, bot: BotInputSchema.parse(clean) };
}
export function applyBotTemplate(raw: unknown, bindings: Record<string, string>): BotInput {
  const template = parseBotTemplate(raw);
  const known = new Set(template.dependencies.map(d => d.ref));
  if (Object.keys(bindings).some(ref => !known.has(ref))) throw new Error('Vínculo desconhecido');
  const bot = mapBotResources(template.bot, r => bindings[r.value] || r.value);
  bot.enabled = false;
  return BotInputSchema.parse(bot);
}
export function pendingBotBindings(bot: BotInput): string[] {
  const pending = [...new Set(botResourceReferences(bot).filter(r => isAbstractReference(r.value)).map(r => `${DEPENDENCY_LABELS[r.kind]}: ${r.location.replace(/^bot\./, '')}`))];
  if (JSON.stringify(bot).includes('[URL removida')) pending.push('URL removida: revise os textos do fluxo');
  return pending;
}
