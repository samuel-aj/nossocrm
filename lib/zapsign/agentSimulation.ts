import type { SupabaseClient } from '@supabase/supabase-js';
import { loadCustomFieldDefs } from '@/lib/wa-agents/leadOps';
import { clientFor, loadZapSignSettings } from './signatures';
import { readContractTemplate } from './templateFile';
import { ZapSignError } from './client';
import { officeTemplates } from './templatePackage';
import { contractReview, prepareAgentDraft, REVIEW_HINT, type AgentContractInput } from './agentDraft';

// Only reads the selected office template. The lead, amounts, confirmation and result
// belong to the Testar chat. No signature insert, createDoc or message transport here.
export async function simulateAgentContract(admin: SupabaseClient, org: string, template: string,
  chat: Array<{ role: 'user' | 'assistant'; text: string; contractReviewKey?: string }>, input: AgentContractInput,
  mapping?: Record<string, string>, rememberReview?: (key: string) => void) {
  const settings = await loadZapSignSettings(admin, org);
  if (!settings) throw new Error('ZapSign desconectada neste escritório.');
  const client = clientFor(settings);
  const tpl = officeTemplates(await client.listTemplates().catch(() => { throw new Error('Não foi possível consultar os modelos na conta ZapSign do escritório.'); }))
    .find(t => t.token === template && t.active !== false);
  if (!tpl) throw new Error('Modelo não disponível nesta conta.');
  const file = await readContractTemplate(client, tpl).catch(error => {
    if (error instanceof ZapSignError && error.status === 422) throw error;
    throw new Error('Não foi possível ler os campos do modelo DOCX do escritório.');
  });
  const defs = await loadCustomFieldDefs(admin, org);
  const turns = chat.map((m, i) => ({ id: String(i), direction: m.role === 'user' ? 'in' as const : 'out' as const, agent: m.role === 'assistant',
    text: m.text, at: new Date().toISOString(), ok: true }));
  const contact = { name: 'Cliente de Teste', email: '', phone: '', company: '' };
  const draft = prepareAgentDraft({ scope: ['teste', org, template], signer: contact.name,
    template: { ...file, name: tpl.name }, supplied: input.dados, turns, mapping, fields: defs.map(f => ({ key: f.key, label: f.label || f.key })),
    ctx: { contact, organizationName: 'Escritório de teste', deal: { title: 'Lead de teste', value: 1000,
      items: [{ name: 'Serviço de teste', quantity: 1, price: 1000 }], stage: '', board: '', owner: '', description: '', customFields: {} } } });
  if (draft.missing.length || draft.office.length)
    return { ok: false, simulado: true, perguntar_ao_cliente: draft.missing, preencher_no_crm: draft.office };
  const previous = chat.at(-2);
  const review = contractReview(turns, draft, previous?.role === 'assistant' ? previous.contractReviewKey : undefined);
  if (!review.confirmed) {
    if (review.key) rememberReview?.(review.key);
    return { ok: true, simulado: true, criado: false, solicitar_confirmacao: review.question, como_perguntar: REVIEW_HINT };
  }
  if (input.modo === 'preparar') return { ok: true, simulado: true, criado: false, ficha_confirmada: true, proximo_passo: 'criar' };
  return { ok: true, simulado: true, criado: true, envio_do_link: 'simulado na conversa' };
}
