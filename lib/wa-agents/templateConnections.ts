import type { SupabaseClient } from '@supabase/supabase-js';
import type { BotStep } from './types';

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
    .select('id, name, type, connection_id, meta_status')
    .eq('organization_id', organizationId).in('id', ids);
  if (error) throw new Error(error.message);
  for (const id of ids) {
    const template = data?.find(row => row.id === id);
    if (!template) return 'Um modelo do robô não existe mais. Escolha outro modelo antes de ativar.';
    if (!templateFitsConnections(template, connectionIds)) return `O modelo "${template.name}" só pode ser usado no número ao qual pertence. Selecione apenas esse número para ativar o robô.`;
    if (template.type === 'whatsapp_api' && template.meta_status !== 'APPROVED') return `O modelo "${template.name}" ainda não foi aprovado pela Meta.`;
  }
  return null;
}
