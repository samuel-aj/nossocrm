'use client';

import { useQuery } from '@tanstack/react-query';
import { getDateRange, type PeriodFilter } from '@/features/dashboard/hooks/useDashboardMetrics';
import { waAgentsFetch, WA_AGENTS_QUERY_KEY } from '../useWaAgents';
import type { BotAnalyticsResult } from './types';

export function botAnalyticsParams(period: PeriodFilter, revision: string, goalStepId: string): URLSearchParams {
  const range = getDateRange(period);
  const params = new URLSearchParams({ start: range.start.toISOString(), end: range.end.toISOString() });
  if (revision) params.set('revision', revision);
  if (goalStepId) params.set('goalStepId', goalStepId);
  return params;
}

export function useBotAnalytics(botId: string | null, enabled: boolean, period: PeriodFilter, revision: string, goalStepId: string, versionKey = '') {
  const params = botAnalyticsParams(period, revision, goalStepId);
  const search = params.toString();
  return useQuery({
    queryKey: [WA_AGENTS_QUERY_KEY, 'botAnalytics', botId, search, versionKey],
    queryFn: () => waAgentsFetch<BotAnalyticsResult>(`/api/wa-agents/bots/${encodeURIComponent(botId!)}/analytics?${search}`),
    enabled: enabled && !!botId,
    staleTime: 30_000,
    refetchInterval: enabled ? 60_000 : false,
  });
}
