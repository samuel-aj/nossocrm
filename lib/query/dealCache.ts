import type { QueryClient } from '@tanstack/react-query';
import type { Contact, Deal, DealView } from '@/types';
import { DEALS_VIEW_KEY, queryKeys } from './queryKeys';
import { readTabOrg } from '@/lib/tabOrg';

/** The list and detail must converge; a browser timestamp is not a server version. */
export function newerRecord<T extends { updatedAt?: string }>(cached: T | null | undefined, fetched: T | null | undefined): T | null {
  if (!cached) return fetched ?? null;
  if (!fetched) return cached;
  return Date.parse(cached.updatedAt ?? '') > Date.parse(fetched.updatedAt ?? '') ? cached : fetched;
}

type PendingSave = { revision: number; tail: Promise<unknown>; confirmed: Deal | undefined };
const saves = new WeakMap<QueryClient, Map<string, PendingSave>>();
export const isDealSaving = (client: QueryClient, id: string) => saves.get(client)?.has(id) ?? false;

function contactFields(client: QueryClient, contactId: string): Pick<DealView, 'contactName' | 'contactEmail' | 'contactPhone'> {
  const contact = client.getQueryData<Contact>(queryKeys.contacts.detail(contactId))
    ?? client.getQueryData<Contact[]>(queryKeys.contacts.lists())?.find(row => row.id === contactId);
  return { contactName: contact?.name || 'Sem contato', contactEmail: contact?.email || '', contactPhone: contact?.phone || '' };
}

export function writeDeal(client: QueryClient, deal: Partial<Deal> & { id: string }) {
  client.setQueryData<DealView[]>(DEALS_VIEW_KEY, old => old?.map(row => row.id === deal.id ? { ...row, ...deal } : row));
  client.setQueryData<Deal>(queryKeys.deals.detail(deal.id), old => old ? { ...old, ...deal } : old);
}

/** Apply only a confirmed version, preserving pending user edits and newer events. */
export function reconcileDeal(client: QueryClient, incoming: Deal): Deal {
  const current = newerRecord<Deal>(
    client.getQueryData<DealView[]>(DEALS_VIEW_KEY)?.find(d => d.id === incoming.id),
    client.getQueryData<Deal>(queryKeys.deals.detail(incoming.id)),
  );
  if (isDealSaving(client, incoming.id)) return current ?? incoming;
  const resolved = newerRecord(current, incoming)!;
  writeDeal(client, resolved);
  return resolved;
}

/** Serializes writes to the same lead and rolls back only that lead on failure. */
export async function saveDeal(
  client: QueryClient, id: string, updates: Partial<Deal>,
  persist: (id: string, updates: Partial<Deal>) => Promise<{ data?: Partial<Deal> | null; error: Error | null }>,
): Promise<void> {
  const org = readTabOrg()?.id;
  const sameOrg = () => readTabOrg()?.id === org;
  let pending = saves.get(client);
  if (!pending) { pending = new Map(); saves.set(client, pending); }
  let entry = pending.get(id);
  if (!entry) {
    entry = { revision: 0, tail: Promise.resolve(), confirmed: client.getQueryData<DealView[]>(DEALS_VIEW_KEY)?.find(d => d.id === id) ?? client.getQueryData<Deal>(queryKeys.deals.detail(id)) };
    pending.set(id, entry);
  }
  const revision = ++entry.revision;
  // Cancelling is synchronous; no stale list/detail response may undo this edit.
  const cancelled = client.cancelQueries({ queryKey: queryKeys.deals.all });
  const optimistic = updates.contactId === undefined ? updates : { ...updates, ...contactFields(client, updates.contactId) };
  writeDeal(client, { ...optimistic, id });
  const previous = entry.tail;
  const operation = (async () => {
    await cancelled;
    await previous.catch(() => undefined);
    try {
      if (!sameOrg()) throw new Error('A empresa mudou durante a gravação.');
      const { data, error } = await persist(id, updates);
      if (error) throw error;
      entry.confirmed = { ...entry.confirmed, ...optimistic, ...data, id } as Deal;
      if (entry.revision === revision && sameOrg()) writeDeal(client, entry.confirmed);
      if (updates.contactId !== undefined && sameOrg()) {
        // The database atomically removes incompatible chat links. Old resolver
        // responses must not reintroduce the previous lead after this save.
        await Promise.all([
          client.cancelQueries({ queryKey: ['waConversationLink'] }),
          client.cancelQueries({ queryKey: ['waConversations'] }),
        ]);
        if (sameOrg()) {
          type Conversation = { id: string; deal_id: string | null; contact_id: string | null; is_group?: boolean | null };
          client.setQueriesData<{ data?: Conversation[] }>({ queryKey: ['waConversations'] }, old => old && Array.isArray(old.data) ? {
            ...old, data: old.data.map(row => row.deal_id === id && !row.is_group
              && (!entry.confirmed?.contactId || row.contact_id !== entry.confirmed.contactId)
              ? { ...row, deal_id: null } : row),
          } : old);
          void client.resetQueries({ queryKey: ['waConversationLink'] });
          void client.invalidateQueries({ queryKey: ['waConversations'] });
          void client.invalidateQueries({ queryKey: ['waChat'] });
        }
      }
    } catch (error) {
      if (entry.revision === revision && entry.confirmed && sameOrg()) writeDeal(client, entry.confirmed);
      throw error;
    } finally {
      if (entry.revision === revision) {
        pending.delete(id);
        if (sameOrg()) void client.invalidateQueries({ queryKey: queryKeys.deals.detail(id) });
      }
    }
  })();
  entry.tail = operation;
  return operation;
}
