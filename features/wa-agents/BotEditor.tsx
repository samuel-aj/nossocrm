'use client';

/**
 * Editor de robô de mensagens: nome, número, gatilho e passos ordenáveis.
 * Salva via POST (novo) ou PATCH (existente).
 */
import React, { useRef, useState } from 'react';
import { ArrowLeft, ArrowDown, ArrowUp, Loader2, Plus, Save, Trash2, Workflow, Zap, ListOrdered } from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import { BotInputSchema, type BotInput, type BotRow, type BotStep } from '@/lib/wa-agents/types';
import { DEFAULT_BOT_STEPS } from '@/lib/wa-agents/defaults';
import { useSaveWaBot, useWaAgentOptions, useWaAgentsList, type WaAgentOptions } from './useWaAgents';
import { AgentSelect, StageSelect, TagInput } from './OutcomesEditor';
import {
  BTN_ICON,
  BTN_PRIMARY,
  BTN_SECONDARY,
  Field,
  HELP_CLASS,
  INPUT_CLASS,
  Notice,
  SUBCARD_CLASS,
  Section,
  TEXTAREA_CLASS,
  Toggle,
  describeZodIssue,
  errorMessage,
  newId,
} from './ui';

type BotTriggerType = BotInput['trigger']['type'];
type StepType = BotStep['type'];

export const STEP_LABELS: Record<StepType, string> = {
  send_text: 'Enviar mensagem',
  wait: 'Esperar',
  wait_reply: 'Esperar resposta',
  condition: 'Condição',
  move_stage: 'Mover para etapa',
  add_tag: 'Adicionar rótulo',
  handoff_agent: 'Entregar a um agente de IA',
  end: 'Encerrar',
};

const STEP_TYPES = Object.keys(STEP_LABELS) as StepType[];

export const TRIGGER_LABELS: Record<BotTriggerType, string> = {
  deal_created: 'Negócio criado',
  deal_stage_entered: 'Negócio entrou em uma etapa',
  manual: 'Só manual (pelo botão Testar ou pela API)',
};

const BOT_VARIABLES: Array<{ key: string; description: string }> = [
  { key: '{{nome}}', description: 'nome completo do contato' },
  { key: '{{primeiro_nome}}', description: 'primeiro nome do contato' },
  { key: '{{telefone}}', description: 'telefone do contato' },
  { key: '{{negocio.titulo}}', description: 'título do negócio' },
  { key: '{{negocio.etapa}}', description: 'etapa atual do negócio' },
];

type WaitUnit = 'min' | 'h' | 'd';
const WAIT_UNIT_SECONDS: Record<WaitUnit, number> = { min: 60, h: 3600, d: 86400 };
const WAIT_UNIT_LABELS: Record<WaitUnit, string> = { min: 'minutos', h: 'horas', d: 'dias' };

function unitFor(seconds: number): WaitUnit {
  if (seconds > 0 && seconds % 86400 === 0) return 'd';
  if (seconds > 0 && seconds % 3600 === 0) return 'h';
  return 'min';
}

type BotFormState = {
  name: string;
  enabled: boolean;
  connection_id: string;
  trigger_type: BotTriggerType;
  board_id: string;
  stage_id: string;
  steps: BotStep[];
};

function buildInitialForm(bot: BotRow | null): BotFormState {
  return {
    name: bot?.name ?? '',
    enabled: bot?.enabled ?? true,
    connection_id: bot?.connection_id ?? '',
    trigger_type: bot?.trigger.type ?? 'deal_stage_entered',
    board_id: bot?.trigger.board_id ?? '',
    stage_id: bot?.trigger.stage_id ?? '',
    steps: bot ? bot.steps : DEFAULT_BOT_STEPS.map((s) => ({ ...s, id: s.id || newId() })),
  };
}

function toPayload(form: BotFormState): BotInput {
  return {
    name: form.name.trim(),
    enabled: form.enabled,
    connection_id: form.connection_id || null,
    trigger: {
      type: form.trigger_type,
      board_id: form.trigger_type === 'manual' ? null : form.board_id || null,
      stage_id: form.trigger_type === 'deal_stage_entered' ? form.stage_id || null : null,
    },
    steps: form.steps,
  };
}

function defaultStep(type: StepType, id: string = newId()): BotStep {
  switch (type) {
    case 'send_text':
      return { id, type, text: '' };
    case 'wait':
      return { id, type, seconds: 3600 };
    case 'wait_reply':
      return { id, type, timeout_minutes: 60, on_timeout_step_id: null };
    case 'condition':
      return { id, type, rules: [{ keywords: [], goto_step_id: '' }], else_step_id: null };
    case 'move_stage':
      return { id, type, stage_id: '' };
    case 'add_tag':
      return { id, type, tag: '' };
    case 'handoff_agent':
      return { id, type, agent_id: '' };
    case 'end':
      return { id, type };
  }
}

function parseKeywords(text: string): string[] {
  return Array.from(
    new Set(
      text
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    )
  );
}

function clampInt(value: string, min: number, max: number): number {
  const n = Math.round(Number(value));
  if (Number.isNaN(n)) return min;
  return Math.max(min, Math.min(max, n));
}

/** Limpa, nos demais passos, as referências a um passo removido. */
function dropStepRefs(steps: BotStep[], removedId: string): BotStep[] {
  return steps.map((s) => {
    if (s.type === 'wait_reply' && s.on_timeout_step_id === removedId) return { ...s, on_timeout_step_id: null };
    if (s.type === 'condition') {
      return {
        ...s,
        rules: s.rules.map((r) => (r.goto_step_id === removedId ? { ...r, goto_step_id: '' } : r)),
        else_step_id: s.else_step_id === removedId ? null : s.else_step_id,
      };
    }
    return s;
  });
}

/** Número (a partir de 1) do primeiro passo que aponta para um passo inexistente, ou null. */
function findBrokenStepRef(steps: BotStep[]): number | null {
  const ids = new Set(steps.map((s) => s.id));
  const missing = (id: string | null | undefined) => !!id && !ids.has(id);
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (s.type === 'wait_reply' && missing(s.on_timeout_step_id)) return i + 1;
    if (s.type === 'condition' && (missing(s.else_step_id) || s.rules.some((r) => missing(r.goto_step_id)))) {
      return i + 1;
    }
  }
  return null;
}

const FIELD_NAMES: Record<string, string> = {
  name: 'Nome',
  connection_id: 'Número',
  trigger: 'Gatilho',
  steps: 'Passos',
};

function describeIssue(path: PropertyKey[], message: string): string {
  const root = String(path[0] ?? '');
  const label = FIELD_NAMES[root] ?? root;
  if (root === 'steps' && typeof path[1] === 'number') {
    const rest = path.slice(2).map(String).join('.');
    return `Passo ${path[1] + 1}${rest ? ` (${rest})` : ''}: ${message}`;
  }
  const rest = path.slice(1).map(String).join('.');
  return `${label}${rest ? ` (${rest})` : ''}: ${message}`;
}

/** Select de passo de destino (para "ir para o passo"). */
function StepSelect({
  id,
  steps,
  value,
  onChange,
  excludeId,
  placeholder,
  ariaLabel,
}: {
  id?: string;
  steps: BotStep[];
  value: string;
  onChange: (id: string) => void;
  excludeId?: string;
  placeholder: string;
  ariaLabel: string;
}) {
  return (
    <select id={id} className={INPUT_CLASS} value={value} onChange={(e) => onChange(e.target.value)} aria-label={ariaLabel}>
      <option value="">{placeholder}</option>
      {steps.map((s, i) =>
        s.id === excludeId ? null : (
          <option key={s.id} value={s.id}>
            #{i + 1} {STEP_LABELS[s.type]}
            {s.type === 'send_text' && s.text ? `: ${s.text.slice(0, 30)}` : ''}
          </option>
        )
      )}
    </select>
  );
}

function StepBody({
  step,
  steps,
  onChange,
  options,
  agents,
  waitUnit,
  onWaitUnit,
  kwDrafts,
  onKwDrafts,
}: {
  step: BotStep;
  steps: BotStep[];
  onChange: (s: BotStep) => void;
  options: WaAgentOptions | undefined;
  agents: ReturnType<typeof useWaAgentsList>['data'];
  waitUnit: WaitUnit;
  onWaitUnit: (u: WaitUnit) => void;
  /** Rascunhos das palavras-chave deste passo, na mesma ordem das regras. */
  kwDrafts: string[];
  onKwDrafts: (next: string[]) => void;
}) {
  const textRef = useRef<HTMLTextAreaElement>(null);
  // Campo numérico em edição: mostra o que foi digitado e só aplica o limite ao sair do campo.
  const [numDraft, setNumDraft] = useState<string | null>(null);

  switch (step.type) {
    case 'send_text': {
      const insert = (key: string) => {
        const el = textRef.current;
        const value = step.text;
        const start = el?.selectionStart ?? value.length;
        const end = el?.selectionEnd ?? value.length;
        onChange({ ...step, text: value.slice(0, start) + key + value.slice(end) });
        const caret = start + key.length;
        window.setTimeout(() => {
          if (!textRef.current) return;
          textRef.current.focus();
          textRef.current.setSelectionRange(caret, caret);
        }, 0);
      };
      return (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {BOT_VARIABLES.map((v) => (
              <button
                key={v.key}
                type="button"
                className="px-2 py-1 rounded-md text-xs font-mono bg-slate-100 dark:bg-white/10 text-slate-700 dark:text-slate-200 hover:bg-purple-100 dark:hover:bg-purple-900/30"
                title={v.description}
                onClick={() => insert(v.key)}
              >
                {v.key}
              </button>
            ))}
          </div>
          <textarea
            ref={textRef}
            className={TEXTAREA_CLASS}
            rows={3}
            value={step.text}
            onChange={(e) => onChange({ ...step, text: e.target.value })}
            placeholder="Texto da mensagem"
            aria-label="Texto da mensagem"
            maxLength={4000}
          />
        </div>
      );
    }
    case 'wait': {
      const unitSeconds = WAIT_UNIT_SECONDS[waitUnit];
      const amount = Math.max(1, Math.round(step.seconds / unitSeconds));
      const toSeconds = (raw: string) => Math.min(604800, Math.max(1, clampInt(raw, 1, 604800) * unitSeconds));
      return (
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="number"
            min={1}
            className={`${INPUT_CLASS} w-28`}
            value={numDraft ?? amount}
            onChange={(e) => {
              // Fixa a unidade atual: sem isso ela mudava sozinha conforme os segundos digitados.
              onWaitUnit(waitUnit);
              setNumDraft(e.target.value);
              if (e.target.value !== '') onChange({ ...step, seconds: toSeconds(e.target.value) });
            }}
            onBlur={() => {
              if (numDraft !== null) onChange({ ...step, seconds: toSeconds(numDraft) });
              setNumDraft(null);
            }}
            aria-label="Quanto tempo esperar"
          />
          <select
            className={`${INPUT_CLASS} w-36`}
            value={waitUnit}
            onChange={(e) => {
              const u = e.target.value as WaitUnit;
              onWaitUnit(u);
              onChange({ ...step, seconds: Math.min(604800, Math.max(1, amount * WAIT_UNIT_SECONDS[u])) });
            }}
            aria-label="Unidade de tempo"
          >
            {(Object.keys(WAIT_UNIT_LABELS) as WaitUnit[]).map((u) => (
              <option key={u} value={u}>
                {WAIT_UNIT_LABELS[u]}
              </option>
            ))}
          </select>
          <span className={HELP_CLASS}>Máximo 7 dias.</span>
        </div>
      );
    }
    case 'wait_reply':
      return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field
            label="Aguardar resposta por (minutos)"
            htmlFor={`step-${step.id}-timeout`}
            help="Até 30 dias (43200 minutos)."
          >
            <input
              id={`step-${step.id}-timeout`}
              type="number"
              min={1}
              max={43200}
              className={INPUT_CLASS}
              value={numDraft ?? step.timeout_minutes}
              onChange={(e) => {
                setNumDraft(e.target.value);
                if (e.target.value !== '') onChange({ ...step, timeout_minutes: clampInt(e.target.value, 1, 43200) });
              }}
              onBlur={() => {
                if (numDraft !== null) onChange({ ...step, timeout_minutes: clampInt(numDraft, 1, 43200) });
                setNumDraft(null);
              }}
              aria-label="Minutos aguardando resposta"
            />
          </Field>
          <Field
            label="Se não responder, ir para o passo"
            htmlFor={`step-${step.id}-on-timeout`}
            help="Vazio: encerra o robô sem resposta."
          >
            <StepSelect
              id={`step-${step.id}-on-timeout`}
              steps={steps}
              value={step.on_timeout_step_id ?? ''}
              onChange={(id) => onChange({ ...step, on_timeout_step_id: id || null })}
              excludeId={step.id}
              placeholder="Encerrar"
              ariaLabel="Passo em caso de sem resposta"
            />
          </Field>
        </div>
      );
    case 'condition':
      return (
        <div className="space-y-2">
          <p className={HELP_CLASS}>
            Compara a última resposta do lead (sem acentos, sem diferenciar maiúsculas) com as palavras-chave. A primeira
            regra que bater decide o próximo passo.
          </p>
          {step.rules.map((rule, rIndex) => {
            const draftKey = `${step.id}:${rIndex}`;
            const draft = kwDrafts[rIndex] ?? rule.keywords.join(', ');
            return (
              <div key={draftKey} className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-2 items-center">
                <input
                  className={INPUT_CLASS}
                  value={draft}
                  onChange={(e) => {
                    const nextDrafts = [...kwDrafts];
                    nextDrafts[rIndex] = e.target.value;
                    onKwDrafts(nextDrafts);
                    onChange({
                      ...step,
                      rules: step.rules.map((r, i) => (i === rIndex ? { ...r, keywords: parseKeywords(e.target.value) } : r)),
                    });
                  }}
                  placeholder="Palavras-chave separadas por vírgula (ex.: sim, quero, pode)"
                  aria-label={`Palavras-chave da regra ${rIndex + 1}`}
                />
                <StepSelect
                  steps={steps}
                  value={rule.goto_step_id}
                  onChange={(id) =>
                    onChange({ ...step, rules: step.rules.map((r, i) => (i === rIndex ? { ...r, goto_step_id: id } : r)) })
                  }
                  excludeId={step.id}
                  placeholder="Ir para o passo..."
                  ariaLabel={`Passo de destino da regra ${rIndex + 1}`}
                />
                <button
                  type="button"
                  className={`${BTN_ICON} hover:text-red-600 dark:hover:text-red-400`}
                  aria-label={`Remover regra ${rIndex + 1}`}
                  title="Remover regra"
                  disabled={step.rules.length <= 1}
                  onClick={() => {
                    // Os rascunhos acompanham a remoção para não desalinhar das regras.
                    const nextDrafts = [...kwDrafts];
                    nextDrafts.splice(rIndex, 1);
                    onKwDrafts(nextDrafts);
                    onChange({ ...step, rules: step.rules.filter((_, i) => i !== rIndex) });
                  }}
                >
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              </div>
            );
          })}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10"
              onClick={() => onChange({ ...step, rules: [...step.rules, { keywords: [], goto_step_id: '' }] })}
            >
              <Plus size={14} aria-hidden="true" />
              Adicionar regra
            </button>
          </div>
          <Field
            label="Senão, ir para o passo"
            htmlFor={`step-${step.id}-else`}
            help="Vazio: segue para o próximo passo da lista."
          >
            <StepSelect
              id={`step-${step.id}-else`}
              steps={steps}
              value={step.else_step_id ?? ''}
              onChange={(id) => onChange({ ...step, else_step_id: id || null })}
              excludeId={step.id}
              placeholder="Próximo passo"
              ariaLabel="Passo quando nenhuma regra bate"
            />
          </Field>
        </div>
      );
    case 'move_stage':
      return (
        <StageSelect
          value={step.stage_id}
          onChange={(stage_id) => onChange({ ...step, stage_id })}
          options={options}
          ariaLabel="Etapa de destino"
        />
      );
    case 'add_tag':
      return (
        <TagInput
          id={`step-${step.id}-tag`}
          value={step.tag}
          onChange={(tag) => onChange({ ...step, tag })}
          options={options}
          ariaLabel="Rótulo a adicionar"
        />
      );
    case 'handoff_agent':
      return (
        <div className="space-y-1">
          <AgentSelect
            value={step.agent_id}
            onChange={(agent_id) => onChange({ ...step, agent_id })}
            agents={agents ?? []}
            ariaLabel="Agente de IA que assume"
          />
          <p className={HELP_CLASS}>O robô encerra e o agente assume a conversa a partir daqui.</p>
        </div>
      );
    case 'end':
      return <p className={HELP_CLASS}>O robô termina aqui.</p>;
  }
}

/**
 * Componente React `BotEditor`.
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export const BotEditor: React.FC<{ bot: BotRow | null; onClose: () => void }> = ({ bot, onClose }) => {
  const { showToast } = useToast();
  const optionsQ = useWaAgentOptions();
  const agentsQ = useWaAgentsList();
  const save = useSaveWaBot();

  const [form, setForm] = useState<BotFormState>(() => buildInitialForm(bot));
  const [botId, setBotId] = useState<string | null>(bot?.id ?? null);
  const [waitUnits, setWaitUnits] = useState<Record<string, WaitUnit>>({});
  const [kwDrafts, setKwDrafts] = useState<Record<string, string[]>>({});
  const [addType, setAddType] = useState<string>('');

  const patch = (p: Partial<BotFormState>) => setForm((prev) => ({ ...prev, ...p }));
  const options = optionsQ.data;
  const connections = options?.connections ?? [];
  const boards = options?.boards ?? [];
  const selectedBoard = boards.find((b) => b.id === form.board_id) ?? null;

  const setStep = (index: number, step: BotStep) =>
    patch({ steps: form.steps.map((s, i) => (i === index ? step : s)) });
  const dropKwDrafts = (stepId: string) =>
    setKwDrafts((prev) => {
      const next = { ...prev };
      delete next[stepId];
      return next;
    });
  const removeStep = (index: number) => {
    const removed = form.steps[index];
    dropKwDrafts(removed.id);
    // Quem apontava para o passo removido deixa de apontar.
    patch({ steps: dropStepRefs(form.steps.filter((_, i) => i !== index), removed.id) });
  };
  const moveStep = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= form.steps.length) return;
    const next = [...form.steps];
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    patch({ steps: next });
  };
  const addStep = (type: StepType) => {
    patch({ steps: [...form.steps, defaultStep(type)] });
    setAddType('');
  };
  const changeStepType = (index: number, type: StepType) => {
    const current = form.steps[index];
    if (current.type === type) return;
    dropKwDrafts(current.id);
    setStep(index, defaultStep(type, current.id));
  };

  const handleSave = async (close: boolean) => {
    const payload = toPayload(form);
    const parsed = BotInputSchema.safeParse(payload);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      showToast(issue ? describeIssue(issue.path, describeZodIssue(issue)) : 'Dados inválidos', 'error');
      return;
    }
    const brokenStep = findBrokenStepRef(payload.steps);
    if (brokenStep !== null) {
      showToast(`O passo ${brokenStep} aponta para um passo que não existe`, 'error');
      return;
    }
    if (!payload.connection_id) {
      showToast('Escolha o número que envia as mensagens', 'error');
      return;
    }
    if (payload.trigger.type === 'deal_stage_entered' && !payload.trigger.stage_id) {
      showToast('Escolha a etapa que dispara o robô', 'error');
      return;
    }
    try {
      const saved = await save.mutateAsync({ id: botId, input: payload });
      setBotId(saved.id);
      showToast(botId ? 'Robô salvo' : 'Robô criado', 'success');
      if (close) onClose();
    } catch (err) {
      showToast(errorMessage(err, 'Falha ao salvar o robô'), 'error');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 min-w-0">
        <button type="button" className={BTN_SECONDARY} onClick={onClose} aria-label="Voltar para a lista de robôs">
          <ArrowLeft size={16} aria-hidden="true" />
          Voltar
        </button>
        <div className="min-w-0">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white font-display truncate">
            {botId ? `Editar robô: ${form.name || 'sem nome'}` : 'Novo robô'}
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">Alterações só valem depois de salvar.</p>
        </div>
      </div>

      {optionsQ.error ? <Notice tone="red">{errorMessage(optionsQ.error, 'Falha ao carregar as opções')}</Notice> : null}

      <Section title="Identidade" description="Nome, número que envia e se está ligado." icon={<Workflow size={16} />}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Nome do robô" htmlFor="bot-name">
            <input
              id="bot-name"
              className={INPUT_CLASS}
              value={form.name}
              onChange={(e) => patch({ name: e.target.value })}
              maxLength={120}
              placeholder="Ex.: Boas-vindas do funil trabalhista"
            />
          </Field>
          <Field label="Número que envia" htmlFor="bot-connection">
            <select
              id="bot-connection"
              className={INPUT_CLASS}
              value={form.connection_id}
              onChange={(e) => patch({ connection_id: e.target.value })}
            >
              <option value="">Selecione o número</option>
              {connections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                  {c.status === 'connected' ? '' : ' (desconectado)'}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Ligado</p>
            <p className={HELP_CLASS}>Desligado, o gatilho não dispara e execuções pendentes são canceladas.</p>
          </div>
          <Toggle checked={form.enabled} onChange={(enabled) => patch({ enabled })} label="Robô ligado" />
        </div>
      </Section>

      <Section title="Gatilho" description="O que dispara o robô." icon={<Zap size={16} />}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label="Quando" htmlFor="bot-trigger-type">
            <select
              id="bot-trigger-type"
              className={INPUT_CLASS}
              value={form.trigger_type}
              onChange={(e) => patch({ trigger_type: e.target.value as BotTriggerType })}
            >
              {(Object.keys(TRIGGER_LABELS) as BotTriggerType[]).map((t) => (
                <option key={t} value={t}>
                  {TRIGGER_LABELS[t]}
                </option>
              ))}
            </select>
          </Field>
          {form.trigger_type !== 'manual' ? (
            <Field
              label="Board"
              htmlFor="bot-board"
              help={form.trigger_type === 'deal_created' ? 'Vazio: qualquer board.' : undefined}
            >
              <select
                id="bot-board"
                className={INPUT_CLASS}
                value={form.board_id}
                onChange={(e) => patch({ board_id: e.target.value, stage_id: '' })}
              >
                <option value="">{form.trigger_type === 'deal_created' ? 'Qualquer board' : 'Selecione o board'}</option>
                {boards.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
          {form.trigger_type === 'deal_stage_entered' ? (
            <Field label="Etapa" htmlFor="bot-stage">
              <select
                id="bot-stage"
                className={INPUT_CLASS}
                value={form.stage_id}
                onChange={(e) => patch({ stage_id: e.target.value })}
                disabled={!selectedBoard}
              >
                <option value="">Selecione a etapa</option>
                {(selectedBoard?.stages ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
        </div>
      </Section>

      <Section title="Passos" description="Executados em ordem, de cima para baixo." icon={<ListOrdered size={16} />}>
        {form.steps.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">Nenhum passo. Adicione o primeiro abaixo.</p>
        ) : null}
        {form.steps.map((step, index) => {
          const unit = waitUnits[step.id] ?? (step.type === 'wait' ? unitFor(step.seconds) : 'min');
          return (
            <div key={step.id} className={SUBCARD_CLASS}>
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 text-xs font-bold shrink-0">
                  {index + 1}
                </span>
                <select
                  className={`${INPUT_CLASS} max-w-xs`}
                  value={step.type}
                  onChange={(e) => changeStepType(index, e.target.value as StepType)}
                  aria-label={`Tipo do passo ${index + 1}`}
                >
                  {STEP_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {STEP_LABELS[t]}
                    </option>
                  ))}
                </select>
                <div className="flex items-center gap-1 ml-auto shrink-0">
                  <button
                    type="button"
                    className={BTN_ICON}
                    aria-label={`Subir passo ${index + 1}`}
                    title="Subir"
                    disabled={index === 0}
                    onClick={() => moveStep(index, -1)}
                  >
                    <ArrowUp size={14} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className={BTN_ICON}
                    aria-label={`Descer passo ${index + 1}`}
                    title="Descer"
                    disabled={index === form.steps.length - 1}
                    onClick={() => moveStep(index, 1)}
                  >
                    <ArrowDown size={14} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className={`${BTN_ICON} hover:text-red-600 dark:hover:text-red-400`}
                    aria-label={`Remover passo ${index + 1}`}
                    title="Remover"
                    onClick={() => removeStep(index)}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                </div>
              </div>
              <StepBody
                step={step}
                steps={form.steps}
                onChange={(s) => setStep(index, s)}
                options={options}
                agents={agentsQ.data}
                waitUnit={unit}
                onWaitUnit={(u) => setWaitUnits((prev) => ({ ...prev, [step.id]: u }))}
                kwDrafts={kwDrafts[step.id] ?? []}
                onKwDrafts={(next) => setKwDrafts((prev) => ({ ...prev, [step.id]: next }))}
              />
            </div>
          );
        })}
        <div className="flex items-center gap-2">
          <label htmlFor="bot-add-step" className="text-sm font-medium text-slate-700 dark:text-slate-300">
            Adicionar passo
          </label>
          <select
            id="bot-add-step"
            className={`${INPUT_CLASS} max-w-xs`}
            value={addType}
            onChange={(e) => {
              const t = e.target.value as StepType | '';
              if (t) addStep(t);
            }}
          >
            <option value="">Escolha o tipo...</option>
            {STEP_TYPES.map((t) => (
              <option key={t} value={t}>
                {STEP_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
      </Section>

      <div className="sticky bottom-0 z-10 -mx-1 px-1 pb-1">
        <div className="bg-white/95 dark:bg-slate-900/95 backdrop-blur border border-slate-200 dark:border-white/10 rounded-xl shadow-lg p-3 flex items-center justify-end gap-2 flex-wrap">
          <button type="button" className={BTN_SECONDARY} onClick={onClose} disabled={save.isPending}>
            Cancelar
          </button>
          <button type="button" className={BTN_SECONDARY} onClick={() => void handleSave(false)} disabled={save.isPending}>
            {save.isPending ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Save size={16} aria-hidden="true" />}
            Salvar
          </button>
          <button type="button" className={BTN_PRIMARY} onClick={() => void handleSave(true)} disabled={save.isPending}>
            {save.isPending ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Save size={16} aria-hidden="true" />}
            Salvar e voltar
          </button>
        </div>
      </div>
    </div>
  );
};

export default BotEditor;
