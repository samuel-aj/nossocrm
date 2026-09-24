'use client';
import { useQuery } from '@tanstack/react-query';
import type { BotTemplateRow } from '@/lib/wa-agents/botTemplates';
import { waAgentsFetch, WA_AGENTS_QUERY_KEY } from '../useWaAgents';
export const BOT_TEMPLATES_KEY = [WA_AGENTS_QUERY_KEY, 'botTemplates'];
export function useBotTemplates(enabled = true) {
  return useQuery({ queryKey: BOT_TEMPLATES_KEY, enabled, queryFn: () => waAgentsFetch<{ templates: BotTemplateRow[]; canPublish: boolean }>('/api/wa-agents/bot-templates') });
}
