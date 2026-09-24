import { botResourceReferences, isAbstractReference } from '@/lib/wa-agents/botTemplateDependencies';
import { z } from 'zod';
import { loadBotTemplateRoutingProblems } from '@/lib/wa-agents/templateConnections';
import { json } from '@/lib/whatsapp/api';
import { BotInputSchema, toBotPublic, type BotRow } from '@/lib/wa-agents/types';
import { applyBotTemplate, createBotTemplate, parseBotTemplate, pendingBotBindings } from '@/lib/wa-agents/botTemplates';
import { botResourceError } from '@/lib/wa-agents/botTemplateResources';
import { guardRoute, validateBotSteps } from '../_shared';
import { canPublishBotTemplates, readTemplateBody, templateScope } from './_shared';
export const runtime = 'nodejs';
const COLUMNS = 'id,name,description,official,published,snapshot';
const BodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('export'), bot: BotInputSchema }).strict(),
  z.object({ action: z.literal('save'), bot: BotInputSchema, name: z.string().trim().min(1).max(120), description: z.string().max(1000).default(''), official: z.boolean().default(false) }).strict(),
  z.object({ action: z.literal('preview'), snapshot: z.unknown() }).strict(),
  z.object({ action: z.literal('import'), templateId: z.string().uuid().optional(), snapshot: z.unknown().optional(), bindings: z.record(z.string(), z.string().max(2048)).default({}), name: z.string().trim().min(1).max(120) }).strict(),
]);
export async function GET() {
  const auth = await guardRoute({ admin: true }); if (!auth.ok) return auth.response;
  try {
    const canPublish = await canPublishBotTemplates(auth.admin, auth.user.id);
    const { data, error } = await auth.admin.from('wa_bot_templates').select(COLUMNS).or(templateScope(auth.user.organizationId, canPublish)).order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    // Re-validate/sanitize older snapshots before exposing them, never send origin org/creator.
    return json({ templates: (data ?? []).map(row => ({ ...row, snapshot: parseBotTemplate(row.snapshot) })), canPublish });
  } catch (err) { return json({ error: err instanceof Error ? err.message : 'Falha ao carregar modelos' }, 500); }
}
export async function POST(req: Request) {
  const auth = await guardRoute({ req, admin: true }); if (!auth.ok) return auth.response;
  try {
    const body = BodySchema.parse(await readTemplateBody(req));
    if (body.action === 'preview') return json({ snapshot: parseBotTemplate(body.snapshot) });
    if (body.action === 'export' || body.action === 'save') {
      const graphError = validateBotSteps(body.bot.steps, body.bot.start_step_id, body.bot.layout, false);
      if (graphError) return graphError;
      const snapshot = createBotTemplate(body.bot);
      if (body.action === 'export') return json({ snapshot });
      if (body.official && !(await canPublishBotTemplates(auth.admin, auth.user.id))) return json({ error: 'Só o superadmin pode criar modelos oficiais' }, 403);
      snapshot.bot.name = body.name;
      const { data, error } = await auth.admin.from('wa_bot_templates').insert({ organization_id: auth.user.organizationId, created_by: auth.user.id, name: body.name, description: body.description, official: body.official, published: false, snapshot }).select(COLUMNS).single();
      if (error) throw new Error(error.message);
      return json({ template: data }, 201);
    }
    let raw = body.snapshot;
    if (body.templateId) {
      const superadmin = await canPublishBotTemplates(auth.admin, auth.user.id);
      const { data, error } = await auth.admin.from('wa_bot_templates').select('snapshot').eq('id', body.templateId).or(templateScope(auth.user.organizationId, superadmin)).maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return json({ error: 'Modelo não encontrado' }, 404);
      raw = data.snapshot;
    }
    const input = applyBotTemplate(raw, body.bindings); input.name = body.name;
    const graphError = validateBotSteps(input.steps, input.start_step_id, input.layout, false);
    if (graphError) return graphError;
    const resourceError = await botResourceError(auth.admin, auth.user.organizationId, input, false);
    if (resourceError) return json({ error: resourceError }, 400);
    if (botResourceReferences(input).some(r => r.kind === 'connection' && isAbstractReference(r.value))) return json({ error: 'Reassocie todos os números antes de criar a cópia' }, 400);
    const pending = [...pendingBotBindings(input), ...await loadBotTemplateRoutingProblems(auth.admin, auth.user.organizationId, input.steps)];
    const { data, error } = await auth.admin.from('wa_bots').insert({ ...input, enabled: false, organization_id: auth.user.organizationId, created_by: auth.user.id }).select('*').single();
    if (error) throw new Error(error.message);
    return json({ bot: toBotPublic(data as BotRow), pending }, 201);
  } catch (err) { return json({ error: err instanceof z.ZodError ? 'Formato de modelo inválido' : err instanceof Error ? err.message : 'Falha ao processar modelo' }, 400); }
}
