import type { SupabaseClient } from '@supabase/supabase-js';
import type { BotStep } from './types';
import { isAbstractReference } from './botTemplateDependencies';

export function templateFitsConnections(template: { type: string; connection_id?: string | null }, connectionIds: string[]): boolean {
  return template.type !== 'whatsapp_api' || (
    !!template.connection_id && connectionIds.length > 0 && connectionIds.every(id => id === template.connection_id)
  );
}

/** Revalidate persisted templates whenever an enabled bot changes or is activated. */
export async function botTemplateConnectionError(admin: SupabaseClient, organizationId: string, steps: BotStep[], connectionIds: string[]): Promise<string | null> {
  const ids = [...new Set(steps.flatMap(step => step.type === 'send_template' ? [step.template_id] : []))];
  if (!ids.length) return null;
  const { data, error } = await admin.from('message_templates')
    .select('id, name, type, connection_id, meta_status, buttons')
    .eq('organization_id', organizationId).in('id', ids);
  if (error) throw new Error(error.message);
  for (const id of ids) {
    const template = data?.find(row => row.id === id);
    if (!template) return 'Um modelo do robô não existe mais. Escolha outro modelo antes de ativar.';
    if (!templateFitsConnections(template, connectionIds)) return `O modelo "${template.name}" só pode ser usado no número ao qual pertence. Selecione apenas esse número para ativar o robô.`;
    if (template.type === 'whatsapp_api' && template.meta_status !== 'APPROVED') return `O modelo "${template.name}" ainda não foi aprovado pela Meta.`;
  }
  return botTemplateRoutingProblems(steps, data ?? [])[0] ?? null;
}


type RoutingTemplate = { id: string; name?: string; buttons?: unknown };
/** Match the editor/engine's ordered quick-reply contract; never rewrite branch edges. */
export function botTemplateRoutingProblems(steps: BotStep[], templates: RoutingTemplate[]): string[] {
  const problems: string[] = [];
  for (const step of steps) {
    if (step.type !== 'send_template') continue;
    const template = templates.find(t => t.id === step.template_id);
    if (!template) continue; // Missing/unmapped IDs have separate ownership/pending checks.
    const buttons = Array.isArray(template.buttons) ? template.buttons as Array<{ type?: string; text?: string }> : [];
    const current = buttons.filter(b => b.type === 'QUICK_REPLY').map(b => (b.text ?? '').trim());
    const saved = (step.buttons ?? []).map(label => label.trim());
    if (current.length !== saved.length || current.some((label, index) => label !== saved[index])) {
      problems.push(`Os botões do modelo "${template.name || step.template_id}" mudaram no passo "${step.id}": abra o bloco, clique em "Atualizar do modelo" e revise as conexões antes de ativar.`);
    }
  }
  return problems;
}

/** Import feedback uses the destination's current model, never the exported preview. */
export async function loadBotTemplateRoutingProblems(admin: SupabaseClient, organizationId: string, steps: BotStep[]): Promise<string[]> {
  const ids = [...new Set(steps.flatMap(step => step.type === 'send_template' && !isAbstractReference(step.template_id) ? [step.template_id] : []))];
  if (!ids.length) return [];
  const { data, error } = await admin.from('message_templates').select('id,name,buttons').eq('organization_id', organizationId).in('id', ids);
  if (error) throw new Error(error.message);
  return botTemplateRoutingProblems(steps, data ?? []);
}
