import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { renderJsonTemplate, VAR_PATTERN } from '@/lib/wa-agents/template';
import { getDealWhatsappGroupField } from '@/lib/whatsapp/group-links/service';

const GROUP_VARIABLE = /\{\{\s*deal\.whatsapp_group_id\s*\}\}/;
const GROUP_VARIABLE_ALL = /\{\{\s*deal\.whatsapp_group_id\s*\}\}/g;
const OMIT = Symbol('omit');

/** Snapshots may contain older copies of this field outside the default deal. */
function removeLegacyFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(removeLegacyFields);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'whatsapp_group_id' && key !== 'deal.whatsapp_group_id')
      .map(([key, child]) => [key, removeLegacyFields(child)]));
  }
  return value;
}

function removeDependencies(value: unknown): unknown {
  if (typeof value === 'string' && GROUP_VARIABLE.test(value)) return OMIT;
  if (Array.isArray(value)) return value.map(removeDependencies).filter(child => child !== OMIT);
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).filter(([key]) => !GROUP_VARIABLE.test(key))
      .map(([key, child]) => [key, removeDependencies(child)] as const).filter(([, child]) => child !== OMIT);
    return Object.fromEntries(entries);
  }
  return value;
}

/** Parse the template structure before interpolation, preserving generic variable semantics. */
function disabledTemplate(template: string): string {
  if (!GROUP_VARIABLE.test(template)) return template;
  let prefix = '__group_link_raw_variable__';
  while (template.includes(prefix)) prefix += '_';
  const rawVariables: Array<{ marker: string; token: string }> = [];
  let insideString = false;
  let escaped = false;
  let cursor = 0;
  const parseable = template.replace(new RegExp(VAR_PATTERN, 'g'), (token, _path: string, offset: number) => {
    for (; cursor < offset; cursor++) {
      const char = template[cursor];
      if (escaped) { escaped = false; continue; }
      if (insideString && char === '\\') { escaped = true; continue; }
      if (char === '"') insideString = !insideString;
    }
    cursor = offset + token.length;
    if (insideString) return token;
    const marker = `${prefix}${rawVariables.length}${token}`;
    rawVariables.push({ marker, token });
    return JSON.stringify(marker);
  });
  try {
    const pruned = removeDependencies(JSON.parse(parseable));
    if (pruned === OMIT) return '';
    let result = JSON.stringify(pruned);
    for (const { marker, token } of rawVariables) result = result.replaceAll(JSON.stringify(marker), token);
    return result;
  } catch {
    // Raw text/invalid JSON retains its existing fallback, with disabled tokens scrubbed.
    return template.replace(GROUP_VARIABLE_ALL, '');
  }
}

/**
 * Resolve the authoritative field at delivery time. A failed lookup omits it.
 * Every transport attempt, including retries, must call this again immediately
 * before fetch; requests already queued in pg_net or in flight cannot be recalled.
 */
export async function prepareGroupLinkWebhookPayload(
  admin: SupabaseClient,
  organizationId: string,
  payload: Record<string, unknown>,
  bodyTemplate?: string | null,
): Promise<unknown> {
  const clean = removeLegacyFields(payload) as Record<string, unknown>;
  const deal = clean.deal;
  let field: { whatsapp_group_id?: string | null } = {};
  if (deal && typeof deal === 'object' && !Array.isArray(deal)) {
    const id = (deal as Record<string, unknown>).id;
    if (typeof id === 'string' && id) {
      try { field = await getDealWhatsappGroupField(admin, organizationId, id); } catch { /* fail closed */ }
      clean.deal = { ...deal, ...field };
    }
  }
  const enabled = Object.hasOwn(field, 'whatsapp_group_id');
  if (!bodyTemplate?.trim()) return clean;
  return renderJsonTemplate(enabled ? bodyTemplate : disabledTemplate(bodyTemplate), clean);
}
