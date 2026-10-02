export type GroupLinkField = { whatsapp_group_id?: string | null };
export type RelatedGroup = { id: string; provider: string; externalId: string; name: string; conversationId: string; isPrimary: boolean };
export type GroupLinkEntity = { id: string; name: string };
export type GroupLinksResponse = { enabled: boolean; groups: RelatedGroup[]; contacts: GroupLinkEntity[]; deals: GroupLinkEntity[]; whatsappGroupId?: string | null };
export type EntityType = 'contact' | 'deal';
export type LinkAction = 'link' | 'unlink' | 'set_primary';
export type GroupLinksTarget = { conversationId: string } | { contactId: string } | { dealId: string };
export const emptyGroupLinks = (): GroupLinksResponse => ({ enabled: false, groups: [], contacts: [], deals: [] });

export class GroupLinksError extends Error {
  constructor(message: string, public readonly status: number = 500) { super(message); }
}
export function groupLinksErrorResponse(error: unknown): Response {
  return Response.json({ error: error instanceof GroupLinksError ? error.message : 'Não foi possível consultar os vínculos de grupos.' }, { status: error instanceof GroupLinksError ? error.status : 500 });
}
