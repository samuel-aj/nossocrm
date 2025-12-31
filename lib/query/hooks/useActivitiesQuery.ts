/**
 * TanStack Query hooks for Activities - Supabase Edition
 *
 * Features:
 * - Real Supabase API calls
 * - Optimistic updates for instant UI feedback
 * - Automatic cache invalidation
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../index';
import { activitiesService } from '@/lib/supabase';
import { sortActivitiesSmart } from '@/lib/utils/activitySort';
import { useAuth } from '@/context/AuthContext';
import type { Activity } from '@/types';

// ============ QUERY HOOKS ============

export interface ActivitiesFilters {
  dealId?: string;
  type?: Activity['type'];
  completed?: boolean;
  dateFrom?: string;
  dateTo?: string;
}

/**
 * Hook to fetch all activities with optional filters
 * Waits for auth to be ready before fetching to ensure RLS works correctly
 */
export const useActivities = (filters?: ActivitiesFilters) => {
  const { user, loading: authLoading } = useAuth();

  return useQuery({
    queryKey: filters
      ? queryKeys.activities.list(filters as Record<string, unknown>)
      : queryKeys.activities.lists(),
    queryFn: async () => {
      // #region agent log
      if (process.env.NODE_ENV !== 'production') {
        fetch('http://127.0.0.1:7242/ingest/d70f541c-09d7-4128-9745-93f15f184017',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'boards-activities-visibility-2',hypothesisId:'A1',location:'lib/query/hooks/useActivitiesQuery.ts:useActivities:queryFn',message:'Fetching activities (useActivities)',data:{authReady:!authLoading&&!!user,hasFilters:!!filters,filtersKeys:filters?Object.keys(filters):[]},timestamp:Date.now()})}).catch(()=>{});
      }
      // #endregion
      const { data, error } = await activitiesService.getAll();
      if (error) throw error;

      let activities = data || [];

      // Apply client-side filters
      if (filters) {
        activities = activities.filter(activity => {
          if (filters.dealId && activity.dealId !== filters.dealId) return false;
          if (filters.type && activity.type !== filters.type) return false;
          if (filters.completed !== undefined && activity.completed !== filters.completed)
            return false;
          if (filters.dateFrom) {
            const activityDate = new Date(activity.date);
            const fromDate = new Date(filters.dateFrom);
            if (activityDate < fromDate) return false;
          }
          if (filters.dateTo) {
            const activityDate = new Date(activity.date);
            const toDate = new Date(filters.dateTo);
            if (activityDate > toDate) return false;
          }
          return true;
        });
      }

      // Apply smart sorting (already sorted by service, but re-sort after filtering)
      // #region agent log
      if (process.env.NODE_ENV !== 'production') {
        fetch('http://127.0.0.1:7242/ingest/d70f541c-09d7-4128-9745-93f15f184017',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'boards-activities-visibility-2',hypothesisId:'A1',location:'lib/query/hooks/useActivitiesQuery.ts:useActivities:queryFn',message:'Fetched activities (useActivities)',data:{rawCount:(data||[]).length,afterFilterCount:activities.length},timestamp:Date.now()})}).catch(()=>{});
      }
      // #endregion
      return sortActivitiesSmart(activities);
    },
    enabled: !authLoading && !!user, // Only fetch when auth is ready
    staleTime: 30 * 1000, // 30 seconds - short staleTime for Realtime updates
  });
};

/**
 * Hook to fetch activities for a specific deal
 */
export const useActivitiesByDeal = (dealId: string | undefined) => {
  const { user, loading: authLoading } = useAuth();
  return useQuery({
    queryKey: queryKeys.activities.byDeal(dealId || ''),
    queryFn: async () => {
      const { data, error } = await activitiesService.getAll();
      if (error) throw error;
      const filtered = (data || []).filter(a => a.dealId === dealId);
      return sortActivitiesSmart(filtered);
    },
    enabled: !authLoading && !!user && !!dealId,
  });
};

/**
 * Hook to fetch pending activities (not completed)
 */
export const usePendingActivities = () => {
  const { user, loading: authLoading } = useAuth();
  return useQuery({
    queryKey: queryKeys.activities.list({ completed: false }),
    queryFn: async () => {
      const { data, error } = await activitiesService.getAll();
      if (error) throw error;
      const filtered = (data || []).filter(a => !a.completed);
      return sortActivitiesSmart(filtered);
    },
    enabled: !authLoading && !!user,
  });
};

/**
 * Hook to fetch today's activities
 */
export const useTodayActivities = () => {
  const { user, loading: authLoading } = useAuth();
  const today = new Date().toISOString().split('T')[0];

  return useQuery({
    queryKey: queryKeys.activities.list({ date: today }),
    queryFn: async () => {
      const { data, error } = await activitiesService.getAll();
      if (error) throw error;
      const filtered = (data || []).filter(a => a.date.startsWith(today));
      return sortActivitiesSmart(filtered);
    },
    staleTime: 30 * 1000, // 30 seconds - very fresh for today's view
    enabled: !authLoading && !!user,
  });
};

// ============ MUTATION HOOKS ============

interface CreateActivityParams {
  activity: Omit<Activity, 'id' | 'createdAt'>;
}

/**
 * Hook to create a new activity
 * Requires organizationId (tenant) for RLS compliance
 */
export const useCreateActivity = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ activity }: CreateActivityParams) => {
      const t0 = Date.now();
      const { data, error } = await activitiesService.create(activity);
      if (error) throw error;
      // #region agent log
      if (process.env.NODE_ENV !== 'production') {
        fetch('http://127.0.0.1:7242/ingest/d70f541c-09d7-4128-9745-93f15f184017',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'boards-activities-visibility-2',hypothesisId:'A2',location:'lib/query/hooks/useActivitiesQuery.ts:useCreateActivity:mutationFn',message:'activitiesService.create finished',data:{ms:Date.now()-t0,type:(activity as any)?.type??null,completed:(activity as any)?.completed??null},timestamp:Date.now()})}).catch(()=>{});
      }
      // #endregion
      return data!;
    },
    onMutate: async ({ activity: newActivity }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.activities.all });
      const previousActivities = queryClient.getQueryData<Activity[]>(queryKeys.activities.lists());

      const tempActivity: Activity = {
        ...newActivity,
        id: `temp-${Date.now()}`,
      } as Activity;

      // Insert temp activity and re-sort intelligently
      queryClient.setQueryData<Activity[]>(queryKeys.activities.lists(), (old = []) => {
        const withNew = [...old, tempActivity];
        return sortActivitiesSmart(withNew);
      });
      // #region agent log
      if (process.env.NODE_ENV !== 'production') {
        fetch('http://127.0.0.1:7242/ingest/d70f541c-09d7-4128-9745-93f15f184017',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'boards-activities-visibility-2',hypothesisId:'A3',location:'lib/query/hooks/useActivitiesQuery.ts:useCreateActivity:onMutate',message:'Optimistic insert activity into activities.lists()',data:{previousCount:previousActivities?.length??null,tempId:tempActivity.id},timestamp:Date.now()})}).catch(()=>{});
      }
      // #endregion
      return { previousActivities, tempId: tempActivity.id };
    },
    onSuccess: (data, _variables, context) => {
      // Replace temp activity with real one from server and re-sort
      // This ensures immediate UI update while Realtime syncs in background
      queryClient.setQueryData<Activity[]>(queryKeys.activities.lists(), (old = []) => {
        if (!old) return [data];
        const tempId = context?.tempId;
        
        // Check if activity already exists (race condition: Realtime may have already refetched)
        const existingIndex = old.findIndex(a => a.id === data.id);
        if (existingIndex !== -1) {
          // Activity already exists, just re-sort (Realtime already added it)
          return sortActivitiesSmart(old);
        }
        
        if (tempId) {
          // Remove temp activity, add real one, and re-sort
          const withoutTemp = old.filter(a => a.id !== tempId);
          const withReal = [...withoutTemp, data];
          return sortActivitiesSmart(withReal);
        }
        // If temp not found, just add the new one and re-sort
        return sortActivitiesSmart([...old, data]);
      });
      
      // Invalidate to ensure Realtime updates are picked up
      // This is a no-op if data is already fresh, but ensures consistency
      queryClient.invalidateQueries({ queryKey: queryKeys.activities.all });
      // #region agent log
      if (process.env.NODE_ENV !== 'production') {
        fetch('http://127.0.0.1:7242/ingest/d70f541c-09d7-4128-9745-93f15f184017',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'boards-activities-visibility-2',hypothesisId:'A3',location:'lib/query/hooks/useActivitiesQuery.ts:useCreateActivity:onSuccess',message:'Create activity success; invalidated activities.all',data:{hasTempId:!!context?.tempId},timestamp:Date.now()})}).catch(()=>{});
      }
      // #endregion
    },
    onError: (_error, _params, context) => {
      if (context?.previousActivities) {
        queryClient.setQueryData(queryKeys.activities.lists(), context.previousActivities);
      }
    },
    onSettled: () => {
      // Final invalidation to ensure Realtime updates are picked up
      queryClient.invalidateQueries({ queryKey: queryKeys.activities.all });
      // #region agent log
      if (process.env.NODE_ENV !== 'production') {
        fetch('http://127.0.0.1:7242/ingest/d70f541c-09d7-4128-9745-93f15f184017',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'boards-activities-visibility-2',hypothesisId:'A4',location:'lib/query/hooks/useActivitiesQuery.ts:useCreateActivity:onSettled',message:'Create activity settled; invalidated activities.all',data:{},timestamp:Date.now()})}).catch(()=>{});
      }
      // #endregion
    },
  });
};

/**
 * Hook to update an activity
 */
export const useUpdateActivity = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<Activity> }) => {
      const { error } = await activitiesService.update(id, updates);
      if (error) throw error;
      return { id, updates };
    },
    onMutate: async ({ id, updates }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.activities.all });
      const previousActivities = queryClient.getQueryData<Activity[]>(queryKeys.activities.lists());
      queryClient.setQueryData<Activity[]>(queryKeys.activities.lists(), (old = []) => {
        const updated = old.map(activity => (activity.id === id ? { ...activity, ...updates } : activity));
        // Re-sort after update (especially important if date changed)
        return sortActivitiesSmart(updated);
      });
      return { previousActivities };
    },
    onError: (_error, _variables, context) => {
      if (context?.previousActivities) {
        queryClient.setQueryData(queryKeys.activities.lists(), context.previousActivities);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.activities.all });
    },
  });
};

/**
 * Hook to toggle activity completion
 */
export const useToggleActivity = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await activitiesService.toggleCompletion(id);
      if (error) throw error;
      return { id, completed: data! };
    },
    onMutate: async id => {
      await queryClient.cancelQueries({ queryKey: queryKeys.activities.all });
      const previousActivities = queryClient.getQueryData<Activity[]>(queryKeys.activities.lists());
      queryClient.setQueryData<Activity[]>(queryKeys.activities.lists(), (old = []) =>
        old.map(activity =>
          activity.id === id ? { ...activity, completed: !activity.completed } : activity
        )
      );
      return { previousActivities };
    },
    onError: (_error, _id, context) => {
      if (context?.previousActivities) {
        queryClient.setQueryData(queryKeys.activities.lists(), context.previousActivities);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.activities.all });
    },
  });
};

/**
 * Hook to delete an activity
 */
export const useDeleteActivity = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await activitiesService.delete(id);
      if (error) throw error;
      return id;
    },
    onMutate: async id => {
      await queryClient.cancelQueries({ queryKey: queryKeys.activities.all });
      const previousActivities = queryClient.getQueryData<Activity[]>(queryKeys.activities.lists());
      queryClient.setQueryData<Activity[]>(queryKeys.activities.lists(), (old = []) =>
        old.filter(activity => activity.id !== id)
      );
      return { previousActivities };
    },
    onError: (_error, _id, context) => {
      if (context?.previousActivities) {
        queryClient.setQueryData(queryKeys.activities.lists(), context.previousActivities);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.activities.all });
    },
  });
};
