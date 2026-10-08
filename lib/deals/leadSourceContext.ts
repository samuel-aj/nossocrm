import { getDealLeadSource } from './leadSource';

/** Present acquisition once to AI consumers without changing stored legacy fields. */
export function buildDealLeadSourceContext(deal: {
  leadSource?: string | null;
  customFields?: Record<string, unknown>;
}) {
  const customFields = { ...deal.customFields };
  delete customFields.origem;
  return { leadSource: getDealLeadSource(deal), customFields };
}
