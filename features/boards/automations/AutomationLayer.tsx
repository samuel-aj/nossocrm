'use client';

/**
 * Modo Automatizar do Kanban: só quando ligado é que carrega robôs, agentes e
 * webhooks (hooks ficam no componente interno), entrega ao KanbanBoard o que
 * cada coluna mostra e cuida dos modais (ação da etapa, webhook, excluir) e
 * do arrastar entre etapas.
 */
import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import ConfirmModal from '@/components/ConfirmModal';
import { useToast } from '@/context/ToastContext';
import { useWaAgentsAccess } from '@/hooks/useWaAgentsAccess';
import type { Board, BoardStage } from '@/types';
import { useStageAutomations, type PipelineRule, type StageAutomation } from './useStageAutomations';
import { StageActionModal } from './StageActionModal';
import { PipelineWebhookRuleModal } from './PipelineWebhookRuleModal';

export type KanbanAutomation = {
  byStage: Map<string, StageAutomation[]>;
  loading: boolean;
  onAdd: (stage: BoardStage) => void;
  onOpen: (item: StageAutomation) => void;
  onToggle: (item: StageAutomation) => void;
  onRemove: (item: StageAutomation) => void;
  /** Card arrastado e solto em outra coluna */
  onMove: (itemId: string, stageId: string) => void;
};

type Children = (automation: KanbanAutomation | undefined) => React.ReactNode;

export function AutomationLayer({ board, enabled, children }: { board: Board; enabled: boolean; children: Children }) {
  if (!enabled) return <>{children(undefined)}</>;
  return <ActiveLayer board={board}>{children}</ActiveLayer>;
}

function ActiveLayer({ board, children }: { board: Board; children: Children }) {
  const router = useRouter();
  const { addToast } = useToast();
  const { agentsApproved } = useWaAgentsAccess();
  const auto = useStageAutomations(board);
  const [action, setAction] = useState<{ key: number; stage: BoardStage; item: StageAutomation | null } | null>(null);
  const [webhook, setWebhook] = useState<{ stage: BoardStage; rule: PipelineRule | null } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<StageAutomation | null>(null);

  useEffect(() => {
    if (auto.error) addToast(`Não foi possível carregar as automações: ${(auto.error as Error).message}`, 'error');
  }, [auto.error, addToast]);

  const fail = (fallback: string) => (e: unknown) => addToast((e as Error)?.message || fallback, 'error');
  const stageOf = (id: string) => board.stages.find((s) => s.id === id) ?? null;
  const findItem = (id: string): StageAutomation | null => {
    for (const list of auto.byStage.values()) {
      const hit = list.find((i) => i.id === id);
      if (hit) return hit;
    }
    return null;
  };

  const automation: KanbanAutomation = {
    byStage: auto.byStage,
    loading: auto.isLoading,
    onAdd: (stage) => setAction({ key: Date.now(), stage, item: null }),
    onOpen: (item) => {
      const stage = stageOf(item.stageId);
      if (!stage) return;
      if (item.kind === 'bot') {
        router.push(`/settings/agentes?bot=${encodeURIComponent(item.refId)}#robos`);
      } else if (item.kind === 'webhook') {
        setWebhook({ stage, rule: item.rule ?? null });
      } else {
        setAction({ key: Date.now(), stage, item });
      }
    },
    onToggle: (item) => {
      void auto
        .toggle(item)
        .then(() => addToast(item.enabled ? 'Automação desativada' : 'Automação ativada', 'success'))
        .catch(fail('Não foi possível alterar a automação'));
    },
    onRemove: (item) => setConfirmRemove(item),
    onMove: (itemId, stageId) => {
      const item = findItem(itemId);
      if (!item || item.stageId === stageId) return;
      const target = stageOf(stageId);
      void auto
        .move(item, stageId)
        .then(() => addToast(`Automação movida para ${target?.label ?? 'a etapa'}`, 'success'))
        .catch(fail('Não foi possível mover a automação'));
    },
  };

  const confirmRemoval = () => {
    const item = confirmRemove;
    setConfirmRemove(null);
    if (!item) return;
    void auto
      .remove(item)
      .then(() => addToast(item.kind === 'agent' ? 'O agente deixou de iniciar conversas nesta etapa' : 'Automação excluída', 'success'))
      .catch(fail('Não foi possível excluir a automação'));
  };

  return (
    <>
      {children(automation)}
      {action ? (
        <StageActionModal
          key={action.key}
          open
          onClose={() => setAction(null)}
          board={board}
          stage={action.stage}
          item={action.item}
          automationsApproved={agentsApproved}
          onLegacyWebhook={() => setWebhook({ stage: action.stage, rule: null })}
        />
      ) : null}
      {webhook ? (
        <PipelineWebhookRuleModal
          open
          onClose={() => setWebhook(null)}
          boardId={board.id}
          stageId={webhook.stage.id}
          stageLabel={webhook.stage.label}
          rule={webhook.rule}
        />
      ) : null}
      <ConfirmModal
        isOpen={!!confirmRemove}
        onClose={() => setConfirmRemove(null)}
        onConfirm={confirmRemoval}
        title={confirmRemove?.kind === 'agent' ? 'Remover desta etapa' : 'Excluir automação'}
        message={
          confirmRemove ? (
            <>
              {confirmRemove.kind === 'agent' ? (
                <>
                  O agente <strong>{confirmRemove.subtitle}</strong> deixa de iniciar a conversa ao entrar nesta etapa. O agente continua existindo.
                </>
              ) : (
                <>
                  Excluir <strong>{confirmRemove.title}</strong>?{' '}
                  {confirmRemove.kind === 'bot' ? 'O robô será apagado, com todos os passos.' : confirmRemove.kind === 'webhook' ? 'O webhook deixa de ser chamado.' : 'A ação deixa de disparar nesta etapa.'}
                </>
              )}
            </>
          ) : null
        }
        confirmText={confirmRemove?.kind === 'agent' ? 'Remover' : 'Excluir'}
      />
    </>
  );
}

export default AutomationLayer;
