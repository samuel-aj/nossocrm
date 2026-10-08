import { z } from 'zod';
import { normalizeLeadSource, readDbLeadSource } from '@/lib/deals/leadSource';

export const leadSourceSchema = z.string().max(120).nullable().optional();

/** Omission preserves source; null explicitly clears it, including legacy fallback. */
export function leadSourceWrite(value: string | null | undefined) {
  return value === undefined ? {} : {
    lead_source: normalizeLeadSource(value),
    lead_source_initialized: true,
  };
}

/** The initialization flag is storage metadata, not part of the public contract. */
export function publicDealSource<T extends {
  lead_source?: unknown;
  lead_source_initialized?: boolean | null;
  custom_fields?: unknown;
}>(row: T) {
  const result = { ...row, lead_source: readDbLeadSource(row) };
  delete result.lead_source_initialized;
  return result;
}
