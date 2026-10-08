/** Acquisition belongs to the deal. Never inherit a contact's mutable source. */
export const DEFAULT_LEAD_SOURCES = [
  'Google Ads', 'Meta Ads', 'Indicação', 'Orgânico/Rede Social', 'Presencial', 'Outros',
] as const;

export function normalizeLeadSource(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return value.replace(/\s+/g, ' ').trim() || null;
}

function legacySource(fields: unknown): string | null {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return null;
  return normalizeLeadSource((fields as Record<string, unknown>).origem);
}

export function getDealLeadSource(deal: {
  leadSource?: string | null;
  customFields?: unknown;
}): string | null {
  return deal.leadSource !== undefined
    ? normalizeLeadSource(deal.leadSource)
    : legacySource(deal.customFields);
}

export function readDbLeadSource(row: {
  lead_source?: unknown;
  lead_source_initialized?: boolean | null;
  custom_fields?: unknown;
}): string | null {
  if (row.lead_source_initialized === true || row.lead_source != null) {
    return normalizeLeadSource(row.lead_source);
  }
  return legacySource(row.custom_fields);
}
