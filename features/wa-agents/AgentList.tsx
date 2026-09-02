'use client';

/**
 * Lista de agentes de IA: cards com status, números vinculados e ações
 * (Editar, Duplicar, Excluir). "Novo agente" abre o editor com os padrões.
 */
import React, { useState } from 'react';
import { Bot, Plus, Pencil, Copy, Trash2, Phone, Cpu } from 'lucide-react';
import ConfirmModal from '@/components/ConfirmModal';
import { useToast } from '@/context/ToastContext';
import { DEFAULT_AGENT_TRIGGERS, type AgentInput, type AgentPublic } from '@/lib/wa-agents/types';
import { PROVIDER_LABELS } from '@/lib/wa-agents/catalog';
import { useDeleteWaAgent, useSaveWaAgent, useWaAgentOptions, useWaAgentsList, type WaAgentListItem } from './useWaAgents';
import { AgentEditor } from './AgentEditor';
import { BTN_ICON, BTN_PRIMARY, Badge, CopyIdButton, EmptyState, Notice, Spinner, Toggle, errorMessage } from './ui';

type EditorState = { agent: AgentPublic | null; initial?: Partial<AgentInput> };

/** A lista do admin traz o agente completo; garante isso antes de editar. */
function asPublic(item: WaAgentListItem): AgentPublic | null {
  if (typeof item.provider !== 'string' || typeof item.model !== 'string') return null;
  return item as AgentPublic;
}

/**
 * Campos copiáveis de um agente. Não vão na cópia: a chave própria e os
 * números vinculados (a cópia nasce desligada e sem números). O gatilho por
 * pipeline vem configurado, mas desligado quando já tem um número que inicia
 * a conversa, para não disparar em dobro com o original.
 */
function toAgentInput(agent: AgentPublic): Partial<AgentInput> {
  const deal = agent.triggers?.deal;
  return {
    name: `${agent.name} (cópia)`,
    persona_name: agent.persona_name ?? null,
    enabled: false,
    connection_ids: [],
    provider: agent.provider,
    model: agent.model,
    temperature: agent.temperature,
    system_prompt: agent.system_prompt,
    buffer_seconds: agent.buffer_seconds,
    history_limit: agent.history_limit,
    line_delay_ms: agent.line_delay_ms,
    human_pause_minutes: agent.human_pause_minutes,
    only_new_conversations: agent.only_new_conversations,
    outcomes: agent.outcomes,
    custom_actions: agent.custom_actions ?? [],
    triggers: {
      inbound: agent.triggers?.inbound ?? DEFAULT_AGENT_TRIGGERS.inbound,
      deal: { ...DEFAULT_AGENT_TRIGGERS.deal, ...deal, enabled: deal?.connection_id ? false : (deal?.enabled ?? false) },
    },
    webhooks: agent.webhooks,
    helper_agent_ids: agent.helper_agent_ids ?? [],
    tools: agent.tools,
  };
}

/**
 * Componente React `AgentList`.
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export const AgentList: React.FC = () => {
  const listQ = useWaAgentsList();
  const optionsQ = useWaAgentOptions();
  const save = useSaveWaAgent();
  const del = useDeleteWaAgent();
  const { showToast } = useToast();
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<WaAgentListItem | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  if (editor) {
    return <AgentEditor agent={editor.agent} initial={editor.initial} onClose={() => setEditor(null)} />;
  }

  const connections = optionsQ.data?.connections ?? [];
  const connectionLabel = (id: string) =>
    connections.find((c) => c.id === id)?.label ??
    (optionsQ.isLoading ? '...' : optionsQ.error ? `${id.slice(0, 8)}...` : 'Número removido');

  const handleToggle = async (item: WaAgentListItem, enabled: boolean) => {
    setTogglingId(item.id);
    try {
      const saved = await save.mutateAsync({ id: item.id, input: { enabled } });
      if (saved.warning) {
        showToast(saved.warning, 'warning');
        return;
      }
      showToast(enabled ? 'Agente ligado' : 'Agente desligado', 'success');
    } catch (err) {
      showToast(errorMessage(err, 'Falha ao alterar o agente'), 'error');
    } finally {
      setTogglingId(null);
    }
  };

  const handleDelete = async () => {
    const target = confirmDelete;
    setConfirmDelete(null);
    if (!target) return;
    try {
      await del.mutateAsync(target.id);
      showToast('Agente excluído', 'success');
    } catch (err) {
      showToast(errorMessage(err, 'Falha ao excluir o agente'), 'error');
    }
  };

  const agents = listQ.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Cada agente é um roteiro de atendimento com o próprio modelo de IA. Vincule um número para ele responder
          automaticamente às conversas novas.
        </p>
        <button type="button" className={BTN_PRIMARY} onClick={() => setEditor({ agent: null })}>
          <Plus size={16} aria-hidden="true" />
          Novo agente
        </button>
      </div>

      {listQ.isLoading ? (
        <Spinner label="Carregando agentes..." />
      ) : listQ.error ? (
        <Notice tone="red">{errorMessage(listQ.error, 'Falha ao carregar os agentes')}</Notice>
      ) : agents.length === 0 ? (
        <EmptyState
          icon={<Bot size={22} aria-hidden="true" />}
          title="Nenhum agente ainda"
          description="Crie o primeiro agente com um roteiro pronto de pré-atendimento e ajuste ao seu escritório."
          action={
            <button type="button" className={BTN_PRIMARY} onClick={() => setEditor({ agent: null })}>
              <Plus size={16} aria-hidden="true" />
              Novo agente
            </button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {agents.map((item) => {
            const full = asPublic(item);
            const providerLabel = item.provider ? PROVIDER_LABELS[item.provider] ?? item.provider : '';
            const linked = item.connection_ids ?? [];
            return (
              <div
                key={item.id}
                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-xl p-4 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-base font-semibold text-slate-900 dark:text-white truncate">{item.name}</h3>
                      {item.persona_name ? <Badge tone="purple">Persona: {item.persona_name}</Badge> : null}
                      <Badge tone={item.enabled ? 'green' : 'slate'}>{item.enabled ? 'Ligado' : 'Desligado'}</Badge>
                      {full?.has_api_key ? <Badge tone="blue">Chave própria</Badge> : null}
                      <CopyIdButton id={item.id} label="ID do agente" />
                    </div>
                    <div className="mt-2 flex flex-col gap-1 text-xs text-slate-500 dark:text-slate-400">
                      {item.provider || item.model ? (
                        <span className="inline-flex items-center gap-1.5">
                          <Cpu size={12} aria-hidden="true" />
                          {providerLabel}
                          {item.model ? <span className="font-mono">{item.model}</span> : null}
                        </span>
                      ) : null}
                      <span className="inline-flex items-center gap-1.5 flex-wrap">
                        <Phone size={12} aria-hidden="true" />
                        {linked.length === 0 ? (
                          <span>Sem número vinculado (só recebe conversas de outro agente ou por início manual)</span>
                        ) : (
                          linked.map((id) => (
                            <span
                              key={id}
                              className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-white/10 text-slate-700 dark:text-slate-200"
                            >
                              {connectionLabel(id)}
                            </span>
                          ))
                        )}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Toggle
                      checked={item.enabled}
                      disabled={togglingId === item.id}
                      onChange={(v) => void handleToggle(item, v)}
                      label={`Ligar ou desligar o agente ${item.name}`}
                    />
                    <button
                      type="button"
                      className={BTN_ICON}
                      aria-label={`Editar agente ${item.name}`}
                      title="Editar"
                      disabled={!full}
                      onClick={() => full && setEditor({ agent: full })}
                    >
                      <Pencil size={16} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className={BTN_ICON}
                      aria-label={`Duplicar agente ${item.name}`}
                      title="Duplicar"
                      disabled={!full}
                      onClick={() => full && setEditor({ agent: null, initial: toAgentInput(full) })}
                    >
                      <Copy size={16} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className={`${BTN_ICON} hover:text-red-600 dark:hover:text-red-400`}
                      aria-label={`Excluir agente ${item.name}`}
                      title="Excluir"
                      onClick={() => setConfirmDelete(item)}
                    >
                      <Trash2 size={16} aria-hidden="true" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ConfirmModal
        isOpen={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => void handleDelete()}
        title="Excluir agente"
        message={
          <>
            Excluir o agente <strong>{confirmDelete?.name}</strong>? As conversas em andamento com ele serão
            encerradas. Esta ação não pode ser desfeita.
          </>
        }
        confirmText="Excluir"
        variant="danger"
      />
    </div>
  );
};

export default AgentList;
