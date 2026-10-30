'use client';

import React, { createContext, useContext, useMemo } from 'react';
import type { Block, FlowNode } from '../canvas/types';
import { formatCount, formatRate, type BotAnalyticsResult } from './types';

type ContextValue = { data: BotAnalyticsResult; blocks: Map<string, Block> } | null;
const BotAnalyticsContext = createContext<ContextValue>(null);

export function canOverlayBotAnalytics(data: BotAnalyticsResult | undefined, enabled: boolean, dirty = false, loadedBotUpdatedAt?: string): boolean {
  return enabled && !dirty && !!data?.isCurrentRevision && !!loadedBotUpdatedAt && data.botUpdatedAt === loadedBotUpdatedAt;
}

export function metricOutputId(block: Block, handle: string | null | undefined): string | null {
  if (!handle) return null;
  if (block.type === 'send_template' && handle.startsWith('btn:')) return `button:${handle.slice(4)}`;
  if (block.type === 'condition' && handle.startsWith('rule:')) {
    const index = block.data.rules.findIndex(rule => rule.id === handle.slice(5));
    return index < 0 ? null : `rule:${index}`;
  }
  return handle;
}

export function BotAnalyticsProvider({ data, enabled, loadedBotUpdatedAt, nodes, children }: {
  data: BotAnalyticsResult | undefined;
  enabled: boolean;
  loadedBotUpdatedAt: string;
  nodes: FlowNode[];
  children: React.ReactNode;
}) {
  const value = useMemo<ContextValue>(() => {
    if (!canOverlayBotAnalytics(data, enabled, false, loadedBotUpdatedAt) || !data) return null;
    const blocks = new Map<string, Block>();
    for (const node of nodes) {
      if (node.type === 'bubble') {
        const last = node.data.blocks.at(-1);
        if (last) blocks.set(node.id, last);
      }
    }
    return { data, blocks };
  }, [data, enabled, loadedBotUpdatedAt, nodes]);
  return <BotAnalyticsContext.Provider value={value}>{children}</BotAnalyticsContext.Provider>;
}

export function BotGroupMetric({ groupId }: { groupId: string }) {
  const ctx = useContext(BotAnalyticsContext);
  const group = ctx?.data.groups.find(item => item.id === groupId);
  if (!group) return null;
  return <p className="px-3 pb-2 text-[11px] font-medium text-primary-600 dark:text-primary-300" title="Execuções distintas que chegaram a este balão / acionamentos da versão no período">
    {formatCount(group.entered)} chegaram · {formatRate(group.percent)} do robô
  </p>;
}

export function BotStepMetric({ stepId }: { stepId: string }) {
  const ctx = useContext(BotAnalyticsContext);
  const step = ctx?.data.steps.find(item => item.id === stepId);
  if (!step) return null;
  return <p className="mt-1 text-[10px] leading-4 text-primary-600 dark:text-primary-300" title="Execuções distintas neste bloco; repetições não aumentam a taxa">
    {formatCount(step.entered)} acionamentos · {formatRate(step.percent)}
    {step.failed > 0 && <span className="ml-1 text-red-600 dark:text-red-300">· {formatCount(step.failed)} falhas</span>}
  </p>;
}

export function BotOutputMetric({ stepId, outputId }: { stepId: string; outputId: string }) {
  const ctx = useContext(BotAnalyticsContext);
  const step = ctx?.data.steps.find(item => item.id === stepId);
  const output = step?.outputs.find(item => item.id === outputId);
  if (!output || !step) return null;
  return <span className="rounded border border-primary-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-primary-700 shadow-sm dark:border-primary-700 dark:bg-slate-900 dark:text-primary-200"
    title={`${output.label}: ${formatCount(output.count)} de ${formatCount(step.entered)} execuções seguiram por esta saída`}>
    {formatCount(output.count)} · {formatRate(output.percent)}
  </span>;
}

export function BotEdgeMetric({ sourceNodeId, sourceHandle }: { sourceNodeId: string; sourceHandle: string | null | undefined }) {
  const ctx = useContext(BotAnalyticsContext);
  const block = ctx?.blocks.get(sourceNodeId);
  const outputId = block ? metricOutputId(block, sourceHandle) : null;
  return block && outputId ? <BotOutputMetric stepId={block.id} outputId={outputId} /> : null;
}
