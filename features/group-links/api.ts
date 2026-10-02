import type { EntityType, GroupLinkEntity, GroupLinksResponse, GroupLinksTarget, LinkAction } from '@/lib/whatsapp/group-links/types';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: 'no-store' });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Não foi possível atualizar os vínculos.');
  return body as T;
}
export const groupLinksApi = {
  settings: () => request<{ enabled: boolean }>('/api/settings/group-links'),
  setEnabled: (enabled: boolean) => request<{ enabled: boolean }>('/api/settings/group-links', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }) }),
  read: (target: GroupLinksTarget) => request<GroupLinksResponse>(`/api/whatsapp/group-links?${new URLSearchParams(target)}`),
  options: (conversationId: string, type: EntityType, q: string) => request<{ items: GroupLinkEntity[] }>(`/api/whatsapp/group-links/options?${new URLSearchParams({ conversationId, type, q })}`),
  mutate: (input: { conversationId: string; entityType: EntityType; entityId: string; action: LinkAction }) => request<{ ok: boolean }>('/api/whatsapp/group-links', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }),
};
