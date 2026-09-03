'use client';

/**
 * Adicionar/editar uma automação da etapa sem sair do board:
 * 1) escolha da ação em cartões; 2) configuração da ação; salvar.
 *
 * Ações de mensagem/tag/etapa/agente rodam pelo motor de robôs (um robô
 * marcado como automação da etapa, ver stageAutomationModel.ts); "Agente de
 * IA inicia a conversa" liga o gatilho de pipeline do próprio agente; Webhook
 * abre o formulário da regra do pipeline (mesma infra de Integrações).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Bot, MessageCircle, MoveRight, Sparkles, Tag, Webhook, type LucideIcon } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/context/ToastContext';
import { DEFAULT_AGENT_TRIGGERS } from '@/lib/wa-agents/types';
import { useSaveWaAgent, useSaveWaBot, useWaAgentOptions, useWaAgentsList } from '@/features/wa-agents/useWaAgents';
import type { Board, BoardStage } from '@/types';
import type { StageAutomation } from './useStageAutomations';
import { STAGE_ACTION_LABEL, buildStageActionBot, draftFromBot, stageActionStep, type StageActionDraft, type StageActionKind } from './stageAutomationModel';

type Choice = StageActionKind | 'agent_start' | 'webhook';

type Card = { id: Choice; title: string; description: string; icon: LucideIcon; group: string; needsAgents?: boolean; needsBeta?: boolean };

const CARDS: Card[] = [
  { id: 'send_text', title: STAGE_ACTION_LABEL.send_text, description: 'O lead recebe uma mensagem assim que entra na etapa.', icon: MessageCircle, group: 'Conversa', needsBeta: true },
  { id: 'agent_start', title: 'Agente de IA inicia a conversa', description: 'Um agente manda a primeira mensagem e conduz o atendimento.', icon: Bot, group: 'Conversa', needsAgents: true, needsBeta: true },
  { id: 'handoff_agent', title: STAGE_ACTION_LABEL.handoff_agent, description: 'A conversa aberta do lead passa a ser atendida pelo agente.', icon: Sparkles, group: 'Conversa', needsAgents: true, needsBeta: true },
  { id: 'add_tag', title: STAGE_ACTION_LABEL.add_tag, description: 'Marca o lead com uma tag ao entrar.', icon: Tag, group: 'Ações no CRM', needsBeta: true },
  { id: 'move_stage', title: STAGE_ACTION_LABEL.move_stage, description: 'Leva o lead para outra etapa do board.', icon: MoveRight, group: 'Ações no CRM', needsBeta: true },
  { id: 'webhook', title: 'Webhook', description: 'Envia um POST em JSON para o seu n8n, Make ou sistema.', icon: Webhook, group: 'Integrações' },
];

const GROUPS = ['Conversa', 'Ações no CRM', 'Integrações'];

const INPUT =
  'w-full bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500';
const LABEL = 'block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1';

const emptyDraft = (kind: StageActionKind, stageLabel: string): StageActionDraft => ({
  kind,
  text: `Olá {{contato.nome}}! Vi que você chegou em ${stageLabel}. Posso ajudar?`,
  tag: '',
  stageId: '',
  agentId: '',
  connectionId: '',
});

export function StageActionModal({
  open,
  onClose,
  board,
  stage,
  item,
  automationsApproved,
  onWebhook,
}: {
  open: boolean;
  onClose: () => void;
  board: Board;
  stage: BoardStage;
  /** Automação existente (edição): ação da etapa ou agente que inicia a conversa */
  item?: StageAutomation | null;
  /** Módulo de IA e automações liberado para a org (ações via motor de robôs) */
  automationsApproved: boolean;
  /** Webhook: abre o formulário da regra do pipeline */
  onWebhook: () => void;
}) {
  const { addToast } = useToast();
  const optionsQ = useWaAgentOptions();
  const agentsQ = useWaAgentsList();
  const saveBot = useSaveWaBot();
  const saveAgent = useSaveWaAgent();

  const editingKind: Choice | null = item?.kind === 'agent' ? 'agent_start' : item?.kind === 'action' && item.bot ? (stageActionStep(item.bot)?.type ?? null) : null;
  const [choice, setChoice] = useState<Choice | null>(editingKind);
  const [draft, setDraft] = useState<StageActionDraft>(() =>
    item?.bot ? (draftFromBot(item.bot) ?? emptyDraft('send_text', stage.label)) : emptyDraft('send_text', stage.label)
  );
  const [agentId, setAgentId] = useState(item?.kind === 'agent' ? item.refId : '');
  const [agentConnectionId, setAgentConnectionId] = useState(item?.agent?.triggers?.deal?.connection_id ?? '');

  const connections = optionsQ.data?.connections ?? [];
  const connected = useMemo(() => connections.filter((c) => c.status === 'connected'), [connections]);
  const tags = optionsQ.data?.tags ?? [];
  const agents = useMemo(() => (agentsQ.data ?? []).filter((a) => a.enabled), [agentsQ.data]);
  const otherStages = board.stages.filter((s) => s.id !== stage.id);

  // Número padrão: o primeiro conectado
  useEffect(() => {
    const fallback = connected[0]?.id ?? connections[0]?.id ?? '';
    if (!fallback) return;
    setDraft((d) => (d.connectionId ? d : { ...d, connectionId: fallback }));
    setAgentConnectionId((v) => v || fallback);
  }, [connected, connections]);

  const cards = useMemo(
    () =>
      CARDS.filter((c) => {
        if (c.needsBeta && !automationsApproved) return false;
        if (c.needsAgents && agents.length === 0) return false;
        return true;
      }),
    [automationsApproved, agents.length]
  );

  const pick = (id: Choice) => {
    if (id === 'webhook') {
      onClose();
      onWebhook();
      return;
    }
    if (id !== 'agent_start') setDraft((d) => ({ ...emptyDraft(id, stage.label), connectionId: d.connectionId }));
    setChoice(id);
  };

  const saving = saveBot.isPending || saveAgent.isPending;

  const save = async () => {
    if (!choice || choice === 'webhook') return;
    try {
      if (choice === 'agent_start') {
        const agent = (agentsQ.data ?? []).find((a) => a.id === agentId);
        if (!agent) return addToast('Escolha o agente de IA.', 'warning');
        if (!agentConnectionId) return addToast('Escolha o número que inicia a conversa.', 'warning');
        const triggers = agent.triggers ?? DEFAULT_AGENT_TRIGGERS;
        await saveAgent.mutateAsync({
          id: agent.id,
          input: {
            triggers: {
              inbound: triggers.inbound ?? DEFAULT_AGENT_TRIGGERS.inbound,
              deal: { enabled: true, event: 'deal_stage_entered', board_id: board.id, stage_id: stage.id, connection_id: agentConnectionId },
            },
          },
        });
        // Trocou de agente na edição: o anterior deixa de iniciar nesta etapa
        if (item?.kind === 'agent' && item.agent && item.agent.id !== agent.id) {
          const prev = item.agent.triggers ?? DEFAULT_AGENT_TRIGGERS;
          await saveAgent.mutateAsync({
            id: item.agent.id,
            input: { triggers: { inbound: prev.inbound ?? DEFAULT_AGENT_TRIGGERS.inbound, deal: { ...DEFAULT_AGENT_TRIGGERS.deal, ...prev.deal, enabled: false, stage_id: null } } },
          });
        }
        addToast('Automação salva: o agente inicia a conversa ao entrar na etapa.', 'success');
        onClose();
        return;
      }
      const d: StageActionDraft = { ...draft, kind: choice };
      if (d.kind === 'send_text' && !d.text.trim()) return addToast('Escreva a mensagem.', 'warning');
      if (d.kind === 'add_tag' && !d.tag.trim()) return addToast('Informe a tag.', 'warning');
      if (d.kind === 'move_stage' && !d.stageId) return addToast('Escolha a etapa de destino.', 'warning');
      if (d.kind === 'handoff_agent' && !d.agentId) return addToast('Escolha o agente de IA.', 'warning');
      if (!d.connectionId) return addToast('Conecte um número do WhatsApp para usar esta automação.', 'warning');
      const existingStep = item?.bot ? stageActionStep(item.bot) : null;
      const input = buildStageActionBot(board, stage, d, { enabled: item?.bot ? item.bot.enabled : true, stepId: existingStep?.id });
      await saveBot.mutateAsync({ id: item?.bot?.id ?? null, input });
      addToast(item ? 'Automação atualizada.' : 'Automação criada e ativa.', 'success');
      onClose();
    } catch (e) {
      addToast((e as Error).message || 'Erro ao salvar a automação', 'error');
    }
  };

  const card = choice ? CARDS.find((c) => c.id === choice) ?? null : null;
  const title = item ? `Editar: ${card?.title ?? 'automação'}` : card ? card.title : `Automatizar: ${stage.label}`;

  const connectionSelect = (value: string, onChange: (v: string) => void, hint: string) => (
    <div>
      <label htmlFor="sa-conn" className={LABEL}>
        Número do WhatsApp
      </label>
      <select id="sa-conn" className={INPUT} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Selecione</option>
        {connections.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
            {c.status !== 'connected' ? ' (desconectado)' : ''}
          </option>
        ))}
      </select>
      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{hint}</p>
    </div>
  );

  return (
    <Modal isOpen={open} onClose={onClose} title={title} size="xl" className="max-w-3xl">
      {!card ? (
        <div className="space-y-6">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            O que acontece quando um lead entra em <strong className="text-slate-800 dark:text-white">{stage.label}</strong>.
          </p>
          {GROUPS.map((g) => {
            const list = cards.filter((c) => c.group === g);
            if (list.length === 0) return null;
            return (
              <div key={g}>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">{g}</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {list.map((c) => {
                    const Icon = c.icon;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => pick(c.id)}
                        className="group flex items-start gap-3 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.03] p-3.5 text-left hover:border-primary-400 dark:hover:border-primary-500/50 hover:shadow-sm transition-all focus-visible-ring"
                      >
                        <span className="p-2 rounded-lg bg-primary-500/10 text-primary-600 dark:text-primary-400 shrink-0">
                          <Icon size={16} aria-hidden="true" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-semibold text-slate-900 dark:text-white">{c.title}</span>
                          <span className="block text-xs text-slate-500 dark:text-slate-400 mt-0.5">{c.description}</span>
                        </span>
                        <ArrowRight size={14} className="mt-1 text-slate-300 group-hover:text-primary-500 transition-colors shrink-0" aria-hidden="true" />
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {!automationsApproved ? (
            <p className="text-xs text-amber-700 dark:text-amber-300">
              Mensagens, tags, mover de etapa e agentes dependem do módulo IA e Automações, ainda não liberado para esta organização.
            </p>
          ) : connections.length === 0 ? (
            <p className="text-xs text-amber-700 dark:text-amber-300">
              As ações desta etapa usam um número do WhatsApp conectado. Conecte um em WhatsApp → Conexão.
            </p>
          ) : null}
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Quando um lead entrar em <strong className="text-slate-800 dark:text-white">{stage.label}</strong>:
          </p>

          {choice === 'send_text' ? (
            <>
              <div>
                <label htmlFor="sa-text" className={LABEL}>
                  Mensagem
                </label>
                <textarea id="sa-text" className={`${INPUT} resize-y`} rows={5} value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} maxLength={4000} />
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Variáveis: {'{{contato.nome}}'}, {'{{lead.titulo}}'}, {'{{lead.etapa}}'}.</p>
              </div>
              {connectionSelect(draft.connectionId, (v) => setDraft({ ...draft, connectionId: v }), 'Número que envia a mensagem (abre a conversa se o lead ainda não tiver uma).')}
            </>
          ) : null}

          {choice === 'add_tag' ? (
            <>
              <div>
                <label htmlFor="sa-tag" className={LABEL}>
                  Tag
                </label>
                <input id="sa-tag" list="sa-tags" className={INPUT} value={draft.tag} onChange={(e) => setDraft({ ...draft, tag: e.target.value })} placeholder="Nome da tag" maxLength={60} />
                <datalist id="sa-tags">
                  {tags.map((t) => (
                    <option key={t} value={t} />
                  ))}
                </datalist>
              </div>
              {connectionSelect(draft.connectionId, (v) => setDraft({ ...draft, connectionId: v }), 'A ação roda na conversa do lead neste número.')}
            </>
          ) : null}

          {choice === 'move_stage' ? (
            <>
              <div>
                <label htmlFor="sa-stage" className={LABEL}>
                  Etapa de destino
                </label>
                <select id="sa-stage" className={INPUT} value={draft.stageId} onChange={(e) => setDraft({ ...draft, stageId: e.target.value })}>
                  <option value="">Selecione</option>
                  {otherStages.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
              {connectionSelect(draft.connectionId, (v) => setDraft({ ...draft, connectionId: v }), 'A ação roda na conversa do lead neste número.')}
            </>
          ) : null}

          {choice === 'handoff_agent' ? (
            <>
              <div>
                <label htmlFor="sa-agent" className={LABEL}>
                  Agente de IA
                </label>
                <select id="sa-agent" className={INPUT} value={draft.agentId} onChange={(e) => setDraft({ ...draft, agentId: e.target.value })}>
                  <option value="">Selecione</option>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
              {connectionSelect(draft.connectionId, (v) => setDraft({ ...draft, connectionId: v }), 'Número da conversa que o agente passa a atender.')}
            </>
          ) : null}

          {choice === 'agent_start' ? (
            <>
              <div>
                <label htmlFor="sa-agent-start" className={LABEL}>
                  Agente de IA
                </label>
                <select id="sa-agent-start" className={INPUT} value={agentId} onChange={(e) => setAgentId(e.target.value)}>
                  <option value="">Selecione</option>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
                {(() => {
                  const a = (agentsQ.data ?? []).find((x) => x.id === agentId);
                  const deal = a?.triggers?.deal;
                  if (a && deal?.enabled && deal.stage_id && deal.stage_id !== stage.id) {
                    const other = board.stages.find((s) => s.id === deal.stage_id);
                    return (
                      <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
                        Este agente já inicia conversas {other ? `em "${other.label}"` : 'em outra etapa'}; passará a iniciar nesta.
                      </p>
                    );
                  }
                  return <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">O agente manda a primeira mensagem e segue o roteiro dele.</p>;
                })()}
              </div>
              {connectionSelect(agentConnectionId, setAgentConnectionId, 'Número que inicia a conversa com o lead.')}
            </>
          ) : null}

          <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-white/5">
            {item ? (
              <span />
            ) : (
              <button type="button" onClick={() => setChoice(null)} className="text-sm text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white">
                Voltar
              </button>
            )}
            <div className="flex items-center gap-2">
              <button type="button" onClick={onClose} className="px-3.5 py-2 rounded-lg text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5">
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving}
                className="px-3.5 py-2 rounded-lg text-sm font-semibold bg-primary-600 hover:bg-primary-700 text-white disabled:opacity-50 focus-visible-ring"
              >
                {saving ? 'Salvando...' : item ? 'Salvar' : 'Ativar automação'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

export default StageActionModal;
