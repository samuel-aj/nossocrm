import type { Deal } from '@/types';

/** Only fields present in the event; joined items/owner are never erased. */
export function dealPatch(row: Record<string, unknown>): Partial<Deal> & { id: string } {
  const patch: Record<string, unknown> = { ...row };
  const fields: Record<string, string> = {
    organization_id: 'organizationId', board_id: 'boardId', stage_id: 'status',
    contact_id: 'contactId', client_company_id: 'clientCompanyId', owner_id: 'ownerId',
    custom_fields: 'customFields', ai_summary: 'aiSummary', created_at: 'createdAt',
    updated_at: 'updatedAt', is_won: 'isWon', is_lost: 'isLost', closed_at: 'closedAt',
    qualified_at: 'qualifiedAt', qualification_date_source: 'qualificationDateSource',
    last_stage_change_date: 'lastStageChangeDate', loss_reason: 'lossReason',
    loss_category: 'lossCategory', inactive_at: 'inactiveAt',
  };
  for (const [db, app] of Object.entries(fields)) {
    if (db in row) { patch[app] = row[db]; delete patch[db]; }
  }
  if ('client_company_id' in row) patch.companyId = row.client_company_id || '';
  return patch as Partial<Deal> & { id: string };
}
