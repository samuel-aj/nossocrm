'use client';

/**
 * Lista de robôs de mensagens: cards com gatilho, número e passos; ações
 * Editar, Testar com um negócio (dispara por telefone) e Excluir.
 * O editor abre como camada de tela cheia por cima da lista (portal), então a
 * lista continua montada embaixo e reaparece atualizada ao fechar.
 */
import React, { useState } from 'react';
import dynamic from 'next/dynamic';
import { Workflow, Plus, Pencil, Trash2, Play, Phone, Zap, Loader2 } from 'lucide-react';
import ConfirmModal from '@/components/ConfirmModal';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/context/ToastContext';
import type { BotRow } from '@/lib/wa-agents/types';
import { useDeleteWaBot, useSaveWaBot, useStartWaBot, useWaAgentOptions, useWaBotsList } from './useWaAgents';
import { TRIGGER_LABELS } from './canvas/types';
import { BTN_ICON, BTN_PRIMARY, BTN_SECONDARY, Badge, EmptyState, Field, INPUT_CLASS, Notice, Spinner, Toggle, errorMessage } from './ui';

// O editor (React Flow e seus CSS) só é carregado quando alguém abre um robô.
const BotEditor = dynamic(() => import('./BotEditor').then((m) => ({ default: m.BotEditor })), {
  ssr: false,
  loading: () => <Spinner label="Carregando o editor..." />,
});

/**
 * Componente React `BotList`.
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export const BotList: React.FC = () => {
  const listQ = useWaBotsList();
  const optionsQ = useWaAgentOptions();
  const save = useSaveWaBot();
  const del = useDeleteWaBot();
  const start = useStartWaBot();
  const { showToast } = useToast();
  const [editor, setEditor] = useState<{ bot: BotRow | null } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<BotRow | null>(null);
  const [testBot, setTestBot] = useState<BotRow | null>(null);
  const [testPhone, setTestPhone] = useState('');
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const options = optionsQ.data;
  const connectionLabel = (id: string | null) => {
    if (!id) return 'Sem número';
    const label = options?.connections.find((c) => c.id === id)?.label;
    if (label) return label;
    if (optionsQ.isLoading) return '...';
    if (optionsQ.error) return `${id.slice(0, 8)}...`;
    return 'Número removido';
  };
  const describeTrigger = (bot: BotRow): string => {
    const t = bot.trigger;
    const board = t.board_id ? options?.boards.find((b) => b.id === t.board_id) : null;
    const stage = t.stage_id ? board?.stages.find((s) => s.id === t.stage_id) : null;
    if (t.type === 'deal_created') return `${TRIGGER_LABELS.deal_created}${board ? ` em ${board.name}` : ' (qualquer board)'}`;
    if (t.type === 'deal_stage_entered')
      return `${TRIGGER_LABELS.deal_stage_entered}: ${board?.name ?? 'board'} / ${stage?.label ?? 'etapa'}`;
    return TRIGGER_LABELS.manual;
  };

  const handleToggle = async (bot: BotRow, enabled: boolean) => {
    setTogglingId(bot.id);
    try {
      await save.mutateAsync({ id: bot.id, input: { enabled } });
      showToast(enabled ? 'Robô ligado' : 'Robô desligado', 'success');
    } catch (err) {
      showToast(errorMessage(err, 'Falha ao alterar o robô'), 'error');
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
      showToast('Robô excluído', 'success');
    } catch (err) {
      showToast(errorMessage(err, 'Falha ao excluir o robô'), 'error');
    }
  };

  const handleStart = async () => {
    if (!testBot) return;
    const phone = testPhone.trim();
    if (!phone) {
      showToast('Informe o telefone com DDD', 'error');
      return;
    }
    try {
      const result = await start.mutateAsync({ id: testBot.id, phone });
      if (result.ok === false) throw new Error(result.error || 'Falha ao iniciar o robô');
      showToast('Robô iniciado. Acompanhe em Execuções.', 'success');
      setTestBot(null);
      setTestPhone('');
    } catch (err) {
      showToast(errorMessage(err, 'Falha ao iniciar o robô'), 'error');
    }
  };

  const bots = listQ.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Robôs enviam mensagens prontas em sequência quando um negócio é criado ou entra em uma etapa, e podem
          entregar a conversa a um agente de IA.
        </p>
        <button type="button" className={BTN_PRIMARY} onClick={() => setEditor({ bot: null })}>
          <Plus size={16} aria-hidden="true" />
          Novo robô
        </button>
      </div>

      {/* Editor em tela cheia (portal): fica por cima da lista enquanto aberto */}
      {editor ? <BotEditor bot={editor.bot} onClose={() => setEditor(null)} /> : null}

      {listQ.isLoading ? (
        <Spinner label="Carregando robôs..." />
      ) : listQ.error ? (
        <Notice tone="red">{errorMessage(listQ.error, 'Falha ao carregar os robôs')}</Notice>
      ) : bots.length === 0 ? (
        <EmptyState
          icon={<Workflow size={22} aria-hidden="true" />}
          title="Nenhum robô ainda"
          description="Crie um robô com um exemplo pronto de boas-vindas e ajuste os passos."
          action={
            <button type="button" className={BTN_PRIMARY} onClick={() => setEditor({ bot: null })}>
              <Plus size={16} aria-hidden="true" />
              Novo robô
            </button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {bots.map((bot) => (
            <div
              key={bot.id}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-xl p-4 shadow-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-base font-semibold text-slate-900 dark:text-white truncate">{bot.name}</h3>
                    <Badge tone={bot.enabled ? 'green' : 'slate'}>{bot.enabled ? 'Ligado' : 'Desligado'}</Badge>
                    <Badge tone="slate">
                      {bot.steps.length} {bot.steps.length === 1 ? 'passo' : 'passos'}
                    </Badge>
                  </div>
                  <div className="mt-2 flex flex-col gap-1 text-xs text-slate-500 dark:text-slate-400">
                    <span className="inline-flex items-center gap-1.5">
                      <Zap size={12} aria-hidden="true" />
                      {describeTrigger(bot)}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <Phone size={12} aria-hidden="true" />
                      {connectionLabel(bot.connection_id)}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Toggle
                    checked={bot.enabled}
                    disabled={togglingId === bot.id}
                    onChange={(v) => void handleToggle(bot, v)}
                    label={`Ligar ou desligar o robô ${bot.name}`}
                  />
                  <button
                    type="button"
                    className={BTN_ICON}
                    aria-label={`Testar o robô ${bot.name} com um negócio`}
                    title="Testar com um negócio"
                    onClick={() => {
                      setTestPhone('');
                      setTestBot(bot);
                    }}
                  >
                    <Play size={16} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className={BTN_ICON}
                    aria-label={`Editar robô ${bot.name}`}
                    title="Editar"
                    onClick={() => setEditor({ bot })}
                  >
                    <Pencil size={16} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className={`${BTN_ICON} hover:text-red-600 dark:hover:text-red-400`}
                    aria-label={`Excluir robô ${bot.name}`}
                    title="Excluir"
                    onClick={() => setConfirmDelete(bot)}
                  >
                    <Trash2 size={16} aria-hidden="true" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmModal
        isOpen={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => void handleDelete()}
        title="Excluir robô"
        message={
          <>
            Excluir o robô <strong>{confirmDelete?.name}</strong>? Execuções em andamento serão canceladas. Esta ação não
            pode ser desfeita.
          </>
        }
        confirmText="Excluir"
        variant="danger"
      />

      <Modal
        isOpen={!!testBot}
        onClose={() => setTestBot(null)}
        title={`Testar: ${testBot?.name ?? ''}`}
        size="md"
        initialFocus="#bot-test-phone"
      >
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void handleStart();
          }}
        >
          <p className="text-sm text-slate-600 dark:text-slate-300">
            O robô vai enviar as mensagens de verdade para este telefone pelo número{' '}
            <strong>{connectionLabel(testBot?.connection_id ?? null)}</strong>. Use um número seu para testar.
          </p>
          <Field label="Telefone com DDD" htmlFor="bot-test-phone" help="Ex.: (11) 99999-9999 ou +5511999999999">
            <input
              id="bot-test-phone"
              type="tel"
              className={INPUT_CLASS}
              value={testPhone}
              onChange={(e) => setTestPhone(e.target.value)}
              placeholder="+55 11 99999-9999"
              autoComplete="off"
            />
          </Field>
          <div className="flex justify-end gap-2">
            <button type="button" className={BTN_SECONDARY} onClick={() => setTestBot(null)} disabled={start.isPending}>
              Cancelar
            </button>
            <button type="submit" className={BTN_PRIMARY} disabled={start.isPending || !testPhone.trim()}>
              {start.isPending ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
              Iniciar robô
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};

export default BotList;
