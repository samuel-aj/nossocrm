/**
 * Supabase Realtime Sync Hook
 *
 * Provides real-time synchronization for multi-user scenarios.
 * When one user makes changes, all other users see updates instantly.
 *
 * Usage:
 *   useRealtimeSync('deals');  // Subscribe to deals table changes
 *   useRealtimeSync(['deals', 'activities']);  // Multiple tables
 */
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { queryKeys, DEALS_VIEW_KEY } from '@/lib/query/queryKeys';
import type { Activity, Deal, DealItem, DealView } from '@/types';

// Translate a Realtime `activities` payload row (snake_case, no joins) into
// a partial Activity with only the fields Realtime actually carries. Joined
// fields like dealTitle and assignedToName are intentionally omitted so we
// don't clobber existing cache values that the queryFn populated via joins.
function normalizeActivityFromRealtime(row: Record<string, unknown>): Partial<Activity> & { id: string } {
  const patch: Partial<Activity> & { id: string } = {
    id: row.id as string,
    organizationId: row.organization_id as string,
    title: (row.title as string) ?? '',
    description: (row.description as string) ?? undefined,
    type: row.type as Activity['type'],
    date: row.date as string,
    completed: Boolean(row.completed),
    dealId: (row.deal_id as string) ?? '',
    contactId: (row.contact_id as string) ?? undefined,
    clientCompanyId: (row.client_company_id as string) ?? undefined,
    participantContactIds: (row.participant_contact_ids as string[]) ?? [],
    assignedTo: (row.assigned_to as string) ?? null,
  };
  return patch;
}

// Enable detailed Realtime logging in development or when DEBUG_REALTIME env var is set
const DEBUG_REALTIME = process.env.NODE_ENV === 'development' || process.env.NEXT_PUBLIC_DEBUG_REALTIME === 'true';

// Global deduplication for INSERT events - prevents multiple hook instances from processing the same event
// Key format: `${table}-${id}-${updatedAt}`
// Using Map with timestamp to handle TTL and atomic check-and-set
const processedInserts = new Map<string, number>();
const PROCESSED_CACHE_TTL = 5000; // 5 seconds TTL for processed events

// Atomic check-and-set for deduplication
function shouldProcessInsert(key: string): boolean {
  const now = Date.now();
  
  // Clean up old entries
  for (const [k, timestamp] of processedInserts) {
    if (now - timestamp > PROCESSED_CACHE_TTL) {
      processedInserts.delete(k);
    }
  }
  
  // Check if already processed
  if (processedInserts.has(key)) {
    return false;
  }
  
  // Mark as processed immediately (atomic in single-threaded JS)
  processedInserts.set(key, now);
  return true;
}

// Tables that support realtime sync
type RealtimeTable =
  | 'deals'
  | 'deal_items'
  | 'deal_notes'
  | 'contacts'
  | 'activities'
  | 'boards'
  | 'board_stages'
  | 'crm_companies';

// Lazy getter for query keys mapping - avoids initialization issues in tests
const getTableQueryKeys = (table: RealtimeTable): readonly (readonly unknown[])[] => {
  const mapping: Record<RealtimeTable, readonly (readonly unknown[])[]> = {
    deals: [queryKeys.deals.all, queryKeys.dashboard.stats],
    // deal_items events are handled with direct cache writes; this mapping
    // is only used as a safety net if the dedicated handler ever falls through.
    deal_items: [queryKeys.deals.all, queryKeys.dashboard.stats],
    // deal_notes surface inside the deal detail cache; invalidate the deal
    // detail query (via prefix match on deals.all) so the modal refetches
    // when a note is added/edited/deleted in another tab.
    deal_notes: [queryKeys.deals.all],
    contacts: [queryKeys.contacts.all],
    activities: [queryKeys.activities.all],
    boards: [queryKeys.boards.all],
    board_stages: [queryKeys.boards.all], // stages invalidate boards
    crm_companies: [queryKeys.companies.all],
  };
  return mapping[table];
};

interface UseRealtimeSyncOptions {
  /** Whether sync is enabled (default: true) */
  enabled?: boolean;
  /** Debounce invalidation to avoid rapid updates (ms) */
  debounceMs?: number;
  /** Callback when a change is received */
  onchange?: (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => void;
}

/**
 * Subscribe to realtime changes on one or more tables
 */
export function useRealtimeSync(
  tables: RealtimeTable | RealtimeTable[],
  options: UseRealtimeSyncOptions = {}
) {
  const { enabled = true, debounceMs = 100, onchange } = options;
  const queryClient = useQueryClient();
  const channelRef = useRef<RealtimeChannel | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingInvalidationsRef = useRef<Set<readonly unknown[]>>(new Set());
  const pendingInvalidateOnlyRef = useRef<Set<readonly unknown[]>>(new Set());
  // Track bursty board_stages INSERTs (creating a board inserts multiple stages).
  // We'll refetch on single INSERT (realtime stage created by someone else),
  // but avoid storms on bursts (treat burst as invalidate-only).
  const pendingBoardStagesInsertCountRef = useRef(0);
  const flushScheduledRef = useRef(false);
  const onchangeRef = useRef(onchange);
  
  // Keep callback ref up to date without causing re-renders
  useEffect(() => {
    onchangeRef.current = onchange;
  }, [onchange]);

  useEffect(() => {
    if (!enabled) return;

    const sb = supabase;
    if (!sb) {
      console.warn('[Realtime] Supabase client not available');
      return;
    }

    const tableList = Array.isArray(tables) ? tables : [tables];
    const channelName = `realtime-sync-${tableList.join('-')}`;

    // Cleanup existing channel if any
    if (channelRef.current) {
      if (DEBUG_REALTIME) {
        console.log(`[Realtime] Cleaning up existing channel: ${channelName}`);
      }
      sb.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    // Create channel
    // Note: Supabase Realtime handles reconnection automatically
    const channel = sb.channel(channelName);

    // Subscribe to each table
    tableList.forEach(table => {
      channel.on(
        'postgres_changes',
        {
          event: '*', // INSERT, UPDATE, DELETE
          schema: 'public',
          table,
        },
        (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
          if (DEBUG_REALTIME) {
            console.log(`[Realtime] ${table} ${payload.eventType}:`, payload);
          }

          // Call custom callback (if provided)
          onchangeRef.current?.(payload);

          // =================================================================
          // ACTIVITIES: direct cache writes for INSERT / UPDATE / DELETE.
          //
          // We never invalidate for activities events — the local mutation
          // already wrote the intended state, and the Realtime echo we get
          // here carries the authoritative server row. Merging it directly
          // keeps same-tab optimistic state intact and propagates cross-tab
          // changes instantly, with no refetch round-trip that could race.
          // =================================================================
          if (table === 'activities') {
            const listsKey = queryKeys.activities.lists();

            if (payload.eventType === 'DELETE') {
              const oldRow = payload.old as Record<string, unknown> | undefined;
              const id = oldRow?.id as string | undefined;
              if (!id) return;
              queryClient.setQueryData<Activity[]>(listsKey, (old = []) =>
                old.filter(a => a.id !== id)
              );
              return;
            }

            const newRow = payload.new as Record<string, unknown> | undefined;
            if (!newRow?.id) return;
            const patch = normalizeActivityFromRealtime(newRow);

            if (payload.eventType === 'INSERT') {
              const dedupeKey = `activities-${patch.id}`;
              if (!shouldProcessInsert(dedupeKey)) return;

              queryClient.setQueryData<Activity[]>(listsKey, (old = []) => {
                // Already present (e.g. we just wrote it optimistically and the
                // temp id was swapped for the real one in addActivity). No-op.
                if (old.some(a => a.id === patch.id)) return old;
                // Drop any temp activity that matches by dealId + title —
                // covers the case where addActivity's server response is
                // still in flight when Realtime fires first.
                const withoutMatchingTemp = old.filter(a => {
                  if (!a.id.startsWith('temp-activity-')) return true;
                  const sameDeal = a.dealId === patch.dealId;
                  const sameTitle = a.title === patch.title;
                  return !(sameDeal && sameTitle);
                });
                // Realtime doesn't carry joined fields. We build a minimally
                // complete Activity here; joined labels (dealTitle, etc.) stay
                // empty until the next normal refetch but the row shows up.
                const newActivity: Activity = {
                  dealTitle: '',
                  user: { name: 'Você', avatar: '' },
                  assignedToName: null,
                  ...patch,
                } as Activity;
                return [newActivity, ...withoutMatchingTemp];
              });
              return;
            }

            if (payload.eventType === 'UPDATE') {
              queryClient.setQueryData<Activity[]>(listsKey, (old = []) => {
                const idx = old.findIndex(a => a.id === patch.id);
                if (idx === -1) return old;
                // Merge patch over existing row — joined fields (dealTitle,
                // assignedToName) already on the cache row are preserved
                // because the patch intentionally doesn't include them.
                return old.map((a, i) => (i === idx ? { ...a, ...patch } : a));
              });
              return;
            }

            return;
          }

          // =================================================================
          // DEAL_ITEMS: direct cache writes for INSERT / UPDATE / DELETE.
          //
          // Items live inside the parent deal's `items[]` on three caches:
          // deals.lists() (Deal[]), DEALS_VIEW_KEY (DealView[]) and
          // deals.detail(dealId) (Deal). We patch all three and recalculate
          // `deal.value` locally — the server also recalculates via
          // dealsService.recalculateDealValue, and the deals UPDATE echo
          // will reconcile below if they diverge.
          //
          // DELETE events require REPLICA IDENTITY FULL on deal_items so
          // payload.old carries deal_id (not just the primary key).
          // =================================================================
          if (table === 'deal_items') {
            const recalcValue = (items: DealItem[]): number =>
              items.reduce((sum, i) => sum + i.price * i.quantity, 0);

            if (payload.eventType === 'DELETE') {
              const oldRow = payload.old as Record<string, unknown> | undefined;
              const itemId = oldRow?.id as string | undefined;
              if (!itemId) {
                if (DEBUG_REALTIME) {
                  console.warn('[Realtime] deal_items DELETE without item id', payload);
                }
                return;
              }
              // With REPLICA IDENTITY FULL, oldRow carries deal_id. Without it
              // (default identity), payload.old only has the PK — we fall back
              // to scanning the cache for whichever deal contains this item.
              const explicitDealId = oldRow?.deal_id as string | undefined;

              const applyRemove = <T extends Deal>(d: T): T => {
                if (explicitDealId) {
                  if (d.id !== explicitDealId) return d;
                } else {
                  if (!(d.items || []).some((i) => i.id === itemId)) return d;
                }
                const nextItems = (d.items || []).filter((i) => i.id !== itemId);
                return { ...d, items: nextItems, value: recalcValue(nextItems) } as T;
              };
              queryClient.setQueryData<Deal[]>(queryKeys.deals.lists(), (old) =>
                old?.map(applyRemove)
              );
              queryClient.setQueryData<DealView[]>(DEALS_VIEW_KEY, (old) =>
                old?.map(applyRemove)
              );
              if (explicitDealId) {
                queryClient.setQueryData<Deal>(queryKeys.deals.detail(explicitDealId), (old) =>
                  old ? applyRemove(old) : old
                );
              }
              if (DEBUG_REALTIME) {
                console.log(
                  `[Realtime] deal_items DELETE applied (item=${itemId}, dealId=${explicitDealId ?? '<scanned>'})`
                );
              }
              return;
            }

            const newRow = payload.new as Record<string, unknown> | undefined;
            const itemId = newRow?.id as string | undefined;
            const dealId = newRow?.deal_id as string | undefined;
            if (!itemId || !dealId) {
              if (DEBUG_REALTIME) {
                console.warn('[Realtime] deal_items event missing itemId/dealId', payload);
              }
              return;
            }

            const realItem: DealItem = {
              id: itemId,
              productId: (newRow?.product_id as string) || '',
              name: (newRow?.name as string) || '',
              quantity: Number(newRow?.quantity) || 0,
              price: Number(newRow?.price) || 0,
            };

            if (payload.eventType === 'INSERT') {
              // Dedup across multiple hook instances mounted in parallel.
              const dedupeKey = `deal_items-${itemId}`;
              if (!shouldProcessInsert(dedupeKey)) return;

              const applyInsert = <T extends Deal>(d: T): T => {
                if (d.id !== dealId) return d;
                const items = d.items || [];
                // Already present (our own optimistic mutation swapped temp → real).
                if (items.some((i) => i.id === itemId)) return d;
                // Drop any temp item matching business keys (race: Realtime
                // arrived before the local POST response swapped the id).
                const withoutMatchingTemp = items.filter((i) => {
                  if (!i.id.startsWith('temp-item-')) return true;
                  const same =
                    i.productId === realItem.productId &&
                    i.name === realItem.name &&
                    i.quantity === realItem.quantity &&
                    i.price === realItem.price;
                  return !same;
                });
                const nextItems = [...withoutMatchingTemp, realItem];
                return { ...d, items: nextItems, value: recalcValue(nextItems) } as T;
              };
              queryClient.setQueryData<Deal[]>(queryKeys.deals.lists(), (old) =>
                old?.map(applyInsert)
              );
              queryClient.setQueryData<DealView[]>(DEALS_VIEW_KEY, (old) =>
                old?.map(applyInsert)
              );
              queryClient.setQueryData<Deal>(queryKeys.deals.detail(dealId), (old) =>
                old ? applyInsert(old) : old
              );
              return;
            }

            if (payload.eventType === 'UPDATE') {
              const applyUpdate = <T extends Deal>(d: T): T => {
                if (d.id !== dealId) return d;
                const items = d.items || [];
                const idx = items.findIndex((i) => i.id === itemId);
                if (idx === -1) return d;
                const nextItems = items.map((i, k) => (k === idx ? { ...i, ...realItem } : i));
                return { ...d, items: nextItems, value: recalcValue(nextItems) } as T;
              };
              queryClient.setQueryData<Deal[]>(queryKeys.deals.lists(), (old) =>
                old?.map(applyUpdate)
              );
              queryClient.setQueryData<DealView[]>(DEALS_VIEW_KEY, (old) =>
                old?.map(applyUpdate)
              );
              queryClient.setQueryData<Deal>(queryKeys.deals.detail(dealId), (old) =>
                old ? applyUpdate(old) : old
              );
              return;
            }

            return;
          }

          // Queue query keys for invalidation (lazy loaded)
          const keys = getTableQueryKeys(table);
          // NOTE: `board_stages` INSERTs happen in bursts when creating a board (one per stage).
          // Refetching boards on each stage INSERT causes a request storm.
          // For that specific case, we can refetch on a single INSERT (true realtime),
          // but treat bursts as invalidate-only and let the board create mutation handle timing.
          if (payload.eventType === 'INSERT' && table === 'board_stages') {
            keys.forEach(key => pendingInvalidateOnlyRef.current.add(key));
            pendingBoardStagesInsertCountRef.current += 1;
          } else {
            keys.forEach(key => pendingInvalidationsRef.current.add(key));
          }

          // INSERT events can happen in bursts (ex.: creating a board inserts multiple board_stages).
          // Instead of refetching per-row, batch within the same tick using a microtask.
          // This keeps UI instant (optimistic updates handle UX) while preventing refetch storms.
          if (payload.eventType === 'INSERT') {
            // SPECIAL HANDLING FOR DEALS INSERT:
            // Instead of invalidating (which causes refetch that removes temp deal),
            // add the deal directly to the cache. This prevents the "flash and disappear" bug.
            if (table === 'deals') {
              const newData = payload.new as Record<string, unknown>;
              const dealId = newData.id as string;
              const updatedAt = newData.updated_at as string;
              
              // Deduplication: prevent multiple hook instances from processing the same INSERT
              const dedupeKey = `deals-${dealId}-${updatedAt}`;
              if (!shouldProcessInsert(dedupeKey)) {
                return; // Skip this event, already processed by another hook instance
              }
              
              // Normalize snake_case to camelCase for cache compatibility
              const normalizedDeal: Record<string, unknown> = { ...newData };
              if (newData.stage_id !== undefined) {
                normalizedDeal.status = newData.stage_id;
                delete normalizedDeal.stage_id;
              }
              if (newData.updated_at !== undefined) {
                normalizedDeal.updatedAt = newData.updated_at;
                delete normalizedDeal.updated_at;
              }
              if (newData.created_at !== undefined) {
                normalizedDeal.createdAt = newData.created_at;
                delete normalizedDeal.created_at;
              }
              if (newData.is_won !== undefined) {
                normalizedDeal.isWon = newData.is_won;
                delete normalizedDeal.is_won;
              }
              if (newData.is_lost !== undefined) {
                normalizedDeal.isLost = newData.is_lost;
                delete normalizedDeal.is_lost;
              }
              if (newData.board_id !== undefined) {
                normalizedDeal.boardId = newData.board_id;
                delete normalizedDeal.board_id;
              }
              if (newData.contact_id !== undefined) {
                normalizedDeal.contactId = newData.contact_id;
                delete normalizedDeal.contact_id;
              }
              if (newData.company_id !== undefined) {
                normalizedDeal.companyId = newData.company_id;
                delete normalizedDeal.company_id;
              }
              if (newData.closed_at !== undefined) {
                normalizedDeal.closedAt = newData.closed_at;
                delete normalizedDeal.closed_at;
              }
              if (newData.last_stage_change_date !== undefined) {
                normalizedDeal.lastStageChangeDate = newData.last_stage_change_date;
                delete normalizedDeal.last_stage_change_date;
              }
              if (newData.organization_id !== undefined) {
                normalizedDeal.organizationId = newData.organization_id;
                delete normalizedDeal.organization_id;
              }
              if (newData.loss_reason !== undefined) {
                normalizedDeal.lossReason = newData.loss_reason;
                delete normalizedDeal.loss_reason;
              }
              if (newData.loss_category !== undefined) {
                normalizedDeal.lossCategory = newData.loss_category;
                delete normalizedDeal.loss_category;
              }

              // Atualizar DEALS_VIEW_KEY (Kanban / useDealsView) E queryKeys.deals.lists()
              // (useDeals / DealsContext). Antes, só o primeiro era atualizado, causando
              // dessincronia: o deal aparecia no Kanban mas sumia em telas que liam o
              // cache raw — e o effect de limpeza de optimistic só liberava o item local
              // quando o staleTime (2min) expirava OU outra invalidação forçava refetch.
              //
              // Critério de dedup de temp deals: antes era só `sameTitle`, o que removia
              // o temp errado quando o usuário criava dois deals com o mesmo título
              // (acontecia ao corrigir digitação). Agora exigimos title + boardId +
              // contactId + temp recente (≤30s) — drasticamente menos colisão.
              const TEMP_MAX_AGE_MS = 30_000;
              const incomingBoardId = newData.board_id as string | undefined;
              const incomingContactId = newData.contact_id as string | undefined;
              const insertOrUpdate = <T extends { id?: string; title?: string; createdAt?: string; boardId?: string; contactId?: string }>(old: T[] | undefined): T[] | undefined => {
                if (!old || !Array.isArray(old)) return old;
                const existingIndex = old.findIndex((d) => d.id === dealId);
                if (existingIndex !== -1) {
                  return old.map((d, i) => i === existingIndex ? { ...d, ...(normalizedDeal as unknown as T) } : d);
                }
                const tempDealsRemoved = old.filter((d) => {
                  const isTemp = typeof d.id === 'string' && d.id.startsWith('temp-');
                  if (!isTemp) return true;
                  const sameTitle = d.title === newData.title;
                  if (!sameTitle) return true;
                  // Match em board+contact pra reduzir falso-positivo entre temps similares.
                  const dBoardId = (d as any).boardId ?? (d as any).board_id;
                  const dContactId = (d as any).contactId ?? (d as any).contact_id;
                  if (incomingBoardId && dBoardId && dBoardId !== incomingBoardId) return true;
                  if (incomingContactId && dContactId && dContactId !== incomingContactId) return true;
                  // Idade: temp velhos (>30s) provavelmente são órfãos de mutation que falhou —
                  // não dá pra associar com confiança ao INSERT atual, então preserva.
                  const dCreatedAt = (d as any).createdAt ?? (d as any).created_at;
                  if (dCreatedAt) {
                    const ageMs = Date.now() - new Date(dCreatedAt).getTime();
                    if (Number.isFinite(ageMs) && ageMs > TEMP_MAX_AGE_MS) return true;
                  }
                  return false; // é temp deste INSERT — remove
                });
                return [normalizedDeal as unknown as T, ...tempDealsRemoved];
              };

              queryClient.setQueryData<DealView[]>(DEALS_VIEW_KEY, insertOrUpdate);
              queryClient.setQueryData<Deal[]>(queryKeys.deals.lists(), insertOrUpdate);

              // Don't invalidate for deals INSERT - we've added it directly
              return;
            }
            
            if (!flushScheduledRef.current) {
              flushScheduledRef.current = true;
              queueMicrotask(() => {
                flushScheduledRef.current = false;

                const keysToFlush = Array.from(pendingInvalidationsRef.current);
                pendingInvalidationsRef.current.clear();
                const keysInvalidateOnly = Array.from(pendingInvalidateOnlyRef.current);
                pendingInvalidateOnlyRef.current.clear();
                const boardStagesInsertCount = pendingBoardStagesInsertCountRef.current;
                pendingBoardStagesInsertCountRef.current = 0;

                keysToFlush.forEach((queryKey) => {
                  // `active` refetches only queries currently mounted. Inactive
                  // queries are marked stale and refresh the next time a screen
                  // mounts them — avoids refetching data for pages the user
                  // isn't looking at (e.g. dashboard when on boards).
                  queryClient.invalidateQueries({
                    queryKey,
                    exact: false,
                    refetchType: 'active',
                  });
                });

                // For bursty INSERT sources (ex.: board_stages create-board burst),
                // invalidate-only (no refetch) to avoid storms. But for single INSERT, refetch to keep realtime UX.
                keysInvalidateOnly.forEach((queryKey) => {
                  queryClient.invalidateQueries({
                    queryKey,
                    exact: false,
                    refetchType: boardStagesInsertCount <= 1 ? 'active' : 'none',
                  });
                });
              });
            }
          } else {
            // For deals UPDATE: apply the Realtime payload directly to the
            // cache. Authority rule: if the incoming `updated_at` is strictly
            // newer than what we already have, apply it; otherwise skip.
            // This is enough to:
            //   - no-op the self-echo of our own optimistic write (same row,
            //     same updatedAt) without flicker
            //   - propagate cross-tab writes (incoming is newer than tab-B
            //     cache) with zero delay and no refetch
            //   - ignore genuinely stale out-of-order events
            if (payload.eventType === 'UPDATE' && table === 'deals') {
              const newData = payload.new as Record<string, unknown>;
              const dealId = newData.id as string;

              queryClient.setQueryData<DealView[]>(
                DEALS_VIEW_KEY,
                (old) => {
                  if (!old || !Array.isArray(old)) return old;

                  const idx = old.findIndex(d => d.id === dealId);
                  // Normalize snake_case keys that the cache reads as camelCase.
                  const normalizedData: Record<string, unknown> = { ...newData };
                  if (newData.updated_at && !newData.updatedAt) {
                    normalizedData.updatedAt = newData.updated_at;
                    delete normalizedData.updated_at;
                  }
                  if (newData.created_at && !newData.createdAt) {
                    normalizedData.createdAt = newData.created_at;
                    delete normalizedData.created_at;
                  }
                  if (newData.stage_id !== undefined) {
                    normalizedData.status = newData.stage_id;
                    delete normalizedData.stage_id;
                  }
                  if (newData.is_won !== undefined && newData.isWon === undefined) {
                    normalizedData.isWon = newData.is_won;
                    delete normalizedData.is_won;
                  }
                  if (newData.is_lost !== undefined && newData.isLost === undefined) {
                    normalizedData.isLost = newData.is_lost;
                    delete normalizedData.is_lost;
                  }
                  if (newData.closed_at !== undefined && newData.closedAt === undefined) {
                    normalizedData.closedAt = newData.closed_at;
                    delete normalizedData.closed_at;
                  }
                  if (newData.last_stage_change_date !== undefined && newData.lastStageChangeDate === undefined) {
                    normalizedData.lastStageChangeDate = newData.last_stage_change_date;
                    delete normalizedData.last_stage_change_date;
                  }

                  if (idx === -1) {
                    // Deal is not in local cache (e.g. created in another tab).
                    // Append it rather than drop the event.
                    return [...old, normalizedData as unknown as DealView];
                  }

                  // updatedAt comparison — strict newer wins, com tolerância
                  // de 2s para clock skew. O `updatedAt` corrente vem do
                  // optimistic do cliente (new Date().toISOString()); se o relógio
                  // do cliente estiver à frente do servidor, eventos válidos
                  // do servidor cairiam como "stale" e o cache ficaria preso
                  // no otimismo, exigindo F5.
                  const CLOCK_SKEW_TOLERANCE_MS = 2000;
                  const currentDeal = old[idx];
                  const currentUpdatedAtRaw = (currentDeal as any).updatedAt ?? (currentDeal as any).updated_at;
                  const incomingUpdatedAtRaw = normalizedData.updatedAt as string | undefined;
                  if (currentUpdatedAtRaw && incomingUpdatedAtRaw) {
                    const cur = new Date(currentUpdatedAtRaw).getTime();
                    const inc = new Date(incomingUpdatedAtRaw).getTime();
                    if (Number.isFinite(cur) && Number.isFinite(inc) && inc < cur - CLOCK_SKEW_TOLERANCE_MS) {
                      return old; // strictly older (more than skew tolerance) → stale
                    }
                  }

                  return old.map((d, i) =>
                    i === idx ? ({ ...d, ...normalizedData } as DealView) : d
                  );
                }
              );

              // Dashboard stats are derived from deals — invalidate so the
              // next mount recalculates. Only refetches if it's mounted.
              queryClient.invalidateQueries({
                queryKey: queryKeys.dashboard.stats,
                refetchType: 'active',
              });
            } else {
              // For other tables or DELETE: debounce invalidation
              if (debounceTimerRef.current) {
                clearTimeout(debounceTimerRef.current);
              }

              debounceTimerRef.current = setTimeout(() => {
                // Invalidate all pending queries
                pendingInvalidationsRef.current.forEach(queryKey => {
                  if (DEBUG_REALTIME) {
                    console.log(`[Realtime] Invalidating queries (debounced):`, queryKey);
                  }
                  queryClient.invalidateQueries({ queryKey });
                });
                pendingInvalidationsRef.current.clear();
              }, debounceMs);
            }
          }
        }
      );
    });

    // Subscribe to channel
    channel.subscribe((status) => {
      if (DEBUG_REALTIME) {
        console.log(`[Realtime] Channel ${channelName} status:`, status);
      }

      setIsConnected(status === 'SUBSCRIBED');
      
      if (status === 'SUBSCRIBED') {
        if (DEBUG_REALTIME) {
          console.log(`[Realtime] Successfully subscribed to ${tableList.join(', ')}`);
        }
      } else if (status === 'CHANNEL_ERROR') {
        // Realtime channel errors can happen transiently (network/auth refresh) and are usually recovered automatically.
        // Use warn (not error) to avoid noisy dev overlays while still keeping diagnostics.
        console.warn(`[Realtime] Channel error for ${channelName}`);
      } else if (status === 'TIMED_OUT') {
        console.warn(`[Realtime] Channel timeout for ${channelName}`);
      } else if (status === 'CLOSED') {
        if (DEBUG_REALTIME) {
          console.warn(`[Realtime] Channel closed for ${channelName}`);
        }
      }
    });

    channelRef.current = channel;

    // Cleanup
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      if (channelRef.current) {
        sb.removeChannel(channelRef.current);
        channelRef.current = null;
      }
      setIsConnected(false);
    };
    // Only re-run if enabled, tables, or debounceMs change
    // queryClient is stable, onchange is handled via ref
  }, [enabled, JSON.stringify(tables), debounceMs]);

  return {
    /** Manually trigger a sync */
    sync: () => {
      const tableList = Array.isArray(tables) ? tables : [tables];
      tableList.forEach(table => {
        const keys = getTableQueryKeys(table);
        keys.forEach(queryKey => {
          queryClient.invalidateQueries({ queryKey });
        });
      });
    },
    /** Check if channel is connected */
    isConnected,
  };
}

/**
 * Subscribe to all CRM-related tables at once
 * Ideal for the main app layout
 */
export function useRealtimeSyncAll(options: UseRealtimeSyncOptions = {}) {
  return useRealtimeSync(['deals', 'deal_items', 'deal_notes', 'contacts', 'activities', 'boards', 'crm_companies'], options);
}

/**
 * Subscribe to Kanban-related tables
 * Optimized for the boards page
 */
export function useRealtimeSyncKanban(options: UseRealtimeSyncOptions = {}) {
  return useRealtimeSync(['deals', 'deal_items', 'deal_notes', 'activities', 'board_stages'], options);
}
