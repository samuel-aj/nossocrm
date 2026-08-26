'use client';

/**
 * Editor de agente de IA em abas: Roteiro | Conhecimento e mídias | Ações |
 * Gatilhos e números | Configurações (estado local + hash da URL).
 * Barra inferior fixa com Testar / Cancelar / Salvar. "Testar" abre o painel
 * lateral com o chat de teste e o "Ajustar com IA".
 *
 * Salva via POST (novo) ou PATCH (existente, só o que mudou). Um agente novo
 * continua no editor depois de salvo (o id libera uploads e teste).
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Save,
  FlaskConical,
  Loader2,
  User,
  Phone,
  Cpu,
  FileText,
  SlidersHorizontal,
  Flag,
  CircleStop,
  Webhook,
  KeyRound,
  Zap,
  ListChecks,
  X,
  BookOpen,
  Settings,
  Users,
  Calculator,
} from 'lucide-react';
import ConfirmModal from '@/components/ConfirmModal';
import { useToast } from '@/context/ToastContext';
import {
  AI_PROVIDERS,
  AgentInputSchema,
  DEFAULT_AGENT_TRIGGERS,
  type AgentInput,
  type AgentPublic,
  type AgentTriggers,
  type AgentWebhook,
  type CustomAction,
  type Outcome,
  type AgentStartMode,
} from '@/lib/wa-agents/types';
import { MODEL_CATALOG, PROVIDER_LABELS } from '@/lib/wa-agents/catalog';
import { DEFAULT_OUTCOMES, DEFAULT_STOP_RULES, DEFAULT_SYSTEM_PROMPT } from '@/lib/wa-agents/defaults';
import {
  WaAgentsApiError,
  useSaveWaAgent,
  useWaAgentDocuments,
  useWaAgentMedia,
  useWaAgentOptions,
  useWaAgentsList,
  type WaAgentListItem,
  type WaAgentOptions,
} from './useWaAgents';
import { OutcomesEditor } from './OutcomesEditor';
import { CustomActionsEditor } from './CustomActionsEditor';
import { WebhooksEditor } from './WebhooksEditor';
import { PromptEditor, insertToken, mediaToken } from './PromptEditor';
import { KnowledgePanel } from './KnowledgePanel';
import { AgentTestDrawer } from './AgentTestDrawer';
import {
  BTN_PRIMARY,
  BTN_SECONDARY,
  BTN_SMALL,
  Badge,
  Field,
  HELP_CLASS,
  INPUT_CLASS,
  Notice,
  Panel,
  SUBCARD_CLASS,
  TEXTAREA_CLASS,
  TabPanel,
  Tabs,
  Toggle,
  describeZodIssue,
  errorMessage,
  type TabDef,
} from './ui';

type AiProvider = (typeof AI_PROVIDERS)[number];

type InboundMode = AgentTriggers['inbound']['mode'];
type DealEvent = AgentTriggers['deal']['event'];

/** Ferramentas extras do agente (espelha AgentToolsSchema). */
type AgentToolsState = { calculator: boolean };

type AgentFormState = {
  name: string;
  persona_name: string;
  enabled: boolean;
  connection_ids: string[];
  provider: AiProvider;
  model: string;
  temperature: number;
  /** Chave digitada agora ('' = não mexe) */
  api_key: string;
  /** Remover a chave própria ao salvar */
  clear_api_key: boolean;
  system_prompt: string;
  /** "Quando encerrar": regras de encerramento que o motor injeta no prompt como bloco obrigatório */
  stop_rules: string;
  /** Campos numéricos aceitam '' enquanto o usuário digita; o limite é aplicado no onBlur e no toPayload. */
  buffer_seconds: number | '';
  history_limit: number | '';
  line_delay_ms: number | '';
  human_pause_minutes: number | '';
  /** Teto de respostas por atendimento (0 = sem limite) */
  max_replies: number | '';
  only_new_conversations: boolean;
  /** Ao ser ativado pelo chat/pipeline: fala primeiro ou espera a próxima mensagem do contato */
  start_mode: AgentStartMode;
  outcomes: Outcome[];
  custom_actions: CustomAction[];
  triggers: AgentTriggers;
  webhooks: AgentWebhook[];
  helper_agent_ids: string[];
  tools: AgentToolsState;
};

const CUSTOM_MODEL = '__custom__';

// ---------------------------------------------------------------- Abas

type EditorTab = 'roteiro' | 'conhecimento' | 'acoes' | 'gatilhos' | 'config';

const TAB_IDS: EditorTab[] = ['roteiro', 'conhecimento', 'acoes', 'gatilhos', 'config'];

function isEditorTab(value: string): value is EditorTab {
  return (TAB_IDS as string[]).includes(value);
}

function readHash(): string {
  return typeof window === 'undefined' ? '' : (window.location.hash || '').replace('#', '');
}

function writeHash(value: string) {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  url.hash = `#${value}`;
  window.history.replaceState({}, '', url.toString());
}

/** Aba onde cada campo mora (para levar o usuário até o erro de validação). */
const FIELD_TABS: Record<string, EditorTab> = {
  name: 'roteiro',
  persona_name: 'roteiro',
  enabled: 'roteiro',
  system_prompt: 'roteiro',
  stop_rules: 'roteiro',
  connection_ids: 'gatilhos',
  triggers: 'gatilhos',
  provider: 'config',
  model: 'config',
  temperature: 'config',
  api_key: 'config',
  buffer_seconds: 'config',
  history_limit: 'config',
  line_delay_ms: 'config',
  human_pause_minutes: 'config',
  max_replies: 'config',
  only_new_conversations: 'config',
  start_mode: 'config',
  webhooks: 'config',
  outcomes: 'acoes',
  custom_actions: 'acoes',
  helper_agent_ids: 'acoes',
  tools: 'acoes',
};

// ---------------------------------------------------------------- Formulário

function firstModel(provider: AiProvider): string {
  return MODEL_CATALOG[provider]?.[0]?.id ?? '';
}

/** Gatilhos com os padrões preenchidos (linhas antigas ou objetos parciais). */
function normalizeTriggers(src: Partial<AgentTriggers> | null | undefined): AgentTriggers {
  return {
    inbound: { ...DEFAULT_AGENT_TRIGGERS.inbound, ...(src?.inbound ?? {}) },
    deal: { ...DEFAULT_AGENT_TRIGGERS.deal, ...(src?.deal ?? {}) },
  };
}

function buildInitialForm(agent: AgentPublic | null, initial?: Partial<AgentInput>): AgentFormState {
  const src: Partial<AgentInput> = agent ?? initial ?? {};
  const provider: AiProvider = src.provider ?? 'openai';
  return {
    name: src.name ?? '',
    persona_name: src.persona_name ?? '',
    enabled: src.enabled ?? true,
    connection_ids: src.connection_ids ?? [],
    provider,
    model: src.model ?? firstModel(provider),
    temperature: src.temperature ?? 0.5,
    api_key: '',
    clear_api_key: false,
    system_prompt: src.system_prompt ?? DEFAULT_SYSTEM_PROMPT,
    // Agente existente mantém o que tem (o roteiro antigo já traz o encerramento); novo começa com o padrão
    stop_rules: agent ? (agent.stop_rules ?? '') : (initial?.stop_rules ?? DEFAULT_STOP_RULES),
    buffer_seconds: src.buffer_seconds ?? 10,
    history_limit: src.history_limit ?? 40,
    line_delay_ms: src.line_delay_ms ?? 1500,
    human_pause_minutes: src.human_pause_minutes ?? 30,
    max_replies: src.max_replies ?? 0,
    only_new_conversations: src.only_new_conversations ?? false,
    start_mode: src.start_mode ?? 'speak_first',
    outcomes: src.outcomes ?? DEFAULT_OUTCOMES,
    custom_actions: src.custom_actions ?? [],
    triggers: normalizeTriggers(src.triggers),
    webhooks: src.webhooks ?? [],
    helper_agent_ids: src.helper_agent_ids ?? [],
    tools: { calculator: src.tools?.calculator ?? true },
  };
}

function toPayload(form: AgentFormState): Partial<AgentInput> {
  const { inbound, deal } = form.triggers;
  const payload: Partial<AgentInput> = {
    name: form.name.trim(),
    persona_name: form.persona_name.trim() || null,
    enabled: form.enabled,
    connection_ids: form.connection_ids,
    provider: form.provider,
    model: form.model.trim(),
    temperature: form.temperature,
    system_prompt: form.system_prompt,
    stop_rules: form.stop_rules,
    buffer_seconds: clampField('buffer_seconds', form.buffer_seconds),
    history_limit: clampField('history_limit', form.history_limit),
    line_delay_ms: clampField('line_delay_ms', form.line_delay_ms),
    human_pause_minutes: clampField('human_pause_minutes', form.human_pause_minutes),
    max_replies: clampField('max_replies', form.max_replies),
    only_new_conversations: form.only_new_conversations,
    start_mode: form.start_mode,
    outcomes: form.outcomes,
    custom_actions: form.custom_actions,
    triggers: {
      inbound: {
        mode: inbound.mode,
        keywords: inbound.keywords.map((k) => k.trim()).filter(Boolean),
      },
      deal: {
        enabled: deal.enabled,
        event: deal.event,
        board_id: deal.board_id || null,
        // A etapa só faz sentido no evento "entrou numa etapa".
        stage_id: deal.event === 'deal_stage_entered' ? deal.stage_id || null : null,
        connection_id: deal.connection_id || null,
      },
    },
    webhooks: form.webhooks,
    helper_agent_ids: form.helper_agent_ids,
    tools: { calculator: form.tools.calculator },
  };
  if (form.clear_api_key) payload.api_key = null;
  else if (form.api_key.trim()) payload.api_key = form.api_key.trim();
  return payload;
}

const FIELD_NAMES: Record<string, string> = {
  name: 'Nome',
  persona_name: 'Nome da persona',
  connection_ids: 'Números',
  provider: 'Provedor',
  model: 'Modelo',
  temperature: 'Temperatura',
  api_key: 'Chave da API',
  system_prompt: 'Roteiro',
  stop_rules: 'Quando encerrar',
  buffer_seconds: 'Espera para agrupar mensagens',
  history_limit: 'Mensagens de histórico',
  line_delay_ms: 'Intervalo entre linhas',
  human_pause_minutes: 'Pausa após atendente responder',
  max_replies: 'Limite de respostas',
  start_mode: 'Ao ser ativado',
  outcomes: 'Resultados',
  custom_actions: 'Ações durante a conversa',
  triggers: 'Gatilhos',
  webhooks: 'Webhooks',
  helper_agent_ids: 'Agentes auxiliares',
  tools: 'Ferramentas',
};

function describeIssue(path: PropertyKey[], message: string): string {
  const root = String(path[0] ?? '');
  const label = FIELD_NAMES[root] ?? root;
  const rest = path.slice(1).map(String).join('.');
  return `${label}${rest ? ` (${rest})` : ''}: ${message}`;
}

function clampInt(value: string, min: number, max: number): number {
  const n = Math.round(Number(value));
  if (Number.isNaN(n)) return min;
  return Math.max(min, Math.min(max, n));
}

type NumField = 'buffer_seconds' | 'history_limit' | 'line_delay_ms' | 'human_pause_minutes' | 'max_replies';

const NUM_LIMITS: Record<NumField, [min: number, max: number]> = {
  buffer_seconds: [0, 60],
  history_limit: [5, 200],
  line_delay_ms: [0, 10000],
  human_pause_minutes: [0, 1440],
  max_replies: [0, 500],
};

/** Limite final de um campo numérico ('' vira o mínimo). */
function clampField(field: NumField, value: number | ''): number {
  const [min, max] = NUM_LIMITS[field];
  return clampInt(String(value), min, max);
}

/** Valor digitado num campo numérico, sem limite: '' fica '' para não travar a digitação. */
function readNumber(raw: string): number | '' {
  if (raw === '') return '';
  const n = Number(raw);
  return Number.isNaN(n) ? '' : n;
}

/** Só os campos cujo valor (em JSON) mudou desde o snapshot; evita sobrescrever o que outra aba alterou. */
function diffPayload(payload: Partial<AgentInput>, snapshot: Partial<AgentInput>): Partial<AgentInput> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (JSON.stringify(value) !== JSON.stringify(snapshot[key as keyof AgentInput])) out[key] = value;
  }
  return out as Partial<AgentInput>;
}

/** Chaves que aparecem mais de uma vez numa lista (resultados ou ações durante a conversa). */
function findDuplicateKeys(items: Array<{ key: string }>): string[] {
  const seen = new Set<string>();
  const dups: string[] = [];
  for (const item of items) {
    if (seen.has(item.key) && !dups.includes(item.key)) dups.push(item.key);
    seen.add(item.key);
  }
  return dups;
}

type FriendlyIssue = { message: string; tab: EditorTab };

/**
 * Primeira mensagem amigável de validação (antes do zod), com a aba onde
 * corrigir, ou null se está tudo certo. Cobre o que o zod descreveria mal:
 * chaves repetidas, gatilhos incompletos, webhooks sem URL, auxiliar desligado.
 */
function findFriendlyIssue(form: AgentFormState, agents: WaAgentListItem[]): FriendlyIssue | null {
  if (!form.name.trim()) return { message: 'Informe o nome do agente', tab: 'roteiro' };

  const dupOutcomes = findDuplicateKeys(form.outcomes);
  if (dupOutcomes.length > 0) return { message: `Chaves de resultado repetidas: ${dupOutcomes.join(', ')}`, tab: 'acoes' };

  const dupActions = findDuplicateKeys(form.custom_actions);
  if (dupActions.length > 0)
    return { message: `Chaves de ação durante a conversa repetidas: ${dupActions.join(', ')}`, tab: 'acoes' };

  for (const [i, o] of form.outcomes.entries()) {
    if (!o.label.trim()) return { message: `Resultado ${i + 1}: informe o rótulo`, tab: 'acoes' };
    if (!o.key) return { message: `Resultado "${o.label}": informe a chave`, tab: 'acoes' };
    if (o.actions.some((a) => a.type === 'webhook' && !a.url.trim()))
      return { message: `Resultado "${o.label}": informe a URL do webhook`, tab: 'acoes' };
  }
  for (const [i, a] of form.custom_actions.entries()) {
    if (!a.label.trim()) return { message: `Ação durante a conversa ${i + 1}: informe o nome`, tab: 'acoes' };
    if (!a.key) return { message: `Ação "${a.label}": informe a chave`, tab: 'acoes' };
    if (!a.description.trim()) return { message: `Ação "${a.label}": descreva quando ela deve acontecer`, tab: 'acoes' };
    if (a.actions.some((x) => x.type === 'webhook' && !x.url.trim()))
      return { message: `Ação "${a.label}": informe a URL do webhook`, tab: 'acoes' };
  }

  for (const id of form.helper_agent_ids) {
    const helper = agents.find((x) => x.id === id);
    if (helper && !helper.enabled)
      return { message: `Agentes auxiliares: "${helper.name}" está desligado. Ligue-o ou remova da lista.`, tab: 'acoes' };
  }

  const { inbound, deal } = form.triggers;
  if (inbound.mode === 'keywords' && inbound.keywords.filter((k) => k.trim()).length === 0)
    return { message: 'Gatilhos: informe ao menos uma palavra-chave para o gatilho por mensagem', tab: 'gatilhos' };
  if (deal.enabled) {
    if (!deal.connection_id)
      return { message: 'Gatilhos: escolha o número que inicia a conversa no gatilho por pipeline', tab: 'gatilhos' };
    if (deal.event === 'deal_stage_entered' && !deal.stage_id)
      return { message: 'Gatilhos: escolha a etapa que dispara o gatilho por pipeline', tab: 'gatilhos' };
  }
  if (!form.model.trim()) return { message: 'Modelo: informe o ID do modelo', tab: 'config' };
  return null;
}

// ---------------------------------------------------------------- Gatilhos

const INBOUND_MODES: Array<{ value: InboundMode; label: string; help: string }> = [
  {
    value: 'any',
    label: 'Qualquer mensagem nova',
    help: 'Padrão. O agente assume toda conversa nova que chegar nos números marcados acima.',
  },
  {
    value: 'keywords',
    label: 'Só quando a mensagem contiver...',
    help: 'O agente só entra se a mensagem tiver uma das palavras-chave (sem diferenciar maiúsculas e acentos). Tem prioridade sobre um agente do mesmo número que atende qualquer mensagem.',
  },
  {
    value: 'none',
    label: 'Nunca por mensagem',
    help: 'Só por passagem de outro agente, pelo cadastro no pipeline ou por início manual no chat.',
  },
];

const DEAL_EVENTS: Array<{ value: DealEvent; label: string }> = [
  { value: 'deal_created', label: 'Negócio criado' },
  { value: 'deal_stage_entered', label: 'Entrou numa etapa' },
];

/** Campo de palavras-chave em chips: vírgula ou Enter adiciona; Backspace com o campo vazio remove a última. */
function KeywordChips({ id, value, onChange }: { id: string; value: string[]; onChange: (v: string[]) => void }) {
  const [draft, setDraft] = useState('');

  const commit = (raw: string) => {
    const parts = raw
      .split(',')
      .map((s) => s.trim().slice(0, 80))
      .filter(Boolean);
    if (parts.length === 0) return;
    const next = [...value];
    for (const p of parts) {
      if (!next.some((k) => k.toLowerCase() === p.toLowerCase())) next.push(p);
    }
    onChange(next);
  };

  return (
    <div className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-white/10 rounded-lg px-2 py-1.5 flex flex-wrap items-center gap-1.5 focus-within:ring-2 focus-within:ring-purple-500/20 focus-within:border-purple-500">
      {value.map((k, i) => (
        <span
          key={`${k}-${i}`}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300"
        >
          {k}
          <button
            type="button"
            className="hover:text-red-600 dark:hover:text-red-400"
            aria-label={`Remover palavra-chave ${k}`}
            onClick={() => onChange(value.filter((_, j) => j !== i))}
          >
            <X size={12} aria-hidden="true" />
          </button>
        </span>
      ))}
      <input
        id={id}
        className="flex-1 min-w-[160px] bg-transparent outline-none text-sm text-slate-900 dark:text-white py-0.5"
        value={draft}
        onChange={(e) => {
          const v = e.target.value;
          if (v.includes(',')) {
            commit(v);
            setDraft('');
          } else {
            setDraft(v);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit(draft);
            setDraft('');
          } else if (e.key === 'Backspace' && draft === '' && value.length > 0) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={() => {
          if (draft.trim()) {
            commit(draft);
            setDraft('');
          }
        }}
        placeholder={value.length === 0 ? 'Ex.: advogado, processo, consulta' : ''}
        maxLength={80}
        aria-label="Palavras-chave"
      />
    </div>
  );
}

function TriggersFields({
  value,
  onChange,
  options,
}: {
  value: AgentTriggers;
  onChange: (v: AgentTriggers) => void;
  options: WaAgentOptions | undefined;
}) {
  const boards = options?.boards ?? [];
  const connections = options?.connections ?? [];
  const { inbound, deal } = value;

  const setInbound = (patch: Partial<AgentTriggers['inbound']>) => onChange({ ...value, inbound: { ...inbound, ...patch } });
  const setDeal = (patch: Partial<AgentTriggers['deal']>) => onChange({ ...value, deal: { ...deal, ...patch } });

  // Quadro efetivo: o escolhido ou, se só a etapa estiver definida, o quadro dela.
  const boardId = deal.board_id ?? boards.find((b) => b.stages.some((s) => s.id === deal.stage_id))?.id ?? '';
  const stages = boards.find((b) => b.id === boardId)?.stages ?? [];
  const selectedConnection = connections.find((c) => c.id === deal.connection_id);

  return (
    <div className="space-y-4">
      <div className={SUBCARD_CLASS}>
        <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Por mensagem recebida</p>
        <div className="space-y-2" role="radiogroup" aria-label="Gatilho por mensagem recebida">
          {INBOUND_MODES.map((m) => (
            <label key={m.value} className="flex items-start gap-3 cursor-pointer">
              <input
                type="radio"
                name="agent-inbound-mode"
                className="mt-1 h-4 w-4 border-slate-300 text-purple-600 focus:ring-purple-500"
                checked={inbound.mode === m.value}
                onChange={() => setInbound({ mode: m.value })}
              />
              <span className="min-w-0">
                <span className="block text-sm text-slate-900 dark:text-white">{m.label}</span>
                <span className="block text-xs text-slate-500 dark:text-slate-400">{m.help}</span>
              </span>
            </label>
          ))}
        </div>
        {inbound.mode === 'keywords' ? (
          <Field
            label="Palavras-chave"
            htmlFor="agent-inbound-keywords"
            help="Separe por vírgula ou Enter. Basta uma delas aparecer na mensagem."
          >
            <KeywordChips
              id="agent-inbound-keywords"
              value={inbound.keywords}
              onChange={(keywords) => setInbound({ keywords })}
            />
          </Field>
        ) : null}
      </div>

      <div className={SUBCARD_CLASS}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Por cadastro no pipeline</p>
            <p className={HELP_CLASS}>
              O agente envia a primeira mensagem sozinho, com os dados do cadastro no contexto.
            </p>
          </div>
          <Toggle checked={deal.enabled} onChange={(enabled) => setDeal({ enabled })} label="Gatilho por cadastro no pipeline" />
        </div>

        {deal.enabled ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Evento" htmlFor="agent-deal-event">
              <select
                id="agent-deal-event"
                className={INPUT_CLASS}
                value={deal.event}
                onChange={(e) => setDeal({ event: e.target.value as DealEvent })}
              >
                {DEAL_EVENTS.map((ev) => (
                  <option key={ev.value} value={ev.value}>
                    {ev.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label={deal.event === 'deal_stage_entered' ? 'Quadro' : 'Quadro (opcional)'}
              htmlFor="agent-deal-board"
              help={
                deal.event === 'deal_stage_entered'
                  ? 'Escolha o quadro para listar as etapas.'
                  : 'Vazio dispara para negócios criados em qualquer quadro.'
              }
            >
              <select
                id="agent-deal-board"
                className={INPUT_CLASS}
                value={boardId}
                onChange={(e) => setDeal({ board_id: e.target.value || null, stage_id: null })}
              >
                <option value="">{deal.event === 'deal_stage_entered' ? 'Selecione o quadro' : 'Qualquer quadro'}</option>
                {boards.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </Field>
            {deal.event === 'deal_stage_entered' ? (
              <Field label="Etapa" htmlFor="agent-deal-stage" help="Dispara quando um negócio entra nesta etapa.">
                <select
                  id="agent-deal-stage"
                  className={INPUT_CLASS}
                  value={deal.stage_id ?? ''}
                  onChange={(e) => setDeal({ stage_id: e.target.value || null, board_id: boardId || null })}
                  disabled={!boardId}
                >
                  <option value="">{boardId ? 'Selecione a etapa' : 'Escolha o quadro primeiro'}</option>
                  {stages.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}
            <Field
              label="Número que inicia a conversa"
              htmlFor="agent-deal-connection"
              help="Número conectado que envia a primeira mensagem ao telefone do contato do negócio."
            >
              <select
                id="agent-deal-connection"
                className={INPUT_CLASS}
                value={deal.connection_id ?? ''}
                onChange={(e) => setDeal({ connection_id: e.target.value || null })}
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
            {selectedConnection && selectedConnection.status !== 'connected' ? (
              <div className="md:col-span-2">
                <Notice tone="amber">
                  Este número não está conectado. O gatilho só consegue enviar a primeira mensagem com o número
                  conectado.
                </Notice>
              </div>
            ) : null}
            {connections.length === 0 ? (
              <div className="md:col-span-2">
                <Notice tone="amber">Nenhum número conectado. Conecte um número em WhatsApp, Conexão.</Notice>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Lista de opções marcáveis (números, agentes auxiliares) no mesmo visual. */
function CheckList<T extends { id: string }>({
  items,
  selected,
  onToggle,
  render,
  disabledIds,
}: {
  items: T[];
  selected: string[];
  onToggle: (id: string, checked: boolean) => void;
  render: (item: T) => React.ReactNode;
  disabledIds?: string[];
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
      {items.map((item) => {
        const checked = selected.includes(item.id);
        const disabled = disabledIds?.includes(item.id) ?? false;
        return (
          <label
            key={item.id}
            className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-sm ${
              disabled ? 'cursor-not-allowed opacity-70' : 'cursor-pointer'
            } ${
              checked
                ? 'border-purple-300 dark:border-purple-500/40 bg-purple-50 dark:bg-purple-900/15'
                : 'border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-slate-800'
            }`}
          >
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300 text-purple-600 focus:ring-purple-500"
              checked={checked}
              disabled={disabled}
              onChange={(e) => onToggle(item.id, e.target.checked)}
            />
            {render(item)}
          </label>
        );
      })}
    </div>
  );
}

/**
 * Componente React `AgentEditor`.
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export const AgentEditor: React.FC<{
  /** Agente existente (edição) ou null (novo) */
  agent: AgentPublic | null;
  /** Valores iniciais para um agente novo (ex.: duplicar) */
  initial?: Partial<AgentInput>;
  onClose: () => void;
}> = ({ agent, initial, onClose }) => {
  const { showToast } = useToast();
  const optionsQ = useWaAgentOptions();
  const agentsQ = useWaAgentsList();
  const save = useSaveWaAgent();

  const [form, setForm] = useState<AgentFormState>(() => buildInitialForm(agent, initial));
  // Snapshot do último estado salvo: o PATCH manda só o que mudou desde então e "dirty" compara com ele.
  const [snapshot, setSnapshot] = useState<Partial<AgentInput>>(() => toPayload(buildInitialForm(agent, initial)));
  const [agentId, setAgentId] = useState<string | null>(agent?.id ?? null);
  const [hasApiKey, setHasApiKey] = useState<boolean>(agent?.has_api_key ?? false);
  const [tab, setTabState] = useState<EditorTab>('roteiro');
  const [testOpen, setTestOpen] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [promptHighlight, setPromptHighlight] = useState(false);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  const docsQ = useWaAgentDocuments(agentId);
  const mediaQ = useWaAgentMedia(agentId);

  // Aba sincronizada com o hash (#roteiro, #conhecimento...). Ao sair, devolve o hash da lista (#agentes).
  useEffect(() => {
    const fromHash = readHash();
    const start: EditorTab = isEditorTab(fromHash) ? fromHash : 'roteiro';
    setTabState(start);
    writeHash(start);
    const onHash = () => {
      const h = readHash();
      if (isEditorTab(h)) setTabState(h);
    };
    window.addEventListener('hashchange', onHash);
    return () => {
      window.removeEventListener('hashchange', onHash);
      if (isEditorTab(readHash())) writeHash('agentes');
    };
  }, []);

  const setTab = (next: EditorTab) => {
    setTabState(next);
    writeHash(next);
  };

  const patch = (p: Partial<AgentFormState>) => setForm((prev) => ({ ...prev, ...p }));

  // Formulário mais recente, para callbacks que chegam depois de uma chamada ao servidor.
  const formRef = useRef(form);
  useEffect(() => {
    formRef.current = form;
  });

  const options = optionsQ.data;
  const connections = options?.connections ?? [];
  const agents = agentsQ.data ?? [];
  const catalog = MODEL_CATALOG[form.provider] ?? [];
  const isCatalogModel = catalog.some((m) => m.id === form.model);
  const [customModel, setCustomModel] = useState<boolean>(() => {
    const models = MODEL_CATALOG[form.provider] ?? [];
    return form.model !== '' && !models.some((m) => m.id === form.model);
  });
  const modelSelectValue = customModel || (!isCatalogModel && form.model !== '') ? CUSTOM_MODEL : form.model;

  const dirty = Object.keys(diffPayload(toPayload(form), snapshot)).length > 0;

  const toggleConnection = (id: string, checked: boolean) => {
    patch({
      connection_ids: checked
        ? Array.from(new Set([...form.connection_ids, id]))
        : form.connection_ids.filter((c) => c !== id),
    });
  };

  const toggleHelper = (id: string, checked: boolean) => {
    patch({
      helper_agent_ids: checked
        ? Array.from(new Set([...form.helper_agent_ids, id]))
        : form.helper_agent_ids.filter((c) => c !== id),
    });
  };

  /**
   * Insere um token no roteiro: no ponto `at` (solto por arrasto) ou na
   * seleção atual da textarea. Troca para a aba Roteiro, foca e destaca.
   */
  const insertPromptToken = (token: string, at?: number) => {
    const el = promptRef.current;
    const value = form.system_prompt;
    const start = at ?? el?.selectionStart ?? value.length;
    const end = at ?? el?.selectionEnd ?? value.length;
    const { next, caret } = insertToken(value, token, start, end);
    patch({ system_prompt: next });
    setTab('roteiro');
    setPromptHighlight(true);
    window.setTimeout(() => {
      const ta = promptRef.current;
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(caret, caret);
      ta.scrollIntoView({ block: 'nearest' });
    }, 0);
    window.setTimeout(() => setPromptHighlight(false), 1200);
  };

  /** Mídia renomeada: troca `[[midia:antigo]]` por `[[midia:novo]]` no roteiro. */
  const renameMediaTokens = (oldName: string, newName: string) => {
    const from = mediaToken(oldName);
    const to = mediaToken(newName);
    const current = formRef.current.system_prompt;
    if (from === to || !current.includes(from)) return;
    patch({ system_prompt: current.split(from).join(to) });
    showToast('Marcadores da mídia atualizados no roteiro. Salve para valer.', 'info');
  };

  const handleSave = async (): Promise<boolean> => {
    const friendly = findFriendlyIssue(form, agents);
    if (friendly) {
      setTab(friendly.tab);
      showToast(friendly.message, 'error');
      return false;
    }
    // Auxiliar já excluído (a exclusão não limpa os outros agentes) some do formulário
    // e do payload; senão o servidor recusa qualquer mudança nos auxiliares.
    const helperIds = agentsQ.isSuccess
      ? form.helper_agent_ids.filter((id) => agents.some((a) => a.id === id))
      : form.helper_agent_ids;
    if (helperIds.length !== form.helper_agent_ids.length) patch({ helper_agent_ids: helperIds });
    const payload = toPayload({ ...form, helper_agent_ids: helperIds });
    const parsed = AgentInputSchema.safeParse(payload);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const root = String(issue?.path[0] ?? '');
      if (FIELD_TABS[root]) setTab(FIELD_TABS[root]);
      showToast(issue ? describeIssue(issue.path, describeZodIssue(issue)) : 'Dados inválidos', 'error');
      return false;
    }
    // PATCH (agente existente): só o que mudou desde o snapshot; api_key só vai quando digitada ou limpa.
    // POST (novo): payload completo.
    const input = agentId ? diffPayload(payload, snapshot) : payload;
    if (agentId && Object.keys(input).length === 0) {
      showToast('Nada para salvar', 'info');
      return true;
    }
    try {
      const saved = await save.mutateAsync({ id: agentId, input });
      const next = { ...payload };
      delete next.api_key;
      setSnapshot(next);
      setAgentId(saved.id);
      setHasApiKey(!!saved.has_api_key);
      patch({ api_key: '', clear_api_key: false });
      showToast(agentId ? 'Agente salvo' : 'Agente criado. Agora você pode enviar documentos e mídias e testar.', 'success');
      return true;
    } catch (err) {
      // Validação do servidor: leva até a aba do campo recusado.
      const root = err instanceof WaAgentsApiError ? String(err.path?.[0] ?? '') : '';
      if (FIELD_TABS[root]) setTab(FIELD_TABS[root]);
      showToast(errorMessage(err, 'Falha ao salvar o agente'), 'error');
      return false;
    }
  };

  /** Testar: um agente novo precisa existir no servidor, então salva antes de abrir o painel. */
  const handleTest = async () => {
    if (!agentId) {
      const ok = await handleSave();
      if (!ok) return;
    }
    setTestOpen(true);
  };

  const handleCancel = () => {
    if (dirty) setConfirmDiscard(true);
    else onClose();
  };

  const triggerSummary = [
    form.triggers.inbound.mode === 'any'
      ? 'qualquer mensagem'
      : form.triggers.inbound.mode === 'keywords'
        ? 'por palavra-chave'
        : 'nunca por mensagem',
    form.triggers.deal.enabled ? 'pipeline ligado' : 'pipeline desligado',
  ].join(', ');

  const helperCandidates = agents.filter((a) => a.id !== agentId);
  const disabledHelpers = helperCandidates.filter((a) => !a.enabled && !form.helper_agent_ids.includes(a.id)).map((a) => a.id);
  const knowledgeCount = (docsQ.data?.length ?? 0) + (mediaQ.data?.length ?? 0);
  const countBadge = (n: number) => (n > 0 ? <Badge tone="slate">{n}</Badge> : undefined);

  const tabs: TabDef[] = [
    { id: 'roteiro', label: 'Roteiro', icon: <FileText size={16} aria-hidden="true" /> },
    {
      id: 'conhecimento',
      label: 'Conhecimento e mídias',
      icon: <BookOpen size={16} aria-hidden="true" />,
      badge: countBadge(knowledgeCount),
    },
    {
      id: 'acoes',
      label: 'Ações',
      icon: <ListChecks size={16} aria-hidden="true" />,
      badge: countBadge(form.custom_actions.length + form.outcomes.length),
    },
    {
      id: 'gatilhos',
      label: 'Gatilhos e números',
      icon: <Zap size={16} aria-hidden="true" />,
      badge: countBadge(form.connection_ids.length),
    },
    { id: 'config', label: 'Configurações', icon: <Settings size={16} aria-hidden="true" /> },
  ];

  const agentLabel = form.persona_name || form.name || 'agente';

  return (
    <div className={`space-y-4 transition-[padding] duration-200 ${testOpen ? 'lg:pr-[496px] xl:pr-[576px]' : ''}`}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <button type="button" className={BTN_SECONDARY} onClick={handleCancel} aria-label="Voltar para a lista de agentes">
            <ArrowLeft size={16} aria-hidden="true" />
            Voltar
          </button>
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white font-display truncate">
              {agentId ? `Editar agente: ${form.name || 'sem nome'}` : 'Novo agente'}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {agentId
                ? 'Alterações só valem depois de salvar. Teste em qualquer aba pelo botão Testar.'
                : 'Salve para liberar documentos, mídias e o teste. Você continua aqui depois de salvar.'}
            </p>
          </div>
        </div>
      </div>

      {optionsQ.error ? <Notice tone="red">{errorMessage(optionsQ.error, 'Falha ao carregar as opções')}</Notice> : null}

      <Tabs tabs={tabs} value={tab} onChange={(id) => setTab(id as EditorTab)} ariaLabel="Seções do agente" idPrefix="agent-tab" />

      {/* Roteiro */}
      <TabPanel id="roteiro" active={tab === 'roteiro'} idPrefix="agent-tab" className="space-y-4">
        <Panel
          title="Identidade"
          description="Como o agente se apresenta e se está ligado."
          icon={<User size={16} />}
          right={
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500 dark:text-slate-400">{form.enabled ? 'Ligado' : 'Desligado'}</span>
              <Toggle checked={form.enabled} onChange={(enabled) => patch({ enabled })} label="Agente ligado" />
            </div>
          }
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Nome do agente" htmlFor="agent-name" help="Uso interno, aparece nas listas e execuções.">
              <input
                id="agent-name"
                className={INPUT_CLASS}
                value={form.name}
                onChange={(e) => patch({ name: e.target.value })}
                maxLength={120}
                placeholder="Ex.: Pré-atendimento trabalhista"
              />
            </Field>
            <Field
              label="Nome da persona"
              htmlFor="agent-persona"
              help="Nome com que o agente se apresenta ao lead. Vazio usa o nome do agente."
            >
              <input
                id="agent-persona"
                className={INPUT_CLASS}
                value={form.persona_name}
                onChange={(e) => patch({ persona_name: e.target.value })}
                maxLength={80}
                placeholder="Ex.: Ana"
              />
            </Field>
          </div>
          {!form.enabled ? <p className={HELP_CLASS}>Desligado, o agente não responde e não pode ser iniciado.</p> : null}
        </Panel>

        <Panel
          title="Roteiro"
          description="As instruções que guiam o agente: papel, como conduzir, regras e tom. Teste e peça ajustes à IA pelo botão Testar."
          icon={<FileText size={16} />}
        >
          <PromptEditor
            id="agent-system-prompt"
            value={form.system_prompt}
            onChange={(system_prompt) => patch({ system_prompt })}
            textareaRef={promptRef}
            onInsertToken={insertPromptToken}
            actions={form.custom_actions.filter((a) => a.key).map((a) => ({ key: a.key, label: a.label }))}
            media={(mediaQ.data ?? []).map((m) => ({ name: m.name, kind: m.kind }))}
            highlight={promptHighlight}
          />
        </Panel>

        <Panel
          title="Quando encerrar"
          description="O momento em que o agente para: o que precisa ter acontecido para ele encerrar e o que diz na mensagem final. Vale como regra obrigatória, junto do roteiro."
          icon={<CircleStop size={16} />}
        >
          <Field
            label="Regras de encerramento"
            htmlFor="agent-stop-rules"
            help="Ex.: encerrar quando tiver nome, cidade e resumo do caso; ou quando a pessoa pedir para falar com alguém da equipe. Ao encerrar, o agente escolhe um dos Resultados da aba Ações."
          >
            <textarea
              id="agent-stop-rules"
              className={TEXTAREA_CLASS}
              rows={7}
              maxLength={4000}
              value={form.stop_rules}
              onChange={(e) => patch({ stop_rules: e.target.value })}
              aria-label="Quando encerrar"
              placeholder="Descreva quando o agente deve encerrar o atendimento e o que dizer na mensagem final."
            />
          </Field>
        </Panel>
      </TabPanel>

      {/* Conhecimento e mídias */}
      <TabPanel id="conhecimento" active={tab === 'conhecimento'} idPrefix="agent-tab" className="space-y-4">
        <KnowledgePanel
          agentId={agentId}
          onInsertMedia={(name) => insertPromptToken(mediaToken(name))}
          onRenameMedia={renameMediaTokens}
          onRequestSave={() => void handleSave()}
          saving={save.isPending}
        />
      </TabPanel>

      {/* Ações */}
      <TabPanel id="acoes" active={tab === 'acoes'} idPrefix="agent-tab" className="space-y-4">
        <Panel
          title="Ações durante a conversa"
          description="O que o agente faz no meio do atendimento, sem encerrar: registrar, mover, rotular ou avisar outro sistema."
          icon={<ListChecks size={16} />}
        >
          <CustomActionsEditor
            value={form.custom_actions}
            onChange={(custom_actions) => patch({ custom_actions })}
            agents={agents}
            options={options}
            currentAgentId={agentId}
            onInsertToken={(token) => insertPromptToken(token)}
          />
        </Panel>

        <Panel
          title="Quando o atendimento terminar"
          description="Os resultados que o agente pode escolher ao encerrar e o que acontece em cada um."
          icon={<Flag size={16} />}
        >
          <OutcomesEditor
            value={form.outcomes}
            onChange={(outcomes) => patch({ outcomes })}
            agents={agents}
            options={options}
            currentAgentId={agentId}
          />
        </Panel>

        <Panel
          title="Agentes auxiliares"
          description="O agente pode consultar estes agentes durante a conversa (ferramenta consultar_agente)."
          icon={<Users size={16} />}
        >
          {agentsQ.isLoading ? (
            <p className={HELP_CLASS}>Carregando agentes...</p>
          ) : helperCandidates.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Nenhum outro agente cadastrado. Crie outro agente (por exemplo, um especialista com os próprios documentos)
              para usá-lo como auxiliar.
            </p>
          ) : (
            <CheckList
              items={helperCandidates}
              selected={form.helper_agent_ids}
              onToggle={toggleHelper}
              disabledIds={disabledHelpers}
              render={(a) => (
                <>
                  <span className="flex-1 min-w-0 truncate text-slate-900 dark:text-white">
                    {a.name}
                    {a.persona_name ? <span className="text-slate-500 dark:text-slate-400"> ({a.persona_name})</span> : null}
                  </span>
                  {!a.enabled ? <Badge tone="amber">Desligado</Badge> : null}
                </>
              )}
            />
          )}
          <p className={HELP_CLASS}>
            O auxiliar não fala com o lead: responde só a este agente, com o próprio roteiro e a própria base de
            conhecimento. Agentes desligados não podem ser auxiliares.
          </p>
        </Panel>

        <Panel title="Ferramentas" description="Recursos extras que o agente pode usar na conversa." icon={<Calculator size={16} />}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Calculadora</p>
              <p className={HELP_CLASS}>
                Para contas (parcelas, prazos, percentuais) sem o modelo chutar números (ferramenta calcular).
              </p>
            </div>
            <Toggle
              checked={form.tools.calculator}
              onChange={(calculator) => patch({ tools: { ...form.tools, calculator } })}
              label="Calculadora"
            />
          </div>
        </Panel>
      </TabPanel>

      {/* Gatilhos e números */}
      <TabPanel id="gatilhos" active={tab === 'gatilhos'} idPrefix="agent-tab" className="space-y-4">
        <Panel
          title="Números"
          description="Em quais números conectados este agente responde as conversas novas."
          icon={<Phone size={16} />}
        >
          {connections.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Nenhum número conectado. Conecte um número em WhatsApp, Conexão.
            </p>
          ) : (
            <CheckList
              items={connections}
              selected={form.connection_ids}
              onToggle={toggleConnection}
              render={(c) => (
                <>
                  <span className="flex-1 min-w-0 truncate text-slate-900 dark:text-white">{c.label}</span>
                  <Badge tone={c.status === 'connected' ? 'green' : 'amber'}>
                    {c.status === 'connected' ? 'Conectado' : c.status || 'Desconectado'}
                  </Badge>
                </>
              )}
            />
          )}
          <p className={HELP_CLASS}>Deixe vazio se este agente só recebe conversas de outro agente.</p>
        </Panel>

        <Panel title="Gatilhos" description={`Quando o agente entra em ação: ${triggerSummary}.`} icon={<Zap size={16} />}>
          <TriggersFields value={form.triggers} onChange={(triggers) => patch({ triggers })} options={options} />
        </Panel>
      </TabPanel>

      {/* Configurações */}
      <TabPanel id="config" active={tab === 'config'} idPrefix="agent-tab" className="space-y-4">
        <Panel title="Modelo" description="Provedor, modelo e criatividade." icon={<Cpu size={16} />}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Provedor" htmlFor="agent-provider">
              <select
                id="agent-provider"
                className={INPUT_CLASS}
                value={form.provider}
                onChange={(e) => {
                  const provider = e.target.value as AiProvider;
                  setCustomModel(false);
                  patch({ provider, model: firstModel(provider) });
                }}
              >
                {AI_PROVIDERS.map((p) => (
                  <option key={p} value={p}>
                    {PROVIDER_LABELS[p] ?? p}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Modelo" htmlFor="agent-model">
              <select
                id="agent-model"
                className={INPUT_CLASS}
                value={modelSelectValue}
                onChange={(e) => {
                  const next = e.target.value;
                  if (next === CUSTOM_MODEL) {
                    setCustomModel(true);
                    if (isCatalogModel) patch({ model: '' });
                    return;
                  }
                  setCustomModel(false);
                  patch({ model: next });
                }}
              >
                {catalog.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                    {m.hint ? ` (${m.hint})` : ''}
                  </option>
                ))}
                <option value={CUSTOM_MODEL}>Outro (digitar ID)</option>
              </select>
              {modelSelectValue === CUSTOM_MODEL ? (
                <input
                  className={`${INPUT_CLASS} mt-2 font-mono`}
                  value={form.model}
                  onChange={(e) => patch({ model: e.target.value })}
                  placeholder="ID do modelo no provedor"
                  aria-label="ID do modelo"
                  maxLength={120}
                />
              ) : null}
            </Field>
          </div>
          <Field
            label={`Temperatura: ${form.temperature.toFixed(2)}`}
            htmlFor="agent-temperature"
            help="Baixa = respostas mais previsíveis; alta = mais criativas. Para atendimento, entre 0,3 e 0,7."
          >
            <input
              id="agent-temperature"
              type="range"
              min={0}
              max={1.5}
              step={0.05}
              value={form.temperature}
              onChange={(e) => patch({ temperature: Number(e.target.value) })}
              className="w-full accent-purple-600"
            />
          </Field>
        </Panel>

        <Panel
          title="Chave própria da API"
          description="Opcional. Vazio usa a chave da organização configurada na Central de I.A."
          icon={<KeyRound size={16} />}
        >
          <Field
            label="Chave da API"
            htmlFor="agent-api-key"
            help={
              form.clear_api_key
                ? 'A chave própria será removida ao salvar; o agente passará a usar a chave da organização.'
                : hasApiKey
                  ? 'Este agente tem uma chave própria salva. Digite outra para substituir.'
                  : 'Vazio usa a chave da organização configurada na Central de I.A.'
            }
          >
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <KeyRound size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                <input
                  id="agent-api-key"
                  type="password"
                  autoComplete="off"
                  className={`${INPUT_CLASS} pl-9`}
                  value={form.api_key}
                  onChange={(e) => patch({ api_key: e.target.value, clear_api_key: false })}
                  placeholder={hasApiKey ? 'Chave própria configurada' : 'Usar chave da organização'}
                  maxLength={500}
                  disabled={form.clear_api_key}
                />
              </div>
              {hasApiKey ? (
                form.clear_api_key ? (
                  <button type="button" className={BTN_SMALL} onClick={() => patch({ clear_api_key: false })}>
                    Manter chave
                  </button>
                ) : (
                  <button
                    type="button"
                    className={BTN_SMALL}
                    onClick={() => patch({ clear_api_key: true, api_key: '' })}
                  >
                    Usar chave da organização
                  </button>
                )
              ) : null}
            </div>
          </Field>
        </Panel>

        <Panel
          title="Comportamento"
          description="Tempos de espera, histórico, pausa quando um atendente responde e limite de respostas."
          icon={<SlidersHorizontal size={16} />}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field
              label="Espera para agrupar mensagens (segundos)"
              htmlFor="agent-buffer"
              help="O agente aguarda esse tempo para o lead terminar de digitar antes de responder. 0 a 60."
            >
              <input
                id="agent-buffer"
                type="number"
                min={0}
                max={60}
                className={INPUT_CLASS}
                value={form.buffer_seconds}
                onChange={(e) => patch({ buffer_seconds: readNumber(e.target.value) })}
                onBlur={() => patch({ buffer_seconds: clampField('buffer_seconds', form.buffer_seconds) })}
              />
            </Field>
            <Field
              label="Mensagens de histórico"
              htmlFor="agent-history"
              help="Quantas mensagens anteriores o modelo enxerga. 5 a 200."
            >
              <input
                id="agent-history"
                type="number"
                min={5}
                max={200}
                className={INPUT_CLASS}
                value={form.history_limit}
                onChange={(e) => patch({ history_limit: readNumber(e.target.value) })}
                onBlur={() => patch({ history_limit: clampField('history_limit', form.history_limit) })}
              />
            </Field>
            <Field
              label="Intervalo entre linhas (ms)"
              htmlFor="agent-line-delay"
              help="Pausa entre cada mensagem enviada, para parecer natural. 0 a 10000."
            >
              <input
                id="agent-line-delay"
                type="number"
                min={0}
                max={10000}
                step={100}
                className={INPUT_CLASS}
                value={form.line_delay_ms}
                onChange={(e) => patch({ line_delay_ms: readNumber(e.target.value) })}
                onBlur={() => patch({ line_delay_ms: clampField('line_delay_ms', form.line_delay_ms) })}
              />
            </Field>
            <Field
              label="Pausa após atendente responder (minutos)"
              htmlFor="agent-human-pause"
              help="Quando alguém da equipe responde, o agente pausa por esse tempo. 0 = só retoma manualmente."
            >
              <input
                id="agent-human-pause"
                type="number"
                min={0}
                max={1440}
                className={INPUT_CLASS}
                value={form.human_pause_minutes}
                onChange={(e) => patch({ human_pause_minutes: readNumber(e.target.value) })}
                onBlur={() => patch({ human_pause_minutes: clampField('human_pause_minutes', form.human_pause_minutes) })}
              />
            </Field>
            <Field
              label="Limite de respostas por atendimento"
              htmlFor="agent-max-replies"
              help="0 = sem limite. Ao atingir o limite, o agente manda a mensagem final e encerra sozinho: garantia de que ele sempre para."
            >
              <input
                id="agent-max-replies"
                type="number"
                min={0}
                max={500}
                className={INPUT_CLASS}
                value={form.max_replies}
                onChange={(e) => patch({ max_replies: readNumber(e.target.value) })}
                onBlur={() => patch({ max_replies: clampField('max_replies', form.max_replies) })}
              />
            </Field>
          </div>
          <Field
            label="Ao ser ativado (pelo chat ou pelo pipeline)"
            htmlFor="agent-start-mode"
            help="Vale para o botão Automações do chat e para o início pelo pipeline. Por palavra-chave o agente sempre responde à mensagem que o ativou."
          >
            <select
              id="agent-start-mode"
              className={INPUT_CLASS}
              value={form.start_mode}
              onChange={(e) => patch({ start_mode: e.target.value === 'wait_reply' ? 'wait_reply' : 'speak_first' })}
            >
              <option value="speak_first">Já envia a primeira mensagem</option>
              <option value="wait_reply">Espera a próxima mensagem do contato e só então responde</option>
            </select>
          </Field>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Só conversas novas</p>
              <p className={HELP_CLASS}>
                Ligado, o agente não entra em conversas que já tiveram mensagens enviadas pela equipe.
              </p>
            </div>
            <Toggle
              checked={form.only_new_conversations}
              onChange={(only_new_conversations) => patch({ only_new_conversations })}
              label="Atender só conversas novas"
            />
          </div>
        </Panel>

        <Panel
          title="Webhooks"
          description="Avise outros sistemas quando algo acontecer no atendimento."
          icon={<Webhook size={16} />}
        >
          <WebhooksEditor value={form.webhooks} onChange={(webhooks) => patch({ webhooks })} />
        </Panel>
      </TabPanel>

      {/* Barra fixa inferior: no celular para em cima da barra de navegação (BottomNav, z-50). */}
      <div className="sticky bottom-[calc(var(--app-bottom-nav-height,0px)+var(--app-safe-area-bottom,0px))] z-10 -mx-1 px-1 pb-1">
        <div className="bg-white/95 dark:bg-slate-900/95 backdrop-blur border border-slate-200 dark:border-white/10 rounded-xl shadow-lg p-3 flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-3">
            <button
              type="button"
              className={BTN_SECONDARY}
              onClick={() => void handleTest()}
              disabled={save.isPending}
              title={agentId ? 'Abrir o chat de teste' : 'Salva o agente e abre o chat de teste'}
              aria-expanded={testOpen}
            >
              <FlaskConical size={16} aria-hidden="true" />
              Testar
            </button>
            {dirty ? (
              <span className="text-xs text-amber-700 dark:text-amber-300" role="status">
                Alterações não salvas
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <button type="button" className={BTN_SECONDARY} onClick={handleCancel} disabled={save.isPending}>
              Cancelar
            </button>
            <button type="button" className={BTN_PRIMARY} onClick={() => void handleSave()} disabled={save.isPending}>
              {save.isPending ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Save size={16} aria-hidden="true" />}
              Salvar
            </button>
          </div>
        </div>
      </div>

      <AgentTestDrawer
        open={testOpen}
        onClose={() => setTestOpen(false)}
        agentId={agentId}
        agentName={agentLabel}
        provider={form.provider}
        model={form.model}
        currentPrompt={form.system_prompt}
        dirty={dirty}
        saving={save.isPending}
        onSave={handleSave}
        onApplyPrompt={(system_prompt) => {
          patch({ system_prompt });
          setTab('roteiro');
        }}
      />

      <ConfirmModal
        isOpen={confirmDiscard}
        onClose={() => setConfirmDiscard(false)}
        onConfirm={() => {
          setConfirmDiscard(false);
          onClose();
        }}
        title="Descartar alterações?"
        message="Há alterações que ainda não foram salvas. Ao sair, elas se perdem."
        confirmText="Sair sem salvar"
        cancelText="Continuar editando"
        variant="danger"
      />
    </div>
  );
};

export default AgentEditor;
