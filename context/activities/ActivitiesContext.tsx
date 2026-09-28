import React, {
  createContext,
  useContext,
  useMemo,
  useCallback,
  useRef,
  useState,
  ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Activity } from '@/types';
import { activitiesService } from '@/lib/supabase';
import { useAuth } from '../AuthContext';
import { invalidateLeadHistory } from '@/features/deals/lead/leadHistoryInvalidation';
import { queryKeys } from '@/lib/query';
import { useActivities as useTanStackActivities } from '@/lib/query/hooks/useActivitiesQuery';

interface ActivitiesContextType {
  activities: Activity[];
  loading: boolean;
  error: string | null;
  addActivity: (activity: Omit<Activity, 'id' | 'createdAt'>) => Promise<Activity | null>;
  updateActivity: (id: string, updates: Partial<Activity>, options?: { throwOnError?: boolean }) => Promise<void>;
  deleteActivity: (id: string, options?: { throwOnError?: boolean }) => Promise<void>;
  toggleActivityCompletion: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
  /**
   * Returns true while a create/update/delete/toggle is in-flight for this id.
   * Consumers should disable their mutation controls while this is true so
   * rapid clicks can't queue up conflicting writes.
   */
  isActivityPending: (id: string) => boolean;
}

const ActivitiesContext = createContext<ActivitiesContextType | undefined>(undefined);

/**
 * Activities mutations follow an OPTIMISTIC-CACHE-AS-TRUTH model:
 *
 *  1. Client writes the intended state to the TanStack cache immediately
 *     (the UI re-renders from this cache, so the change is visible instantly).
 *  2. Server call is fired. On success, WE DO NOT invalidate the cache —
 *     that would force a refetch whose response can race with our optimistic
 *     value and cause the "marca/desmarca sozinho" flicker.
 *  3. Cross-client consistency comes from the Supabase Realtime subscription
 *     applying INSERT/UPDATE/DELETE payloads directly to the same cache.
 *  4. On error, we roll the cache back to the pre-write snapshot.
 *
 * This mirrors the strategy already used for `deals` UPDATE events and is the
 * only way to make optimistic UI and Realtime echoes coexist without flicker.
 */
export const ActivitiesProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { profile, organizationId } = useAuth();
  const queryClient = useQueryClient();
  const activeOrgRef = useRef(organizationId);
  activeOrgRef.current = organizationId;

  // ============================================
  // TanStack Query como fonte única de verdade
  // ============================================
  const {
    data: activities = [],
    isLoading: loading,
    error: queryError,
  } = useTanStackActivities();

  const error = queryError ? (queryError as Error).message : null;

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.activities.all });
  }, [queryClient]);

  // Tracks activities currently being mutated so consumers can disable controls
  // and we can ignore reentrant clicks. Uses ref for the write-side and mirrors
  // into state so React re-renders on change.
  const pendingIdsRef = useRef<Set<string>>(new Set());
  const [pendingVersion, setPendingVersion] = useState(0);
  const markPending = useCallback((id: string) => {
    pendingIdsRef.current.add(id);
    setPendingVersion(v => v + 1);
  }, []);
  const unmarkPending = useCallback((id: string) => {
    pendingIdsRef.current.delete(id);
    setPendingVersion(v => v + 1);
  }, []);
  const isActivityPending = useCallback(
    (id: string) => pendingIdsRef.current.has(id),
    [pendingVersion]
  );

  /**
   * Snapshot + mutate the activities list cache. Returns the previous list so
   * the caller can rollback on error.
   */
  const patchActivitiesCache = useCallback(
    (mutator: (list: Activity[]) => Activity[]) => {
      const listsKey = queryKeys.activities.lists();
      const previous = queryClient.getQueryData<Activity[]>(listsKey);
      queryClient.setQueryData<Activity[]>(listsKey, (old = []) => mutator(old));
      return previous;
    },
    [queryClient]
  );

  const addActivity = useCallback(
    async (activity: Omit<Activity, 'id' | 'createdAt'>): Promise<Activity | null> => {
      if (!profile) {
        console.error('Usuário não autenticado');
        return null;
      }

      // Optimistic insert with a temporary id so the timeline/list reflects
      // the new activity immediately, before the server responds.
      const tempId = `temp-activity-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const tempActivity: Activity = {
        ...activity,
        id: tempId,
      } as Activity;

      // Cancel any in-flight refetch so it can't resolve after us and drop
      // the temp activity before the real one replaces it.
      await queryClient.cancelQueries({ queryKey: queryKeys.activities.all });
      if (activeOrgRef.current !== organizationId) throw new Error("A organização mudou durante o salvamento");

      const previous = patchActivitiesCache(list => [tempActivity, ...list]);

      const { data, error: addError } = await activitiesService.create(activity);

      if (addError || !data) {
        console.error('Erro ao criar atividade:', addError?.message);
        if (previous && activeOrgRef.current === organizationId) queryClient.setQueryData(queryKeys.activities.lists(), previous);
        return null;
      }

      // Swap the temp entry for the real server row. If the Realtime INSERT
      // echo already added the real row, just drop the temp and don't duplicate.
      if (activeOrgRef.current === organizationId) patchActivitiesCache(list => {
        const withoutTemp = list.filter(a => a.id !== tempId);
        const alreadyPresent = withoutTemp.some(a => a.id === data.id);
        return alreadyPresent ? withoutTemp : [data, ...withoutTemp];
      });

      // The canonical activity cache is already correct. Only its read
      // projection is invalidated; realtime keeps other clients in sync.
      void invalidateLeadHistory(queryClient, organizationId, data.dealId);
      return data;
    },
    [profile, organizationId, queryClient, patchActivitiesCache]
  );

  const updateActivity = useCallback(
    async (id: string, updates: Partial<Activity>, options?: { throwOnError?: boolean }) => {
      if (pendingIdsRef.current.has(id)) { if (options?.throwOnError) throw new Error("Atividade já está sendo salva"); return; }
      const sourceDealId = queryClient.getQueryData<Activity[]>(queryKeys.activities.lists())?.find(a => a.id === id)?.dealId;
      markPending(id);
      try {
        await queryClient.cancelQueries({ queryKey: queryKeys.activities.all });
        if (activeOrgRef.current !== organizationId) throw new Error("A organização mudou durante o salvamento");

        const previous = patchActivitiesCache(list =>
          list.map(a => (a.id === id ? { ...a, ...updates } : a))
        );

        const { error: updateError } = await activitiesService.update(id, updates);

        if (updateError) {
          console.error('Erro ao atualizar atividade:', updateError.message);
          if (previous && activeOrgRef.current === organizationId) queryClient.setQueryData(queryKeys.activities.lists(), previous);
          if (options?.throwOnError) throw new Error(updateError.message);
          return;
        }

        // Preserve the canonical list; revalidate only the history projection.
        void invalidateLeadHistory(queryClient, organizationId, sourceDealId, id);
      } finally {
        unmarkPending(id);
      }
    },
    [organizationId, markPending, unmarkPending, patchActivitiesCache, queryClient]
  );

  const deleteActivity = useCallback(
    async (id: string, options?: { throwOnError?: boolean }) => {
      if (pendingIdsRef.current.has(id)) { if (options?.throwOnError) throw new Error("Atividade já está sendo salva"); return; }
      const sourceDealId = queryClient.getQueryData<Activity[]>(queryKeys.activities.lists())?.find(a => a.id === id)?.dealId;
      markPending(id);
      try {
        await queryClient.cancelQueries({ queryKey: queryKeys.activities.all });
        if (activeOrgRef.current !== organizationId) throw new Error("A organização mudou durante o salvamento");

        const previous = patchActivitiesCache(list => list.filter(a => a.id !== id));

        const { error: deleteError } = await activitiesService.delete(id);

        if (deleteError) {
          console.error('Erro ao deletar atividade:', deleteError.message);
          if (previous && activeOrgRef.current === organizationId) queryClient.setQueryData(queryKeys.activities.lists(), previous);
          if (options?.throwOnError) throw new Error(deleteError.message);
          return;
        }
        void invalidateLeadHistory(queryClient, organizationId, sourceDealId, id);
      } finally {
        unmarkPending(id);
      }
    },
    [organizationId, markPending, unmarkPending, patchActivitiesCache, queryClient]
  );

  const toggleActivityCompletion = useCallback(
    async (id: string) => {
      if (pendingIdsRef.current.has(id)) return;

      const cached = queryClient.getQueryData<Activity[]>(queryKeys.activities.lists());
      const activity = cached?.find(a => a.id === id) ?? activities.find(a => a.id === id);
      if (!activity) return;
      const nextCompleted = !activity.completed;

      const sourceDealId = queryClient.getQueryData<Activity[]>(queryKeys.activities.lists())?.find(a => a.id === id)?.dealId;
      markPending(id);
      try {
        await queryClient.cancelQueries({ queryKey: queryKeys.activities.all });
        if (activeOrgRef.current !== organizationId) throw new Error("A organização mudou durante o salvamento");

        const previous = patchActivitiesCache(list =>
          list.map(a => (a.id === id ? { ...a, completed: nextCompleted } : a))
        );

        const { error: toggleError } = await activitiesService.update(id, {
          completed: nextCompleted,
        });

        if (toggleError) {
          console.error('Erro ao alternar atividade:', toggleError.message);
          if (previous && activeOrgRef.current === organizationId) queryClient.setQueryData(queryKeys.activities.lists(), previous);
          return;
        }
        void invalidateLeadHistory(queryClient, organizationId, sourceDealId, id);
      } finally {
        unmarkPending(id);
      }
    },
    [organizationId, activities, markPending, unmarkPending, patchActivitiesCache, queryClient]
  );

  const value = useMemo(
    () => ({
      activities,
      loading,
      error,
      addActivity,
      updateActivity,
      deleteActivity,
      toggleActivityCompletion,
      refresh,
      isActivityPending,
    }),
    [
      activities,
      loading,
      error,
      addActivity,
      updateActivity,
      deleteActivity,
      toggleActivityCompletion,
      refresh,
      isActivityPending,
    ]
  );

  return <ActivitiesContext.Provider value={value}>{children}</ActivitiesContext.Provider>;
};

/**
 * Hook React `useActivities` que encapsula uma lógica reutilizável.
 * @returns {ActivitiesContextType} Retorna um valor do tipo `ActivitiesContextType`.
 */
export const useActivities = () => {
  const context = useContext(ActivitiesContext);
  if (context === undefined) {
    throw new Error('useActivities must be used within a ActivitiesProvider');
  }
  return context;
};
