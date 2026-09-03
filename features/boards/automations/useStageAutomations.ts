'use client';

/**
 * Automações que disparam quando um lead ENTRA numa etapa do board, reunindo
 * o que já existe no CRM (nada novo no backend):
 * - Ações da etapa (robôs marcados como automação da etapa: um passo cada);
 * - Robôs comuns com gatilho "entrou na etapa" / "criado" nessa etapa;
 * - Agentes de IA com gatilho por cadastro no pipeline apontando para a etapa;
 * - Webhooks do pipeline (integration_outbound_endpoints, kind = 'pipeline')
 *   com etapa de destino igual à etapa.
 *
 * Expõe a lista por etapa e as ações (ativar/desativar, excluir) usando os
 * mesmos serviços das telas de Configurações.
 */
import { useCallback, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase/client';
import { DEFAULT_AGENT_TRIGGERS, type BotRow, type BotStep } from '@/lib/wa-agents/types';
import {
  useDeleteWaBot,
  useSaveWaAgent,
  useSaveWaBot,
  useWaAgentsList,
  useWaBotsList,
  type WaAgentListItem,
} from '@/features/wa-agents/useWaAgents';
import type { Board } from '@/types';
import { describeStageAction, isStageAutomationBot, stageActionStep } from './stageAutomationModel';

export type StageAutomationKind = 'action' | 'bot' | 'agent' | 'webhook';

export type StageAutomation = {
  id: string;
  kind: StageAutomationKind;
  stageId: string;
  title: string;
  subtitle: string;
  enabled: boolean;
  /** id da entidade original (robô, agente ou regra de webhook) */
  refId: string;
  bot?: BotRow;
  agent?: WaAgentListItem;
  rule?: PipelineRule;
};

export type PipelineRule = {
  id: string;
  name: string;
  url: string;
  secret: string;
  active: boolean;
  events: string[];
  board_id: string | null;
  from_stage_id: string | null;
  to_stage_id: string | null;
};

export const PIPELINE_RULES_QUERY_KEY = ['pipelineRules'] as const;

const STEP_SHORT: Record<string, string> = {
  send_text: 'Envia mensagem',
  send_template: 'Envia modelo',
  send_media: 'Envia mídia',
  typing: 'Digitando',
  start_bot: 'Inicia outro robô',
  wait: 'Espera',
  wait_reply: 'Espera resposta',
  condition: 'Condição',
  move_stage: 'Move de etapa',
  add_tag: 'Adiciona tag',
  webhook: 'Chama webhook',
  handoff_agent: 'Entrega ao agente de IA',
  end: 'Encerra',
};

function describeBotSteps(steps: BotStep[] | undefined): string {
  const list = (steps ?? []).filter((s) => s.type !== 'end').slice(0, 3).map((s) => STEP_SHORT[s.type] ?? s.type);
  if (list.length === 0) return 'Sem passos ainda';
  const more = (steps ?? []).filter((s) => s.type !== 'end').length - list.length;
  return list.join(' · ') + (more > 0 ? ` · +${more}` : '');
}

function botHitsStage(bot: BotRow, stageId: string): boolean {
  const t = bot.trigger;
  if (!t || t.stage_id !== stageId) return false;
  return t.type === 'deal_stage_entered' || t.type === 'deal_created';
}

export function useStageAutomations(board: Board | null | undefined) {
  const { profile } = useAuth();
  const orgId = profile?.organization_id ?? null;
  const qc = useQueryClient();
  const botsQ = useWaBotsList();
  const agentsQ = useWaAgentsList();
  const saveBot = useSaveWaBot();
  const deleteBot = useDeleteWaBot();
  const saveAgent = useSaveWaAgent();

  const rulesQ = useQuery({
    queryKey: [...PIPELINE_RULES_QUERY_KEY, orgId],
    enabled: !!orgId && !!supabase,
    staleTime: 30 * 1000,
    queryFn: async (): Promise<PipelineRule[]> => {
      if (!supabase || !orgId) return [];
      const { data, error } = await supabase
        .from('integration_outbound_endpoints')
        .select('id,name,url,secret,active,events,board_id,from_stage_id,to_stage_id')
        .eq('organization_id', orgId)
        .eq('kind', 'pipeline')
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as PipelineRule[];
    },
  });

  const byStage = useMemo(() => {
    const map = new Map<string, StageAutomation[]>();
    if (!board) return map;
    const agents = agentsQ.data ?? [];
    for (const stage of board.stages) {
      const items: StageAutomation[] = [];
      for (const bot of botsQ.data ?? []) {
        if (!botHitsStage(bot, stage.id)) continue;
        const step = isStageAutomationBot(bot) ? stageActionStep(bot) : null;
        if (step) {
          items.push({
            id: `action:${bot.id}`,
            kind: 'action',
            stageId: stage.id,
            title: bot.name.replace(`${stage.label} · `, ''),
            subtitle: describeStageAction(step, { stages: board.stages, agents }),
            enabled: bot.enabled,
            refId: bot.id,
            bot,
          });
        } else {
          items.push({
            id: `bot:${bot.id}`,
            kind: 'bot',
            stageId: stage.id,
            title: bot.name,
            subtitle: describeBotSteps(bot.steps),
            enabled: bot.enabled,
            refId: bot.id,
            bot,
          });
        }
      }
      for (const agent of agents) {
        const deal = agent.triggers?.deal;
        if (!deal || deal.stage_id !== stage.id || deal.event !== 'deal_stage_entered') continue;
        items.push({
          id: `agent:${agent.id}`,
          kind: 'agent',
          stageId: stage.id,
          title: 'Agente de IA inicia a conversa',
          subtitle: agent.persona_name ? `${agent.name} (${agent.persona_name})` : agent.name,
          enabled: !!deal.enabled && agent.enabled,
          refId: agent.id,
          agent,
        });
      }
      for (const rule of rulesQ.data ?? []) {
        if (rule.to_stage_id !== stage.id) continue;
        let host = rule.url;
        try {
          host = new URL(rule.url).host;
        } catch {
          // URL inválida: mostra como está
        }
        items.push({
          id: `webhook:${rule.id}`,
          kind: 'webhook',
          stageId: stage.id,
          title: rule.name || 'Webhook',
          subtitle: host,
          enabled: rule.active,
          refId: rule.id,
          rule,
        });
      }
      map.set(stage.id, items);
    }
    return map;
  }, [board, botsQ.data, agentsQ.data, rulesQ.data]);

  const ruleMutation = useMutation({
    mutationFn: async (input: { id: string; patch?: Partial<PipelineRule>; remove?: boolean }) => {
      if (!supabase) throw new Error('Supabase não configurado');
      if (input.remove) {
        const { error } = await supabase.from('integration_outbound_endpoints').delete().eq('id', input.id);
        if (error) throw error;
        return;
      }
      const { error } = await supabase.from('integration_outbound_endpoints').update(input.patch ?? {}).eq('id', input.id);
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: PIPELINE_RULES_QUERY_KEY });
    },
  });

  /** Gatilho de pipeline do agente com um ajuste (mantém o resto como está). */
  const patchAgentDeal = useCallback(
    async (agent: WaAgentListItem, patch: Partial<NonNullable<WaAgentListItem['triggers']>['deal']>) => {
      const triggers = agent.triggers ?? DEFAULT_AGENT_TRIGGERS;
      await saveAgent.mutateAsync({
        id: agent.id,
        input: { triggers: { inbound: triggers.inbound ?? DEFAULT_AGENT_TRIGGERS.inbound, deal: { ...DEFAULT_AGENT_TRIGGERS.deal, ...triggers.deal, ...patch } } },
      });
    },
    [saveAgent]
  );

  const toggle = useCallback(
    async (item: StageAutomation) => {
      if (item.kind === 'action' || item.kind === 'bot') {
        await saveBot.mutateAsync({ id: item.refId, input: { enabled: !item.enabled } });
      } else if (item.kind === 'agent') {
        if (!item.agent) return;
        const deal = item.agent.triggers?.deal;
        await patchAgentDeal(item.agent, { enabled: !deal?.enabled });
      } else {
        await ruleMutation.mutateAsync({ id: item.refId, patch: { active: !item.enabled } });
      }
    },
    [saveBot, patchAgentDeal, ruleMutation]
  );

  const remove = useCallback(
    async (item: StageAutomation) => {
      if (item.kind === 'action' || item.kind === 'bot') await deleteBot.mutateAsync(item.refId);
      else if (item.kind === 'webhook') await ruleMutation.mutateAsync({ id: item.refId, remove: true });
      // Agente: o agente continua existindo; só deixa de iniciar a conversa nesta etapa
      else if (item.agent) await patchAgentDeal(item.agent, { enabled: false, stage_id: null });
    },
    [deleteBot, ruleMutation, patchAgentDeal]
  );

  const refresh = useCallback(() => {
    void qc.invalidateQueries({ queryKey: PIPELINE_RULES_QUERY_KEY });
    void botsQ.refetch();
    void agentsQ.refetch();
  }, [qc, botsQ, agentsQ]);

  return {
    byStage,
    agents: agentsQ.data ?? [],
    isLoading: botsQ.isLoading || agentsQ.isLoading || rulesQ.isLoading,
    error: botsQ.error || agentsQ.error || rulesQ.error,
    toggle,
    remove,
    refresh,
    busy: saveBot.isPending || saveAgent.isPending || deleteBot.isPending || ruleMutation.isPending,
  };
}
