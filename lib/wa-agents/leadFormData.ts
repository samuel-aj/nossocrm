import type { SupabaseClient } from '@supabase/supabase-js';
import { contractPersonalField, formatContractCpf } from '@/lib/zapsign/contractPersonalFields';
import { signerEmail, signerField } from '@/lib/zapsign/signerIdentity';
import type { ConversationContext } from './context';
import { normalizeSavedKey, sanitizeSavedData } from './savedData';

function formKey(label: string) {
  const key = normalizeSavedKey(label.replace(/[{}]/g, ''))
    .replace(/^(?:lead|ficha)_|_(?:do_)?lead$|_(?:da_)?ficha$/g, '');
  return contractPersonalField(key) ?? signerField(key) ?? key;
}

type ConfirmedForm = {
  agent_signer?: { name?: string; phone?: string; email?: string };
  values?: { de: string; para: string }[];
  package_unverified?: boolean;
};

/** A confirmed contract is durable across days and across the agent's message window. */
export async function loadLeadFormData(admin: SupabaseClient, ctx: ConversationContext, agentId: string, template?: string | null) {
  const { conversation, deal, contact } = ctx;
  const values = new Map<string, string>();
  for (const [key, value] of Object.entries(sanitizeSavedData(conversation.ai_state?.dados))) {
    if (value !== null && String(value).trim()) values.set(formKey(key), String(value));
  }
  if (template && deal && contact && conversation.contact_id === contact.id && conversation.deal_id === deal.id) {
    let query = admin.from('deal_signatures').select('request')
      .eq('organization_id', conversation.organization_id).eq('deal_id', deal.id).eq('contact_id', contact.id)
      .eq('template_token', template).eq('origin', 'agent').in('status', ['pending', 'signed']).not('doc_token', 'is', null)
      .contains('request', { conversation_id: conversation.id, agent_id: agentId, agent_delivery: 'conversation' });
    if (conversation.ai_state?.memoria_desde) query = query.gte('created_at', conversation.ai_state.memoria_desde);
    const { data, error } = await query.order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (error) throw new Error('Não foi possível consultar a ficha confirmada do atendimento.');
    const form: ConfirmedForm | undefined = data?.request;
    if (form && !form.package_unverified) {
      for (const field of Array.isArray(form.values) ? form.values : []) {
        if (typeof field?.de === 'string' && typeof field.para === 'string' && field.para.trim()) {
          values.set(formKey(field.de), field.para.trim());
        }
      }
      for (const field of ['name', 'phone', 'email'] as const) {
        const value = form.agent_signer?.[field];
        if (typeof value === 'string') values.set(field, value.trim());
      }
    }
  }
  return (variable: string): string | undefined => {
    const key = formKey(variable);
    const value = values.get(key);
    if (value === undefined) return undefined;
    if (key === 'cpf') return formatContractCpf(value);
    if (key === 'email') return signerEmail(value);
    return value || undefined;
  };
}
