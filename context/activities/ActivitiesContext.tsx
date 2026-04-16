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
import { queryKeys } from '@/lib/query';
import { useActivities as useTanStackActivities } from '@/lib/query/hooks/useActivitiesQuery';

interface ActivitiesContextType {
  activities: Activity[];
  loading: boolean;
  error: string | null;
  addActivity: (activity: Omit<Activity, 'id' | 'createdAt'>) => Promise<Activity | null>;
  updateActivity: (id: string, updates: Partial<Activity>) => Promise<void>;
  deleteActivity: (id: string) => Promise<void>;
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
 * Componente React `ActivitiesProvider`.
 *
 * @param {{ children: ReactNode; }} { children } - Parâmetro `{ children }`.
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export const ActivitiesProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { profile } = useAuth();
  const queryClient = useQueryClient();

  // ============================================
  // TanStack Query como fonte única de verdade
  // ============================================
  const {
    data: activities = [],
    isLoading: loading,
    error: queryError,
  } = useTanStackActivities();

  // Converte erro do TanStack Query para string
  const error = queryError ? (queryError as Error).message : null;

  // Refresh = invalidar cache do TanStack Query
  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.activities.all });
  }, [queryClient]);

  // ============================================
  // CRUD Operations - Usam service + invalidam cache
  // ============================================
  const addActivity = useCallback(
    async (activity: Omit<Activity, 'id' | 'createdAt'>): Promise<Activity | null> => {
      if (!profile) {
        console.error('Usuário não autenticado');
        return null;
      }
      const { data, error: addError } = await activitiesService.create(activity);

      if (addError) {
        console.error('Erro ao criar atividade:', addError.message);
        return null;
      }

      // Invalida cache para TanStack Query atualizar
      // Don't await invalidations — awaiting can block UI flows until heavy refetches finish.
      void queryClient.invalidateQueries({ queryKey: queryKeys.activities.all });

      return data;
    },
    [profile?.organization_id, queryClient]
  );

  // Tracks activities currently being mutated so consumers can disable controls
  // and we can ignore reentrant clicks. Uses ref for the write-side (so updates
  // inside rapid sequential calls are seen by the guard check below) and mirrors
  // into state so React can re-render on change.
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
    // pendingVersion dep keeps the function identity stable-per-change so
    // memoized consumers re-evaluate when the pending set flips.
    [pendingVersion] // eslint-disable-line react-hooks/exhaustive-deps
  );

  /**
   * Patch the activities list cache immediately and snapshot the previous
   * value so we can roll back on error. IMPORTANT: callers must cancelQueries
   * BEFORE invoking this so an in-flight refetch can't resolve after the patch
   * and overwrite the optimistic state with stale data (the root cause of the
   * "toggle flips back by itself" bug).
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

  const updateActivity = useCallback(
    async (id: string, updates: Partial<Activity>) => {
      if (pendingIdsRef.current.has(id)) return; // guard against rapid clicks
      markPending(id);
      try {
        // CRITICAL: cancel in-flight fetches before optimistic write — otherwise
        // a refetch that resolves after us overwrites the new state with stale data.
        await queryClient.cancelQueries({ queryKey: queryKeys.activities.all });

        const previous = patchActivitiesCache(list =>
          list.map(a => (a.id === id ? { ...a, ...updates } : a))
        );

        const { error: updateError } = await activitiesService.update(id, updates);

        if (updateError) {
          console.error('Erro ao atualizar atividade:', updateError.message);
          if (previous) queryClient.setQueryData(queryKeys.activities.lists(), previous);
          return;
        }

        void queryClient.invalidateQueries({ queryKey: queryKeys.activities.all });
      } finally {
        unmarkPending(id);
      }
    },
    [markPending, unmarkPending, patchActivitiesCache, queryClient]
  );

  const deleteActivity = useCallback(
    async (id: string) => {
      if (pendingIdsRef.current.has(id)) return;
      markPending(id);
      try {
        await queryClient.cancelQueries({ queryKey: queryKeys.activities.all });

        const previous = patchActivitiesCache(list => list.filter(a => a.id !== id));

        const { error: deleteError } = await activitiesService.delete(id);

        if (deleteError) {
          console.error('Erro ao deletar atividade:', deleteError.message);
          if (previous) queryClient.setQueryData(queryKeys.activities.lists(), previous);
          return;
        }

        void queryClient.invalidateQueries({ queryKey: queryKeys.activities.all });
      } finally {
        unmarkPending(id);
      }
    },
    [markPending, unmarkPending, patchActivitiesCache, queryClient]
  );

  const toggleActivityCompletion = useCallback(
    async (id: string) => {
      if (pendingIdsRef.current.has(id)) return;

      // Read target state from the CURRENT cache, not the closure, so sequential
      // toggles always flip relative to the latest optimistic state instead of
      // a stale render snapshot.
      const cached = queryClient.getQueryData<Activity[]>(queryKeys.activities.lists());
      const activity = cached?.find(a => a.id === id) ?? activities.find(a => a.id === id);
      if (!activity) return;
      const nextCompleted = !activity.completed;

      markPending(id);
      try {
        await queryClient.cancelQueries({ queryKey: queryKeys.activities.all });

        const previous = patchActivitiesCache(list =>
          list.map(a => (a.id === id ? { ...a, completed: nextCompleted } : a))
        );

        // Use `update` with the explicit target value (not toggleCompletion which
        // re-reads the server-side value and could race with our optimistic state
        // if multiple toggles are issued in quick succession).
        const { error: toggleError } = await activitiesService.update(id, {
          completed: nextCompleted,
        });

        if (toggleError) {
          console.error('Erro ao alternar atividade:', toggleError.message);
          if (previous) queryClient.setQueryData(queryKeys.activities.lists(), previous);
          return;
        }

        void queryClient.invalidateQueries({ queryKey: queryKeys.activities.all });
      } finally {
        unmarkPending(id);
      }
    },
    [activities, markPending, unmarkPending, patchActivitiesCache, queryClient]
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
