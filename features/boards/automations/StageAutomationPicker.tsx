'use client';

/**
 * "+ Automatizar" numa etapa: escolha do tipo de automação em cartões por
 * categoria. Só oferece o que o CRM já sabe fazer:
 * - Robô no WhatsApp (mensagem, tag, mover de etapa, entregar a um agente):
 *   cria um robô com gatilho "entrou na etapa" e o passo escolhido, e abre o
 *   editor do robô para completar (número, texto, ordem dos passos).
 * - Webhook: regra do pipeline (deal.stage_changed → esta etapa).
 * - Agente de IA: leva para os agentes (o gatilho por etapa é configurado lá,
 *   em Atendimento e automações → Por cadastro no pipeline).
 */
import React, { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Bot, MessageCircle, MoveRight, Sparkles, Tag, Webhook, type LucideIcon } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/context/ToastContext';
import { useWaAgentsAccess } from '@/hooks/useWaAgentsAccess';
import { useSaveWaBot, useWaAgentOptions, useWaAgentsList } from '@/features/wa-agents/useWaAgents';
import type { BotInput, BotStep } from '@/lib/wa-agents/types';
import type { Board, BoardStage } from '@/types';

type Choice = 'send_text' | 'add_tag' | 'move_stage' | 'handoff_agent' | 'webhook' | 'agent';

type Card = { id: Choice; title: string; description: string; icon: LucideIcon; group: string };

const CARDS: Card[] = [
  { id: 'send_text', title: 'Mensagem no WhatsApp', description: 'Envia uma mensagem ao lead assim que ele entra na etapa.', icon: MessageCircle, group: 'Conversa' },
  { id: 'handoff_agent', title: 'Agente de IA assume', description: 'Um robô entrega a conversa a um agente de IA.', icon: Sparkles, group: 'Conversa' },
  { id: 'add_tag', title: 'Adicionar tag', description: 'Marca o lead com uma tag ao entrar.', icon: Tag, group: 'Ações no CRM' },
  { id: 'move_stage', title: 'Mover de etapa', description: 'Leva o lead para outra etapa do board.', icon: MoveRight, group: 'Ações no CRM' },
  { id: 'webhook', title: 'Webhook', description: 'Dispara um POST em JSON para o seu n8n, Make ou sistema.', icon: Webhook, group: 'Integrações' },
  { id: 'agent', title: 'Agente de IA responde ao entrar', description: 'O agente inicia a conversa com o lead (configurado no próprio agente).', icon: Bot, group: 'Conversa' },
];

const GROUPS = ['Conversa', 'Ações no CRM', 'Integrações'];

const INPUT =
  'w-full bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500';

export function StageAutomationPicker({
  open,
  onClose,
  board,
  stage,
  onWebhook,
}: {
  open: boolean;
  onClose: () => void;
  board: Board;
  stage: BoardStage;
  /** Webhook: abre o formulário da regra do pipeline */
  onWebhook: () => void;
}) {
  const router = useRouter();
  const { addToast } = useToast();
  const { agentsApproved, isAdmin } = useWaAgentsAccess();
  const optionsQ = useWaAgentOptions();
  const agentsQ = useWaAgentsList();
  const saveBot = useSaveWaBot();
  const [choice, setChoice] = useState<Choice | null>(null);
  const [text, setText] = useState('Olá {{contato.nome}}! Vi que você chegou em ' + stage.label + '. Posso ajudar?');
  const [tag, setTag] = useState('');
  const [targetStage, setTargetStage] = useState('');
  const [agentId, setAgentId] = useState('');

  const connections = optionsQ.data?.connections ?? [];
  const connected = connections.filter((c) => c.status === 'connected');
  const tags = optionsQ.data?.tags ?? [];
  const agents = (agentsQ.data ?? []).filter((a) => a.enabled);
  const otherStages = board.stages.filter((s) => s.id !== stage.id);

  const cards = useMemo(
    () =>
      CARDS.filter((c) => {
        if (c.id === 'handoff_agent' || c.id === 'agent') return agentsApproved && isAdmin;
        return true;
      }),
    [agentsApproved, isAdmin]
  );

  const pick = (id: Choice) => {
    if (id === 'webhook') {
      onClose();
      onWebhook();
      return;
    }
    if (id === 'agent') {
      onClose();
      addToast('No agente, ligue "Por cadastro no pipeline" em Atendimento e automações e escolha esta etapa.', 'info');
      router.push('/settings/agentes#agentes');
      return;
    }
    setChoice(id);
  };

  const createBot = async () => {
    if (!choice || choice === 'webhook' || choice === 'agent') return;
    const stepId = crypto.randomUUID();
    let step: BotStep;
    if (choice === 'send_text') {
      if (!text.trim()) return addToast('Escreva a mensagem.', 'warning');
      step = { id: stepId, type: 'send_text', text: text.trim() };
    } else if (choice === 'add_tag') {
      if (!tag.trim()) return addToast('Escolha a tag.', 'warning');
      step = { id: stepId, type: 'add_tag', tag: tag.trim() };
    } else if (choice === 'move_stage') {
      if (!targetStage) return addToast('Escolha a etapa de destino.', 'warning');
      step = { id: stepId, type: 'move_stage', stage_id: targetStage };
    } else {
      if (!agentId) return addToast('Escolha o agente de IA.', 'warning');
      step = { id: stepId, type: 'handoff_agent', agent_id: agentId };
    }
    const first = connected[0] ?? connections[0];
    const input: BotInput = {
      name: `${stage.label} · ${CARDS.find((c) => c.id === choice)?.title ?? 'automação'}`,
      // Nasce desligado: a pessoa confere número e passos no editor e liga
      enabled: false,
      connection_id: first?.id ?? null,
      connection_ids: first ? [first.id] : [],
      trigger: { type: 'deal_stage_entered', board_id: board.id, stage_id: stage.id, connection_id: first?.id ?? null },
      steps: [step],
      layout: { groups: [] },
    };
    try {
      const bot = await saveBot.mutateAsync({ input });
      addToast('Robô criado. Confira o número e os passos e ligue quando estiver pronto.', 'success');
      onClose();
      router.push(`/settings/agentes?bot=${encodeURIComponent(bot.id)}#robos`);
    } catch (e) {
      addToast((e as Error).message || 'Erro ao criar o robô', 'error');
    }
  };

  const card = cards.find((c) => c.id === choice) ?? null;

  return (
    <Modal
      isOpen={open}
      onClose={() => {
        setChoice(null);
        onClose();
      }}
      title={card ? card.title : `Automatizar: ${stage.label}`}
      size="xl"
      className="max-w-3xl"
    >
      {!card ? (
        <div className="space-y-6">
          <p className="text-sm text-slate-500 dark:text-slate-400">O que acontece quando um lead entra em {stage.label}.</p>
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
          {connections.length === 0 ? (
            <p className="text-xs text-amber-700 dark:text-amber-300">
              As automações de conversa usam um número do WhatsApp conectado. Conecte um em WhatsApp → Conexão.
            </p>
          ) : null}
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Um robô será criado com o gatilho &quot;entrou em {stage.label}&quot; e este passo. Você completa o resto no editor do robô.
          </p>
          {choice === 'send_text' ? (
            <div>
              <label htmlFor="sa-text" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                Mensagem
              </label>
              <textarea id="sa-text" className={`${INPUT} resize-y`} rows={4} value={text} onChange={(e) => setText(e.target.value)} maxLength={4000} />
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Variáveis: {'{{contato.nome}}'}, {'{{lead.titulo}}'}, {'{{lead.etapa}}'}.</p>
            </div>
          ) : null}
          {choice === 'add_tag' ? (
            <div>
              <label htmlFor="sa-tag" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                Tag
              </label>
              <input id="sa-tag" list="sa-tags" className={INPUT} value={tag} onChange={(e) => setTag(e.target.value)} placeholder="Nome da tag" maxLength={60} />
              <datalist id="sa-tags">
                {tags.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </div>
          ) : null}
          {choice === 'move_stage' ? (
            <div>
              <label htmlFor="sa-stage" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                Etapa de destino
              </label>
              <select id="sa-stage" className={INPUT} value={targetStage} onChange={(e) => setTargetStage(e.target.value)}>
                <option value="">Selecione</option>
                {otherStages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          {choice === 'handoff_agent' ? (
            <div>
              <label htmlFor="sa-agent" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                Agente de IA
              </label>
              <select id="sa-agent" className={INPUT} value={agentId} onChange={(e) => setAgentId(e.target.value)}>
                <option value="">Selecione</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-white/5">
            <button type="button" onClick={() => setChoice(null)} className="text-sm text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white">
              Voltar
            </button>
            <button
              type="button"
              onClick={() => void createBot()}
              disabled={saveBot.isPending}
              className="px-3.5 py-2 rounded-lg text-sm font-semibold bg-primary-600 hover:bg-primary-700 text-white disabled:opacity-50 focus-visible-ring"
            >
              {saveBot.isPending ? 'Criando...' : 'Criar e abrir no editor'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

export default StageAutomationPicker;
