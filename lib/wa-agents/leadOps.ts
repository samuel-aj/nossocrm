/**
 * Operações de lead usadas pelos robôs e pelos agentes de IA: remover tag,
 * editar campos (inclusive personalizados), criar o lead do contato sem
 * duplicar e registrar a perda no histórico. SERVER.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { brPhoneVariants, normalizePhoneE164 } from '@/lib/phone';
import { lossDetailsDescription } from '@/lib/utils/lossDetails';
import { buildLeadPatch, type CustomFieldDef, type LeadChange } from './leadFields';

function nowIso(): string {
  return new Date().toISOString();
}

/** Tira a tag do lead (sem diferenciar maiúsculas). Lead sem a tag: nada muda, sem erro. */
export async function removeDealTag(
  admin: SupabaseClient,
  organizationId: string,
  dealId: string,
  tag: string
): Promise<boolean> {
  const clean = tag.trim().toLowerCase();
  if (!clean) return false;
  const { data, error: readError } = await admin
    .from('deals')
    .select('tags')
    .eq('organization_id', organizationId)
    .eq('id', dealId)
    .maybeSingle();
  if (readError) throw new Error(readError.message);
  const current: string[] = Array.isArray((data as { tags?: string[] } | null)?.tags)
    ? ((data as { tags: string[] }).tags ?? [])
    : [];
  const next = current.filter(t => t.trim().toLowerCase() !== clean);
  if (next.length === current.length) return false;
  const { error } = await admin
    .from('deals')
    .update({ tags: next, updated_at: nowIso() })
    .eq('organization_id', organizationId)
    .eq('id', dealId);
  if (error) throw new Error(error.message);
  return true;
}

/** Campos personalizados de lead da organização (tipo e opções). */
export async function loadCustomFieldDefs(admin: SupabaseClient, organizationId: string): Promise<CustomFieldDef[]> {
  const { data, error } = await admin
    .from('custom_field_definitions')
    .select('key, label, type, options')
    .eq('organization_id', organizationId)
    .eq('entity_type', 'deal')
    .limit(500);
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<{ key: string; label: string | null; type: string; options: string[] | null }>).map(d => ({
    key: d.key,
    label: d.label ?? d.key,
    type: d.type,
    options: d.options ?? [],
  }));
}

/** Responsável precisa ser da organização (perfil ou vínculo). */
async function ownerInOrg(admin: SupabaseClient, organizationId: string, userId: string): Promise<boolean> {
  const [{ data: profile }, { data: link }] = await Promise.all([
    admin.from('profiles').select('id').eq('id', userId).eq('organization_id', organizationId).maybeSingle(),
    admin.from('user_organizations').select('user_id').eq('user_id', userId).eq('organization_id', organizationId).maybeSingle(),
  ]);
  return !!profile || !!link;
}

export type LeadChangeOutcome = { changed: string[]; problems: string[] };

/**
 * Aplica as alterações ao lead. Só os campos listados mudam; os campos
 * personalizados são mesclados (os outros ficam como estão). Alteração
 * inválida (tipo, opção inexistente) não impede as demais e volta em `problems`.
 */
export async function applyLeadChanges(
  admin: SupabaseClient,
  input: { organizationId: string; dealId: string; changes: LeadChange[]; render: (text: string) => string }
): Promise<LeadChangeOutcome> {
  const { organizationId, dealId } = input;
  const { data: row, error: readError } = await admin
    .from('deals')
    .select('title, description, custom_fields')
    .eq('organization_id', organizationId)
    .eq('id', dealId)
    .maybeSingle();
  if (readError) throw new Error(readError.message);
  if (!row) throw new Error('lead não encontrado');
  const current = row as { title: string | null; description: string | null; custom_fields: Record<string, unknown> | null };
  const needsDefs = input.changes.some(c => c.field === 'custom_field');
  const defs = needsDefs ? await loadCustomFieldDefs(admin, organizationId) : [];
  const patch = buildLeadPatch(input.changes, { render: input.render, current, defs });

  if (typeof patch.columns.owner_id === 'string' && !(await ownerInOrg(admin, organizationId, patch.columns.owner_id))) {
    patch.problems.push('responsável não pertence à organização');
    delete patch.columns.owner_id;
  }

  const updates: Record<string, unknown> = { ...patch.columns };
  const changed = Object.keys(patch.columns);
  if (Object.keys(patch.customFields).length > 0) {
    const base = current.custom_fields && typeof current.custom_fields === 'object' ? { ...current.custom_fields } : {};
    for (const [k, v] of Object.entries(patch.customFields)) {
      if (v === null) delete base[k];
      else base[k] = v;
      changed.push(`campo ${k}`);
    }
    updates.custom_fields = base;
  }
  if (Object.keys(updates).length > 0) {
    const { error } = await admin
      .from('deals')
      .update({ ...updates, updated_at: nowIso() })
      .eq('organization_id', organizationId)
      .eq('id', dealId);
    if (error) throw new Error(error.message);
  }
  return { changed, problems: patch.problems };
}

export type CreateLeadResult =
  | { created: true; dealId: string; contactId: string; problems: string[] }
  | { created: false; dealId: string; contactId: string; reason: string };

/**
 * Lead do contato: se ele já tem um lead ABERTO, devolve esse (nada é criado).
 * Contato é achado pelo telefone (com e sem o nono dígito) ou criado. O
 * responsável, quando não informado, fica com o rodízio da organização.
 */
export async function ensureLeadForContact(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    contactId?: string | null;
    phone?: string | null;
    contactName?: string | null;
    boardId: string;
    stageId: string;
    changes: LeadChange[];
    render: (text: string) => string;
    conversationId?: string | null;
  }
): Promise<CreateLeadResult> {
  const { organizationId } = input;
  let contactId = input.contactId ?? null;
  const phone = normalizePhoneE164(input.phone || '');

  if (!contactId) {
    const variants = brPhoneVariants(phone);
    if (variants.length === 0) throw new Error('contato sem telefone: não dá para identificar nem criar o lead');
    const { data: existing } = await admin
      .from('contacts')
      .select('id')
      .eq('organization_id', organizationId)
      .in('phone', variants)
      .is('deleted_at', null)
      .limit(1)
      .maybeSingle();
    contactId = (existing as { id?: string } | null)?.id ?? null;
    if (!contactId) {
      const name = (input.contactName || '').trim() || phone;
      const { data: created, error } = await admin
        .from('contacts')
        .insert({ organization_id: organizationId, name, phone, stage: 'LEAD' })
        .select('id')
        .single();
      if (error) throw new Error(error.message);
      contactId = (created as { id: string }).id;
    }
  }

  const { data: open } = await admin
    .from('deals')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('contact_id', contactId)
    .is('deleted_at', null)
    .eq('is_won', false)
    .eq('is_lost', false)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (open) {
    await linkConversation(admin, organizationId, input.conversationId, contactId, (open as { id: string }).id);
    return { created: false, dealId: (open as { id: string }).id, contactId, reason: 'o contato já tem um lead aberto' };
  }

  const { data: stage } = await admin
    .from('board_stages')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('board_id', input.boardId)
    .eq('id', input.stageId)
    .maybeSingle();
  if (!stage) throw new Error('a etapa escolhida não pertence ao pipeline (foi apagada ou movida?)');

  const { data: contactRow } = await admin.from('contacts').select('name').eq('id', contactId).maybeSingle();
  const defaultTitle = ((contactRow as { name?: string } | null)?.name || input.contactName || phone || 'Novo lead').trim();
  const { data: deal, error } = await admin
    .from('deals')
    .insert({
      organization_id: organizationId,
      title: defaultTitle.slice(0, 200),
      board_id: input.boardId,
      stage_id: input.stageId,
      contact_id: contactId,
      value: 0,
    })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  const dealId = (deal as { id: string }).id;

  // Dados iniciais configurados (título, valor, descrição, responsável, campos)
  let problems: string[] = [];
  if (input.changes.length > 0) {
    const r = await applyLeadChanges(admin, { organizationId, dealId, changes: input.changes, render: input.render });
    problems = r.problems;
  }
  await linkConversation(admin, organizationId, input.conversationId, contactId, dealId);
  return { created: true, dealId, contactId, problems };
}

async function linkConversation(
  admin: SupabaseClient,
  organizationId: string,
  conversationId: string | null | undefined,
  contactId: string,
  dealId: string
): Promise<void> {
  if (!conversationId) return;
  await admin
    .from('wa_conversations')
    .update({ contact_id: contactId, deal_id: dealId })
    .eq('organization_id', organizationId)
    .eq('id', conversationId);
}

/**
 * Histórico do lead quando uma automação o marca como perdido (mesmo formato
 * da tela: "Moveu para X" com classificação e motivo). Falha aqui não desfaz a perda.
 */
export async function recordLossHistory(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    dealId: string;
    stageId: string;
    lossReason?: string | null;
    lossCategory?: string | null;
    by: string;
  }
): Promise<void> {
  try {
    const [{ data: deal }, { data: stage }] = await Promise.all([
      admin.from('deals').select('is_lost, contact_id').eq('organization_id', input.organizationId).eq('id', input.dealId).maybeSingle(),
      admin.from('board_stages').select('label, name').eq('organization_id', input.organizationId).eq('id', input.stageId).maybeSingle(),
    ]);
    if (!(deal as { is_lost?: boolean } | null)?.is_lost) return;
    const label = (stage as { label?: string; name?: string } | null)?.label || (stage as { name?: string } | null)?.name || 'etapa de perda';
    await admin.from('activities').insert({
      organization_id: input.organizationId,
      type: 'STATUS_CHANGE',
      title: `Moveu para ${label} (${input.by})`,
      description: lossDetailsDescription(input.lossCategory ?? undefined, input.lossReason ?? undefined),
      date: nowIso(),
      completed: true,
      deal_id: input.dealId,
      contact_id: (deal as { contact_id?: string | null } | null)?.contact_id ?? null,
    });
  } catch (e) {
    console.error('[wa-agents] histórico da perda falhou:', e instanceof Error ? e.message : e);
  }
}
