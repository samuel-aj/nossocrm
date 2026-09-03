'use client';

/**
 * Modo Automatizar do Kanban: só quando ligado é que carrega robôs, agentes e
 * webhooks (hooks ficam no componente interno), entrega ao KanbanBoard o que
 * cada coluna mostra e cuida dos modais (escolher automação, webhook, excluir).
 */
import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import ConfirmModal from '@/components/ConfirmModal';
import { useToast } from '@/context/ToastContext';
import type { Board, BoardStage } from '@/types';
import { useStageAutomations, type PipelineRule, type StageAutomation } from './useStageAutomations';
import { StageAutomationPicker } from './StageAutomationPicker';
import { PipelineWebhookRuleModal } from './PipelineWebhookRuleModal';

export type KanbanAutomation = {
  byStage: Map<string, StageAutomation[]>;
  loading: boolean;
  onAdd: (stage: BoardStage) => void;
  onOpen: (item: StageAutomation) => void;
  onToggle: (item: StageAutomation) => void;
  onRemove: (item: StageAutomation) => void;
};

type Children = (automation: KanbanAutomation | undefined) => React.ReactNode;

export function AutomationLayer({ board, enabled, children }: { board: Board; enabled: boolean; children: Children }) {
  if (!enabled) return <>{children(undefined)}</>;
  return <ActiveLayer board={board}>{children}</ActiveLayer>;
}

function ActiveLayer({ board, children }: { board: Board; children: Children }) {
  const router = useRouter();
  const { addToast } = useToast();
  const auto = useStageAutomations(board);
  const [picker, setPicker] = useState<BoardStage | null>(null);
  const [webhook, setWebhook] = useState<{ stage: BoardStage; rule: PipelineRule | null } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<StageAutomation | null>(null);

  useEffect(() => {
    if (auto.error) addToast(`Não foi possível carregar as automações: ${(auto.error as Error).message}`, 'error');
  }, [auto.error, addToast]);

  const fail = (fallback: string) => (e: unknown) => addToast((e as Error)?.message || fallback, 'error');

  const automation: KanbanAutomation = {
    byStage: auto.byStage,
    loading: auto.isLoading,
    onAdd: (stage) => setPicker(stage),
    onOpen: (item) => {
      if (item.kind === 'bot') {
        router.push(`/settings/agentes?bot=${encodeURIComponent(item.refId)}#robos`);
      } else if (item.kind === 'agent') {
        router.push(`/settings/agentes?agent=${encodeURIComponent(item.refId)}#agentes`);
      } else {
        const stage = board.stages.find((s) => s.id === item.stageId);
        if (stage) setWebhook({ stage, rule: item.rule ?? null });
      }
    },
    onToggle: (item) => {
      void auto
        .toggle(item)
        .then(() => addToast(item.enabled ? 'Automação desativada' : 'Automação ativada', 'success'))
        .catch(fail('Não foi possível alterar a automação'));
    },
    onRemove: (item) => setConfirmRemove(item),
  };

  const confirmRemoval = () => {
    const item = confirmRemove;
    setConfirmRemove(null);
    if (!item) return;
    void auto
      .remove(item)
      .then(() => addToast('Automação excluída', 'success'))
      .catch(fail('Não foi possível excluir a automação'));
  };

  return (
    <>
      {children(automation)}
      {picker ? (
        <StageAutomationPicker
          open
          onClose={() => setPicker(null)}
          board={board}
          stage={picker}
          onWebhook={() => setWebhook({ stage: picker, rule: null })}
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
        title="Excluir automação"
        message={
          confirmRemove ? (
            <>
              Excluir <strong>{confirmRemove.title}</strong>?{' '}
              {confirmRemove.kind === 'bot' ? 'O robô será apagado, com todos os passos.' : 'O webhook deixa de ser chamado.'}
            </>
          ) : null
        }
        confirmText="Excluir"
      />
    </>
  );
}

export default AutomationLayer;
