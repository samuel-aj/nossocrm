'use client';

/**
 * Adicionar/editar uma automação da etapa sem sair do board:
 * 1) escolha da ação em cartões; 2) configuração (Ação · Quando dispara ·
 * Momento · Condições · Configurações avançadas); salvar.
 *
 * Ações rodam pelo motor de robôs (um robô marcado como automação da etapa,
 * ver stageAutomationModel.ts); "Agente de IA inicia a conversa" liga o
 * gatilho de pipeline do próprio agente; Webhook sem o módulo de automações
 * cai na regra do pipeline (mesma infra de Integrações).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Bot, MessageCircle, MoveRight, Plus, Sparkles, Tag, Webhook, Workflow, X, type LucideIcon } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Disclosure } from '@/components/ui/Disclosure';
import { useToast } from '@/context/ToastContext';
import { useCRM } from '@/context/CRMContext';
import { DEFAULT_AGENT_TRIGGERS, type BotConditionClause } from '@/lib/wa-agents/types';
import { useSaveWaAgent, useSaveWaBot, useWaAgentOptions, useWaAgentsList, useWaBotsList } from '@/features/wa-agents/useWaAgents';
import { VarField } from '@/features/wa-agents/VarField';
import { CONDITION_OP_LABELS, conditionOpsFor, opNeedsValue, type ConditionField, type ConditionOp } from '@/features/wa-agents/canvas/types';
import type { Board, BoardStage } from '@/types';
import type { StageAutomation } from './useStageAutomations';
import {
  ACTION_NEEDS_CONVERSATION,
  CONDITION_FIELD_LABELS_BOARD,
  MAX_DELAY_SECONDS,
  STAGE_ACTION_LABEL,
  STAGE_ENTRY_LABEL,
  STAGE_WEBHOOK_VARIABLE_GROUPS,
  buildStageActionBot,
  delayToSeconds,
  draftFromBot,
  emptyDraft,
  isStageAutomationBot,
  type DelayUnit,
  type StageActionDraft,
  type StageActionKind,
  type StageEntry,
} from './stageAutomationModel';

type Choice = StageActionKind | 'agent_start';

type Card = { id: Choice; title: string; description: string; icon: LucideIcon; group: string; needsAgents?: boolean; needsBots?: boolean; needsBeta?: boolean };

const CARDS: Card[] = [
  { id: 'send_text', title: STAGE_ACTION_LABEL.send_text, description: 'O lead recebe uma mensagem assim que entra na etapa.', icon: MessageCircle, group: 'Conversa', needsBeta: true },
  { id: 'agent_start', title: 'Agente de IA inicia a conversa', description: 'Um agente manda a primeira mensagem e conduz o atendimento.', icon: Bot, group: 'Conversa', needsAgents: true, needsBeta: true },
  { id: 'handoff_agent', title: STAGE_ACTION_LABEL.handoff_agent, description: 'A conversa aberta do lead passa a ser atendida pelo agente.', icon: Sparkles, group: 'Conversa', needsAgents: true, needsBeta: true },
  { id: 'start_bot', title: STAGE_ACTION_LABEL.start_bot, description: 'Inicia um robô já configurado para este lead.', icon: Workflow, group: 'Conversa', needsBots: true, needsBeta: true },
  { id: 'add_tag', title: STAGE_ACTION_LABEL.add_tag, description: 'Marca o lead com uma tag ao entrar.', icon: Tag, group: 'Ações no CRM', needsBeta: true },
  { id: 'move_stage', title: STAGE_ACTION_LABEL.move_stage, description: 'Leva o lead para outra etapa, deste ou de outro pipeline.', icon: MoveRight, group: 'Ações no CRM', needsBeta: true },
  { id: 'webhook', title: 'Webhook', description: 'Envia os dados do lead e do contato em JSON para o seu n8n, Make ou sistema.', icon: Webhook, group: 'Integrações' },
];

const GROUPS = ['Conversa', 'Ações no CRM', 'Integrações'];

const CONDITION_FIELDS: ConditionField[] = ['deal_source', 'tags', 'deal_value', 'deal_title', 'contact_name', 'contact_phone', 'custom_field'];

const INPUT =
  'w-full bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500';
const INPUT_SM = `${INPUT} px-2.5 py-1.5`;
const LABEL = 'block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1';
const PILL_BASE = 'px-3 py-1.5 rounded-lg border text-sm transition-colors';
const PILL_ON = 'border-primary-300 dark:border-primary-700 bg-primary-50 dark:bg-primary-900/20 font-semibold text-primary-700 dark:text-primary-300';
const PILL_OFF = 'border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/5';

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <div>
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">{title}</h3>
        {hint ? <p className="text-xs text-slate-500 dark:text-slate-400">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

const NOOP = () => undefined;

export function StageActionModal({
  open,
  onClose,
  board,
  stage,
  item,
  automationsApproved,
  onLegacyWebhook,
}: {
  open: boolean;
  onClose: () => void;
  board: Board;
  stage: BoardStage;
  /** Automação existente (edição): ação da etapa ou agente que inicia a conversa */
  item?: StageAutomation | null;
  /** Módulo de IA e automações liberado para a org (ações via motor de robôs) */
  automationsApproved: boolean;
  /** Sem o módulo: webhook pela regra do pipeline (formulário simples) */
  onLegacyWebhook: () => void;
}) {
  const { addToast } = useToast();
  const { customFieldDefinitions } = useCRM();
  const optionsQ = useWaAgentOptions();
  const agentsQ = useWaAgentsList();
  const botsQ = useWaBotsList();
  const saveBot = useSaveWaBot();
  const saveAgent = useSaveWaAgent();

  const editingKind: Choice | null = item?.kind === 'agent' ? 'agent_start' : item?.kind === 'action' && item.bot ? (draftFromBot(item.bot, stage.label)?.kind ?? null) : null;
  const [choice, setChoice] = useState<Choice | null>(editingKind);
  const [draft, setDraft] = useState<StageActionDraft>(() => (item?.bot ? draftFromBot(item.bot, stage.label) : null) ?? emptyDraft('send_text', stage.label));
  const [agentId, setAgentId] = useState(item?.kind === 'agent' ? item.refId : '');
  const [agentConnectionId, setAgentConnectionId] = useState(item?.agent?.triggers?.deal?.connection_id ?? '');

  const connections = optionsQ.data?.connections ?? [];
  const connected = useMemo(() => connections.filter((c) => c.status === 'connected'), [connections]);
  const tags = optionsQ.data?.tags ?? [];
  const boards = optionsQ.data?.boards ?? [];
  const agents = useMemo(() => (agentsQ.data ?? []).filter((a) => a.enabled), [agentsQ.data]);
  const bots = useMemo(() => (botsQ.data ?? []).filter((b) => b.enabled && !isStageAutomationBot(b)), [botsQ.data]);

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
        if (c.needsBots && bots.length === 0) return false;
        return true;
      }),
    [automationsApproved, agents.length, bots.length]
  );

  const pick = (id: Choice) => {
    if (id === 'webhook' && !automationsApproved) {
      onClose();
      onLegacyWebhook();
      return;
    }
    if (id !== 'agent_start') setDraft((d) => ({ ...emptyDraft(id, stage.label), connectionId: d.connectionId }));
    setChoice(id);
  };

  const patch = (p: Partial<StageActionDraft>) => setDraft((d) => ({ ...d, ...p }));
  const saving = saveBot.isPending || saveAgent.isPending;

  const save = async () => {
    if (!choice) return;
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
      if (d.kind === 'start_bot' && !d.botId) return addToast('Escolha o robô.', 'warning');
      if (d.kind === 'webhook' && !/^https?:\/\/\S+$/i.test(d.url.trim())) return addToast('Informe uma URL válida (http/https).', 'warning');
      if (ACTION_NEEDS_CONVERSATION.has(d.kind) && !d.connectionId) return addToast('Escolha o número do WhatsApp desta automação.', 'warning');
      if (d.delay && (!Number.isFinite(d.delay.amount) || d.delay.amount < 1)) return addToast('Informe o tempo de espera.', 'warning');
      if (d.delay && delayToSeconds(d.delay) >= MAX_DELAY_SECONDS && d.delay.amount * (d.delay.unit === 'days' ? 86400 : d.delay.unit === 'hours' ? 3600 : 60) > MAX_DELAY_SECONDS) {
        return addToast('A espera pode ter no máximo 30 dias.', 'warning');
      }
      const badClause = d.conditions.clauses.find((c) => (c.field === 'custom_field' && !c.key) || (opNeedsValue(c.op as ConditionOp) && !String(c.value ?? '').trim()));
      if (badClause) return addToast('Complete as condições (campo e valor) ou remova as vazias.', 'warning');
      if (d.kind === 'start_bot') d.botName = bots.find((b) => b.id === d.botId)?.name ?? d.botName;
      const input = buildStageActionBot(board, stage, d, { enabled: item?.bot ? item.bot.enabled : true, existing: item?.bot ?? null });
      await saveBot.mutateAsync({ id: item?.bot?.id ?? null, input });
      addToast(item ? 'Automação atualizada.' : 'Automação criada e ativa.', 'success');
      onClose();
    } catch (e) {
      addToast((e as Error).message || 'Erro ao salvar a automação', 'error');
    }
  };

  const card = choice ? CARDS.find((c) => c.id === choice) ?? null : null;
  const title = item ? `Editar: ${card?.title ?? 'automação'}` : card ? card.title : `Automatizar: ${stage.label}`;

  const targetBoardId = draft.boardId || board.id;
  const targetBoard = boards.find((b) => b.id === targetBoardId);
  const targetStages = (targetBoard ? targetBoard.stages : board.stages.map((s) => ({ id: s.id, label: s.label }))).filter(
    (s) => !(targetBoardId === board.id && s.id === stage.id)
  );

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

  // ---- Condições
  const clauses = draft.conditions.clauses;
  const setClauses = (next: BotConditionClause[]) => patch({ conditions: { ...draft.conditions, clauses: next } });
  const updateClause = (i: number, p: Partial<BotConditionClause>) => setClauses(clauses.map((c, j) => (j === i ? { ...c, ...p } : c)));
  const addClause = () => setClauses([...clauses, { field: 'deal_source', op: 'equals', value: '', key: undefined }]);
  const customLabel = (key: string) => customFieldDefinitions.find((d) => d.key === key)?.label ?? key;

  const conditionsEditor = (
    <Section title="Condições" hint={clauses.length === 0 ? 'Opcional: só executa se o lead atender às condições.' : 'Executar somente se:'}>
      {clauses.length >= 2 && (
        <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
          <span>Atender:</span>
          <div className="flex rounded-lg border border-slate-200 dark:border-white/10 overflow-hidden">
            <button type="button" onClick={() => patch({ conditions: { ...draft.conditions, match: 'all' } })} className={`px-2 py-1 font-bold transition-colors ${draft.conditions.match === 'all' ? 'bg-primary-600 text-white' : 'text-slate-500 hover:bg-slate-50 dark:hover:bg-white/5'}`}>
              E (todas)
            </button>
            <button type="button" onClick={() => patch({ conditions: { ...draft.conditions, match: 'any' } })} className={`px-2 py-1 font-bold transition-colors ${draft.conditions.match === 'any' ? 'bg-primary-600 text-white' : 'text-slate-500 hover:bg-slate-50 dark:hover:bg-white/5'}`}>
              OU (qualquer)
            </button>
          </div>
        </div>
      )}
      {clauses.map((c, i) => {
        const ops = conditionOpsFor(c.field as ConditionField);
        const needsValue = opNeedsValue(c.op as ConditionOp);
        const def = c.field === 'custom_field' ? customFieldDefinitions.find((d) => d.key === c.key) : null;
        return (
          <div key={i} className="rounded-lg border border-slate-200 dark:border-white/10 p-2 space-y-1.5">
            <div className="flex items-center gap-1.5">
              <select
                value={c.field}
                onChange={(e) => {
                  const field = e.target.value as ConditionField;
                  const nextOps = conditionOpsFor(field);
                  updateClause(i, { field, key: field === 'custom_field' ? customFieldDefinitions[0]?.key : undefined, op: nextOps.includes(c.op as ConditionOp) ? c.op : nextOps[0], value: '' });
                }}
                aria-label="Campo"
                className={`${INPUT_SM} flex-1 min-w-0 cursor-pointer`}
              >
                {CONDITION_FIELDS.filter((f) => f !== 'custom_field' || customFieldDefinitions.length > 0).map((f) => (
                  <option key={f} value={f}>
                    {CONDITION_FIELD_LABELS_BOARD[f]}
                  </option>
                ))}
              </select>
              {c.field === 'custom_field' && (
                <select value={c.key ?? ''} onChange={(e) => updateClause(i, { key: e.target.value, value: '' })} aria-label="Campo personalizado" className={`${INPUT_SM} flex-1 min-w-0 cursor-pointer`}>
                  {customFieldDefinitions.map((d) => (
                    <option key={d.key} value={d.key}>
                      {d.label}
                    </option>
                  ))}
                </select>
              )}
              <button type="button" onClick={() => setClauses(clauses.filter((_, j) => j !== i))} aria-label="Remover condição" title="Remover condição" className="shrink-0 p-1 rounded text-slate-400 hover:text-red-500 dark:hover:text-red-400 transition-colors">
                <X size={14} />
              </button>
            </div>
            <div className="flex items-center gap-1.5">
              <select value={c.op} onChange={(e) => updateClause(i, { op: e.target.value as ConditionOp })} aria-label="Operador" className={`${INPUT_SM} w-40 shrink-0 cursor-pointer`}>
                {ops.map((op) => (
                  <option key={op} value={op}>
                    {CONDITION_OP_LABELS[op]}
                  </option>
                ))}
              </select>
              {needsValue &&
                (c.field === 'tags' && tags.length > 0 ? (
                  <>
                    <input list="sa-cond-tags" value={c.value ?? ''} onChange={(e) => updateClause(i, { value: e.target.value })} placeholder="tag" aria-label="Valor" className={`${INPUT_SM} flex-1 min-w-0`} />
                    <datalist id="sa-cond-tags">
                      {tags.map((t) => (
                        <option key={t} value={t} />
                      ))}
                    </datalist>
                  </>
                ) : def?.type === 'select' && def.options?.length ? (
                  <select value={c.value ?? ''} onChange={(e) => updateClause(i, { value: e.target.value })} aria-label="Valor" className={`${INPUT_SM} flex-1 min-w-0 cursor-pointer`}>
                    <option value="">Selecione...</option>
                    {def.options.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type={c.field === 'deal_value' ? 'number' : 'text'}
                    value={c.value ?? ''}
                    onChange={(e) => updateClause(i, { value: e.target.value })}
                    placeholder={c.field === 'custom_field' && c.key ? customLabel(c.key) : 'valor...'}
                    aria-label="Valor"
                    className={`${INPUT_SM} flex-1 min-w-0`}
                  />
                ))}
            </div>
          </div>
        );
      })}
      <button type="button" onClick={addClause} className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg border border-dashed border-slate-300 dark:border-slate-600 text-xs font-medium text-slate-500 dark:text-slate-400 hover:border-primary-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors">
        <Plus size={13} /> Adicionar condição
      </button>
    </Section>
  );

  const timingEditor = (
    <>
      <Section title="Quando dispara">
        <div className="flex flex-wrap gap-1.5">
          {(['any', 'created', 'moved'] as StageEntry[]).map((e) => (
            <button key={e} type="button" onClick={() => patch({ entry: e })} aria-pressed={draft.entry === e} className={`${PILL_BASE} ${draft.entry === e ? PILL_ON : PILL_OFF}`}>
              {e === 'any' ? 'Nos dois casos' : e === 'created' ? 'Lead criado nesta etapa' : 'Lead movido para esta etapa'}
            </button>
          ))}
        </div>
      </Section>
      <Section title="Momento">
        <div className="flex flex-wrap items-center gap-1.5">
          <button type="button" onClick={() => patch({ delay: null })} aria-pressed={!draft.delay} className={`${PILL_BASE} ${!draft.delay ? PILL_ON : PILL_OFF}`}>
            Imediatamente
          </button>
          <button type="button" onClick={() => patch({ delay: draft.delay ?? { amount: 30, unit: 'minutes' } })} aria-pressed={!!draft.delay} className={`${PILL_BASE} ${draft.delay ? PILL_ON : PILL_OFF}`}>
            Depois de um tempo
          </button>
          {draft.delay && (
            <div className="flex items-center gap-1.5 ml-1">
              <input
                type="number"
                min={1}
                max={draft.delay.unit === 'days' ? 30 : draft.delay.unit === 'hours' ? 720 : 43200}
                value={draft.delay.amount}
                onChange={(e) => patch({ delay: { amount: Number(e.target.value), unit: draft.delay!.unit } })}
                aria-label="Tempo de espera"
                className={`${INPUT_SM} w-20`}
              />
              <select value={draft.delay.unit} onChange={(e) => patch({ delay: { amount: draft.delay!.amount, unit: e.target.value as DelayUnit } })} aria-label="Unidade" className={`${INPUT_SM} w-28 cursor-pointer`}>
                <option value="minutes">minutos</option>
                <option value="hours">horas</option>
                <option value="days">dias</option>
              </select>
            </div>
          )}
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">A automação continua ligada à entrada do lead na etapa; só a execução espera.</p>
      </Section>
    </>
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
              Mensagens, tags, mover de etapa, robôs e agentes dependem do módulo IA e Automações, ainda não liberado para esta organização.
            </p>
          ) : connections.length === 0 ? (
            <p className="text-xs text-amber-700 dark:text-amber-300">
              As ações que falam com o lead usam um número do WhatsApp conectado. Conecte um em WhatsApp → Conexão.
            </p>
          ) : null}
        </div>
      ) : (
        <div className="space-y-5">
          <Section title="Ação" hint={`Quando um lead entrar em ${stage.label}:`}>
            {choice === 'send_text' && (
              <>
                <div>
                  <label htmlFor="sa-text" className={LABEL}>
                    Mensagem
                  </label>
                  <textarea id="sa-text" className={`${INPUT} resize-y`} rows={4} value={draft.text} onChange={(e) => patch({ text: e.target.value })} maxLength={4000} />
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Variáveis: {'{{contato.nome}}'}, {'{{lead.titulo}}'}, {'{{lead.etapa}}'}.</p>
                </div>
                {connectionSelect(draft.connectionId, (v) => patch({ connectionId: v }), 'Número que envia a mensagem (abre a conversa se o lead ainda não tiver uma).')}
              </>
            )}
            {choice === 'add_tag' && (
              <div>
                <label htmlFor="sa-tag" className={LABEL}>
                  Tag
                </label>
                <input id="sa-tag" list="sa-tags" className={INPUT} value={draft.tag} onChange={(e) => patch({ tag: e.target.value })} placeholder="Nome da tag" maxLength={60} />
                <datalist id="sa-tags">
                  {tags.map((t) => (
                    <option key={t} value={t} />
                  ))}
                </datalist>
              </div>
            )}
            {choice === 'move_stage' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="sa-board" className={LABEL}>
                    Pipeline de destino
                  </label>
                  <select id="sa-board" className={INPUT} value={targetBoardId} onChange={(e) => patch({ boardId: e.target.value === board.id ? '' : e.target.value, stageId: '' })}>
                    <option value={board.id}>{board.name} (este pipeline)</option>
                    {boards.filter((b) => b.id !== board.id).map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="sa-stage" className={LABEL}>
                    Etapa de destino
                  </label>
                  <select id="sa-stage" className={INPUT} value={draft.stageId} onChange={(e) => patch({ stageId: e.target.value })}>
                    <option value="">Selecione</option>
                    {targetStages.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}
            {choice === 'handoff_agent' && (
              <>
                <div>
                  <label htmlFor="sa-agent" className={LABEL}>
                    Agente de IA
                  </label>
                  <select id="sa-agent" className={INPUT} value={draft.agentId} onChange={(e) => patch({ agentId: e.target.value })}>
                    <option value="">Selecione</option>
                    {agents.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </div>
                {connectionSelect(draft.connectionId, (v) => patch({ connectionId: v }), 'Número da conversa que o agente passa a atender.')}
              </>
            )}
            {choice === 'start_bot' && (
              <>
                <div>
                  <label htmlFor="sa-bot" className={LABEL}>
                    Robô
                  </label>
                  <select id="sa-bot" className={INPUT} value={draft.botId} onChange={(e) => patch({ botId: e.target.value, botName: bots.find((b) => b.id === e.target.value)?.name ?? '' })}>
                    <option value="">Selecione</option>
                    {bots.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Usa o robô como ele está configurado em IA e Automações → Robôs.</p>
                </div>
                {connectionSelect(draft.connectionId, (v) => patch({ connectionId: v }), 'Número em que o robô conversa com o lead.')}
              </>
            )}
            {choice === 'webhook' && (
              <>
                <div>
                  <label htmlFor="sa-url" className={LABEL}>
                    URL
                  </label>
                  <input id="sa-url" type="url" className={INPUT} value={draft.url} onChange={(e) => patch({ url: e.target.value })} placeholder="https://..." autoFocus />
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    Por padrão envia um POST em JSON com o lead completo (id, título, etapa, pipeline, responsável, valor, origem, tags, campos personalizados) e o contato.
                  </p>
                </div>
              </>
            )}
            {choice === 'agent_start' && (
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
                    return <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">O agente manda a primeira mensagem e segue o roteiro dele. Dispara imediatamente, em qualquer entrada.</p>;
                  })()}
                </div>
                {connectionSelect(agentConnectionId, setAgentConnectionId, 'Número que inicia a conversa com o lead.')}
              </>
            )}
          </Section>

          {choice !== 'agent_start' && timingEditor}
          {choice !== 'agent_start' && conditionsEditor}

          {choice === 'webhook' && (
            <Disclosure label="Configurações avançadas" defaultOpen={!!draft.bodyTemplate || !!draft.secret}>
              <div className="space-y-3 pt-1">
                <div>
                  <label htmlFor="sa-body" className={LABEL}>
                    Body personalizado (JSON)
                  </label>
                  <VarField
                    id="sa-body"
                    value={draft.bodyTemplate}
                    onChange={(v) => patch({ bodyTemplate: v })}
                    placeholder={'{\n  "nome": "{{contact.name}}",\n  "telefone": "{{contact.phone}}",\n  "lead_id": "{{deal.id}}",\n  "etapa": "{{deal.stage_label}}"\n}'}
                    maxLength={20000}
                    rows={8}
                    ariaLabel="Body personalizado do webhook"
                    aiVars={[]}
                    onAiVarsChange={NOOP}
                    groups={STAGE_WEBHOOK_VARIABLE_GROUPS}
                    insertLabel="Inserir variável"
                  />
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Vazio envia o payload completo padrão. Digite {'{'} para ver as variáveis do contato, do lead, do pipeline e dos campos personalizados.</p>
                </div>
                <div className="sm:max-w-md">
                  <label htmlFor="sa-secret" className={LABEL}>
                    Segredo
                  </label>
                  <input id="sa-secret" className={`${INPUT} font-mono text-xs`} value={draft.secret} onChange={(e) => patch({ secret: e.target.value })} placeholder="vazio = sem cabeçalho de segredo" maxLength={200} autoComplete="off" />
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Só quando preenchido: vai nos cabeçalhos X-Webhook-Secret e Authorization: Bearer.</p>
                </div>
              </div>
            </Disclosure>
          )}

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
              <button type="button" onClick={() => void save()} disabled={saving} className="px-3.5 py-2 rounded-lg text-sm font-semibold bg-primary-600 hover:bg-primary-700 text-white disabled:opacity-50 focus-visible-ring">
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
