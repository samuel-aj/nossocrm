'use client';

/**
 * Editor de agente de IA em abas: Identidade e comportamento | Conhecimento |
 * Ações e recursos | Atendimento e automações | Modelo e resposta (estado
 * local + hash da URL). Barra inferior fixa com Testar / Cancelar / Salvar.
 * "Testar" abre o painel lateral com o chat de teste e o "Ajustar com IA".
 *
 * Salva via POST (novo) ou PATCH (existente, só o que mudou). Um agente novo
 * continua no editor depois de salvo (o id libera uploads e teste).
 *
 * Comportamentos fixos (sem opção na tela, sempre enviados no payload): o
 * agente lê a descrição e os campos personalizados do lead, não tem limite de
 * respostas, mostra "digitando..." antes de cada linha e não tem intervalo
 * fixo entre linhas. Agentes salvos antes com outros valores são normalizados
 * no próximo salvamento (ver `legacyDefaultsPatch`).
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
  Flag,
  CircleStop,
  Webhook,
  KeyRound,
  Zap,
  ListChecks,
  X,
  BookOpen,
  Calculator,
  AlarmClock,
  KanbanSquare,
  Brain,
  Gauge,
  Paperclip,
  UserRound,
  MessageSquare,
} from 'lucide-react';
import ConfirmModal from '@/components/ConfirmModal';
import { useToast } from '@/context/ToastContext';
import {
  AI_PROVIDERS,
  AgentInputSchema,
  DEFAULT_AGENT_AUTO_LEAD,
  DEFAULT_AGENT_TRIGGERS,
  DEFAULT_AGENT_LEAD_CONTEXT,
  DEFAULT_AGENT_MEDIA_UNDERSTANDING,
  DEFAULT_AGENT_TYPING,
  type AgentAiVar,
  type AgentAutoLead,
  type AgentInput,
  type AgentPublic,
  type AgentTriggers,
  type AgentMediaUnderstanding,
  type AgentTyping,
  type AgentWebhook,
  type CustomAction,
  type Outcome,
  type AgentStartMode,
  type AgentFollowup,
} from '@/lib/wa-agents/types';
import { MODEL_CATALOG, PROMPT_VARIABLE_NAMES, PROVIDER_LABELS } from '@/lib/wa-agents/catalog';
import { typingDelayMs, typingSecondsLabel } from '@/lib/wa-agents/typing';
import { DEFAULT_OUTCOMES, DEFAULT_STOP_RULES, DEFAULT_SYSTEM_PROMPT } from '@/lib/wa-agents/defaults';
import {
  WaAgentsApiError,
  useSaveWaAgent,
  useWaAgentDocuments,
  useWaAgentMedia,
  useWaAgentOptions,
  useWaAgentsList,
  useWaBotsList,
  type WaAgentListItem,
  type WaAgentOptions,
} from './useWaAgents';
import { OutcomesEditor } from './OutcomesEditor';
import { CustomActionsEditor } from './CustomActionsEditor';
import { WebhooksEditor } from './WebhooksEditor';
import { PromptEditor, insertToken, mediaToken } from './PromptEditor';
import { HighlightedScript } from './HighlightedScript';
import type { KnownTokens } from './tokens';
import { FollowupsEditor } from './FollowupsEditor';
import { KnowledgePanel } from './KnowledgePanel';
import { AgentTestDrawer } from './AgentTestDrawer';
import {
  BTN_PRIMARY,
  BTN_SECONDARY,
  BTN_SMALL,
  Badge,
  Disclosure,
  Field,
  HELP_CLASS,
  INPUT_CLASS,
  InfoTip,
  Notice,
  Panel,
  ROW_DIVIDER_CLASS,
  SUBCARD_CLASS,
  Segmented,
  SettingRow,
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
  /** Chave da OpenAI só para transcrever áudio, digitada agora ('' = não mexe) */
  audio_api_key: string;
  /** Remover a chave de áudio ao salvar */
  clear_audio_api_key: boolean;
  system_prompt: string;
  /** "Quando encerrar": regras de encerramento que o motor injeta no prompt como bloco obrigatório */
  stop_rules: string;
  /** Campos numéricos aceitam '' enquanto o usuário digita; o limite é aplicado no onBlur e no toPayload. */
  buffer_seconds: number | '';
  history_limit: number | '';
  human_pause_minutes: number | '';
  only_new_conversations: boolean;
  /** Ao ser ativado pelo chat/pipeline: fala primeiro ou espera a próxima mensagem do contato */
  start_mode: AgentStartMode;
  /** Régua de follow-ups por tempo sem resposta do lead */
  followups: AgentFollowup[];
  outcomes: Outcome[];
  custom_actions: CustomAction[];
  triggers: AgentTriggers;
  webhooks: AgentWebhook[];
  helper_agent_ids: string[];
  tools: AgentToolsState;
  /** Velocidade do "digitando..." (sempre ligado; só os tempos são editáveis) */
  typing: Omit<AgentTyping, 'enabled'>;
  media_understanding: AgentMediaUnderstanding;
  /** Lead criado sozinho quando o contato não tem negócio aberto */
  auto_lead: AgentAutoLead;
  /** Variáveis preenchidas pela IA usadas nos campos das ações */
  ai_vars: AgentAiVar[];
};

const CUSTOM_MODEL = '__custom__';

// ---------------------------------------------------------------- Comportamentos fixos

/** Sem intervalo fixo entre linhas: o "digitando..." dá o ritmo. */
const FIXED_LINE_DELAY_MS = 0;
/** Sem limite de respostas por atendimento. */
const FIXED_MAX_REPLIES = 0;
/** O agente sempre lê a descrição e os campos personalizados do lead. */
const FIXED_LEAD_CONTEXT = { ...DEFAULT_AGENT_LEAD_CONTEXT, description: true, custom_fields: true } as const;

function fixedTyping(t: Omit<AgentTyping, 'enabled'>): AgentTyping {
  return { enabled: true, ms_per_char: t.ms_per_char, min_ms: t.min_ms, max_ms: t.max_ms };
}

/**
 * Campos fixos cujo valor salvo no agente ainda é o antigo. Entram no PATCH do
 * próximo salvamento (mesmo sem outra alteração) para o agente passar a ter o
 * comportamento padrão; a tela não os mostra como "alteração não salva".
 */
function legacyDefaultsPatch(agent: AgentPublic | null): Partial<AgentInput> {
  if (!agent) return {};
  const out: Partial<AgentInput> = {};
  if ((agent.line_delay_ms ?? FIXED_LINE_DELAY_MS) !== FIXED_LINE_DELAY_MS) out.line_delay_ms = FIXED_LINE_DELAY_MS;
  if ((agent.max_replies ?? FIXED_MAX_REPLIES) !== FIXED_MAX_REPLIES) out.max_replies = FIXED_MAX_REPLIES;
  const typing = normalizeTyping(agent.typing);
  if (!typing.enabled) out.typing = { ...typing, enabled: true };
  const lead = { ...DEFAULT_AGENT_LEAD_CONTEXT, ...(agent.lead_context ?? {}) };
  if (!lead.description || !lead.custom_fields) out.lead_context = { ...FIXED_LEAD_CONTEXT };
  return out;
}

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
  audio_api_key: 'config',
  buffer_seconds: 'config',
  history_limit: 'config',
  line_delay_ms: 'config',
  human_pause_minutes: 'config',
  max_replies: 'roteiro',
  only_new_conversations: 'gatilhos',
  start_mode: 'gatilhos',
  followups: 'gatilhos',
  webhooks: 'acoes',
  outcomes: 'acoes',
  custom_actions: 'acoes',
  helper_agent_ids: 'acoes',
  tools: 'acoes',
  typing: 'config',
  lead_context: 'roteiro',
  media_understanding: 'config',
  auto_lead: 'gatilhos',
  ai_vars: 'acoes',
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

/** "Digitando" com os padrões preenchidos (agentes anteriores à coluna `typing`). */
function normalizeTyping(src: Partial<AgentTyping> | null | undefined): AgentTyping {
  return { ...DEFAULT_AGENT_TYPING, ...(src ?? {}) };
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
    audio_api_key: '',
    clear_audio_api_key: false,
    system_prompt: src.system_prompt ?? DEFAULT_SYSTEM_PROMPT,
    // Agente existente mantém o que tem (o roteiro antigo já traz o encerramento); novo começa com o padrão
    stop_rules: agent ? (agent.stop_rules ?? '') : (initial?.stop_rules ?? DEFAULT_STOP_RULES),
    buffer_seconds: src.buffer_seconds ?? 10,
    history_limit: src.history_limit ?? 40,
    human_pause_minutes: src.human_pause_minutes ?? 30,
    only_new_conversations: src.only_new_conversations ?? false,
    start_mode: src.start_mode ?? 'speak_first',
    followups: src.followups ?? [],
    outcomes: src.outcomes ?? DEFAULT_OUTCOMES,
    custom_actions: src.custom_actions ?? [],
    triggers: normalizeTriggers(src.triggers),
    webhooks: src.webhooks ?? [],
    helper_agent_ids: src.helper_agent_ids ?? [],
    tools: { calculator: src.tools?.calculator ?? true },
    typing: (({ ms_per_char, min_ms, max_ms }) => ({ ms_per_char, min_ms, max_ms }))(normalizeTyping(src.typing)),
    media_understanding: { ...DEFAULT_AGENT_MEDIA_UNDERSTANDING, ...(src.media_understanding ?? {}) },
    auto_lead: { ...DEFAULT_AGENT_AUTO_LEAD, ...(src.auto_lead ?? {}) },
    ai_vars: src.ai_vars ?? [],
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
    line_delay_ms: FIXED_LINE_DELAY_MS,
    human_pause_minutes: clampField('human_pause_minutes', form.human_pause_minutes),
    max_replies: FIXED_MAX_REPLIES,
    only_new_conversations: form.only_new_conversations,
    start_mode: form.start_mode,
    followups: form.followups,
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
    typing: fixedTyping(form.typing),
    lead_context: { ...FIXED_LEAD_CONTEXT },
    media_understanding: form.media_understanding,
    auto_lead: {
      enabled: form.auto_lead.enabled,
      board_id: form.auto_lead.board_id || null,
      stage_id: form.auto_lead.stage_id || null,
    },
    ai_vars: form.ai_vars,
  };
  if (form.clear_api_key) payload.api_key = null;
  else if (form.api_key.trim()) payload.api_key = form.api_key.trim();
  if (form.clear_audio_api_key) payload.audio_api_key = null;
  else if (form.audio_api_key.trim()) payload.audio_api_key = form.audio_api_key.trim();
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
  audio_api_key: 'Chave da OpenAI para áudio',
  system_prompt: 'Roteiro',
  stop_rules: 'Quando encerrar',
  buffer_seconds: 'Espera para agrupar mensagens',
  history_limit: 'Mensagens de histórico',
  human_pause_minutes: 'Pausa após atendente responder',
  typing: 'Velocidade de resposta',
  start_mode: 'Ao ser ativado',
  followups: 'Follow-ups',
  auto_lead: 'Lead automático',
  ai_vars: 'Variáveis preenchidas pela IA',
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

type NumField = 'buffer_seconds' | 'history_limit' | 'human_pause_minutes';

const NUM_LIMITS: Record<NumField, [min: number, max: number]> = {
  buffer_seconds: [0, 60],
  history_limit: [5, 200],
  human_pause_minutes: [0, 1440],
};

/** Limite final de um campo numérico ('' vira o mínimo). */
function clampField(field: NumField, value: number | ''): number {
  const [min, max] = NUM_LIMITS[field];
  return clampInt(String(value), min, max);
}

/** Limites do "digitando" (mesmos do AgentTypingSchema); vazio volta ao padrão. */
const TYPING_LIMITS: Record<keyof Omit<AgentTyping, 'enabled'>, [number, number]> = {
  ms_per_char: [5, 500],
  min_ms: [0, 30000],
  max_ms: [0, 60000],
};

function clampTyping(field: keyof Omit<AgentTyping, 'enabled'>, raw: string): number {
  const [min, max] = TYPING_LIMITS[field];
  if (raw === '') return DEFAULT_AGENT_TYPING[field];
  return clampInt(raw, min, max);
}

// ---------------------------------------------------------------------------
// "Digitando..." na tela em SEGUNDOS (o banco continua guardando milissegundos)
// ---------------------------------------------------------------------------
/** ms -> segundos com uma casa decimal, só para exibir/editar. */
const msEmSegundos = (ms: number): number => Math.round(ms / 100) / 10;

/** Segundos digitados -> ms, já dentro do limite do campo. */
function segundosEmMs(field: 'min_ms' | 'max_ms', raw: string): number {
  if (raw === '') return DEFAULT_AGENT_TYPING[field];
  const s = Number(raw);
  if (!Number.isFinite(s)) return DEFAULT_AGENT_TYPING[field];
  const [min, max] = TYPING_LIMITS[field];
  return Math.round(Math.min(Math.max(s * 1000, min), max));
}

/** Velocidade em caracteres por segundo (o banco guarda ms por caractere). */
const charsPorSegundo = (msPorChar: number): number => Math.round(1000 / Math.max(1, msPorChar));

function charsPorSegundoEmMs(raw: string): number {
  if (raw === '') return DEFAULT_AGENT_TYPING.ms_per_char;
  const cps = Number(raw);
  if (!Number.isFinite(cps) || cps <= 0) return DEFAULT_AGENT_TYPING.ms_per_char;
  const [min, max] = TYPING_LIMITS.ms_per_char;
  return Math.round(Math.min(Math.max(1000 / cps, min), max));
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
    label: 'Qualquer mensagem',
    help: 'Assume toda conversa nova que chegar nos números marcados.',
  },
  {
    value: 'keywords',
    label: 'Somente quando contiver...',
    help: 'Entra só se a mensagem tiver uma das palavras-chave (ignora maiúsculas e acentos) e passa na frente de um agente do mesmo número que atende qualquer mensagem.',
  },
  {
    value: 'none',
    label: 'Nunca por mensagem',
    help: 'Só por passagem de outro agente, pelo cadastro no pipeline ou pelo botão Automações do chat.',
  },
];

const START_MODES: Array<{ value: AgentStartMode; label: string }> = [
  { value: 'speak_first', label: 'Envia a primeira mensagem' },
  { value: 'wait_reply', label: 'Espera o contato falar' },
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

  const inboundHelp = INBOUND_MODES.find((m) => m.value === inbound.mode)?.help;

  return (
    <div className="space-y-4">
      <div className={SUBCARD_CLASS}>
        <p className="text-sm font-medium text-slate-800 dark:text-slate-200">Por mensagem recebida</p>
        <Segmented
          ariaLabel="Gatilho por mensagem recebida"
          value={inbound.mode}
          onChange={(mode) => setInbound({ mode })}
          options={INBOUND_MODES.map((m) => ({ value: m.value, label: m.label }))}
        />
        {inboundHelp ? <p className={HELP_CLASS}>{inboundHelp}</p> : null}
        {inbound.mode === 'keywords' ? (
          <Field
            label="Palavras-chave"
            htmlFor="agent-inbound-keywords"
            tip="Separe por vírgula ou Enter. Basta uma delas aparecer na mensagem."
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
        <SettingRow
          title="Por cadastro no pipeline"
          tip="Quando um negócio é criado ou entra numa etapa, o agente inicia a conversa com os dados do cadastro no contexto."
          control={
            <Toggle checked={deal.enabled} onChange={(enabled) => setDeal({ enabled })} label="Gatilho por cadastro no pipeline" />
          }
        />

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
              tip={
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
              <Field label="Etapa" htmlFor="agent-deal-stage">
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
              tip="Número conectado que envia a primeira mensagem ao telefone do contato do negócio."
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
 * Campo numérico que mostra o valor numa unidade diferente da guardada (ex.:
 * caracteres por segundo, segundos) sem brigar com a digitação: enquanto está em
 * foco vale o rascunho digitado; cada valor válido é convertido e gravado na hora;
 * ao sair do campo o rascunho some e aparece o valor gravado, já limitado.
 */
function DraftNumberInput({
  value,
  toText,
  fromText,
  onCommit,
  ...inputProps
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'onBlur' | 'type'> & {
  value: number;
  toText: (value: number) => string;
  /** null = rascunho ainda não é um número válido */
  fromText: (text: string) => number | null;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      {...inputProps}
      type="number"
      value={draft ?? toText(value)}
      onChange={(e) => {
        setDraft(e.target.value);
        const n = fromText(e.target.value);
        if (n !== null) onCommit(n);
      }}
      onBlur={() => setDraft(null)}
    />
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
  const botsQ = useWaBotsList();
  /** Robôs no formato mínimo dos editores de ação (Transferir para um robô). */
  const botsMinimal = (botsQ.data ?? []).map((b) => ({
    id: b.id,
    name: b.name,
    enabled: b.enabled,
    connection_id: b.connection_id,
    connection_ids: b.connection_ids ?? [],
  }));
  const save = useSaveWaAgent();

  const [form, setForm] = useState<AgentFormState>(() => buildInitialForm(agent, initial));
  // Snapshot do último estado salvo: o PATCH manda só o que mudou desde então e "dirty" compara com ele.
  const [snapshot, setSnapshot] = useState<Partial<AgentInput>>(() => toPayload(buildInitialForm(agent, initial)));
  const [agentId, setAgentId] = useState<string | null>(agent?.id ?? null);
  const [hasApiKey, setHasApiKey] = useState<boolean>(agent?.has_api_key ?? false);
  const [hasAudioApiKey, setHasAudioApiKey] = useState<boolean>(agent?.has_audio_api_key ?? false);
  // Valores antigos dos comportamentos fixos: vão junto no primeiro PATCH (ver legacyDefaultsPatch).
  const [legacyPatch, setLegacyPatch] = useState<Partial<AgentInput>>(() => legacyDefaultsPatch(agent));
  /** Terá chave para transcrever áudio depois de salvar (digitada agora ou já salva). */
  const temChaveDeAudio = form.clear_audio_api_key ? false : hasAudioApiKey || !!form.audio_api_key.trim();
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
    // Trocar o value de uma textarea joga o cursor (e a rolagem) para o fim:
    // guardamos onde a pessoa estava para devolver depois do redesenho.
    const scrollAntes = el?.scrollTop ?? 0;
    const solto = at !== undefined;
    const { next, caret } = insertToken(value, token, start, end);
    patch({ system_prompt: next });
    setTab('roteiro');
    setPromptHighlight(true);
    window.setTimeout(() => {
      const ta = promptRef.current;
      if (!ta) return;
      // A seleção vem ANTES do foco: focar primeiro faria o navegador rolar até
      // o cursor que o React deixou no fim do texto.
      ta.setSelectionRange(caret, caret);
      ta.focus({ preventScroll: true });
      // Chip solto com o mouse: o ponto já estava à vista, então a rolagem volta
      // para onde estava. Inserção pelo cursor (clique) segue o navegador, que
      // leva até o cursor — ele pode estar fora da parte visível.
      if (solto) ta.scrollTop = scrollAntes;
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
    const input = agentId ? { ...legacyPatch, ...diffPayload(payload, snapshot) } : payload;
    if (agentId && Object.keys(input).length === 0) {
      showToast('Nada para salvar', 'info');
      return true;
    }
    try {
      const saved = await save.mutateAsync({ id: agentId, input });
      const next = { ...payload };
      delete next.api_key;
      delete next.audio_api_key;
      setSnapshot(next);
      setAgentId(saved.id);
      setHasApiKey(!!saved.has_api_key);
      setHasAudioApiKey(!!saved.has_audio_api_key);
      setLegacyPatch({});
      patch({ api_key: '', clear_api_key: false, audio_api_key: '', clear_audio_api_key: false });
      showToast(agentId ? 'Agente salvo' : 'Agente criado. Agora você pode enviar documentos e mídias e testar.', 'success');
      if (saved.warning) {
        // salvo, mas desligado: a chave da IA não está funcionando
        patch({ enabled: false });
        setSnapshot({ ...next, enabled: false });
        showToast(saved.warning, 'warning');
      }
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

  // Variáveis, ações e mídias que existem de verdade: o roteiro e o "Quando encerrar"
  // destacam em âmbar o que estiver escrito como token mas não existir.
  const knownTokens: KnownTokens = {
    vars: PROMPT_VARIABLE_NAMES,
    actions: form.custom_actions.filter((a) => a.key).map((a) => a.key),
    media: (mediaQ.data ?? []).map((m) => m.name),
    mediaLoaded: mediaQ.isSuccess,
  };

  const tabs: TabDef[] = [
    { id: 'roteiro', label: 'Identidade e comportamento', icon: <User size={16} aria-hidden="true" /> },
    {
      id: 'conhecimento',
      label: 'Conhecimento',
      icon: <BookOpen size={16} aria-hidden="true" />,
      badge: countBadge(knowledgeCount),
    },
    {
      id: 'acoes',
      label: 'Ações e recursos',
      icon: <ListChecks size={16} aria-hidden="true" />,
      badge: countBadge(form.custom_actions.length),
    },
    {
      id: 'gatilhos',
      label: 'Atendimento e automações',
      icon: <MessageSquare size={16} aria-hidden="true" />,
      badge: countBadge(form.connection_ids.length),
    },
    { id: 'config', label: 'Modelo e resposta', icon: <Cpu size={16} aria-hidden="true" /> },
  ];

  const agentLabel = form.persona_name || form.name || 'agente';
  /** Chave auxiliar de áudio só quando faz diferença: provedor que não é a OpenAI, ou chave já salva (para remover). */
  const showAudioKey = form.provider !== 'openai' || hasAudioApiKey || form.audio_api_key.trim() !== '';
  const typingPreview = fixedTyping(form.typing);

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
              {agentId ? 'As alterações valem depois de salvar.' : 'Salve para liberar documentos, mídias e o teste.'}
            </p>
          </div>
        </div>
      </div>

      {optionsQ.error ? <Notice tone="red">{errorMessage(optionsQ.error, 'Falha ao carregar as opções')}</Notice> : null}

      <Tabs tabs={tabs} value={tab} onChange={(id) => setTab(id as EditorTab)} ariaLabel="Seções do agente" idPrefix="agent-tab" />

      {/* 1. Identidade e comportamento */}
      <TabPanel id="roteiro" active={tab === 'roteiro'} idPrefix="agent-tab" className="space-y-4">
        <Panel
          title="Identidade"
          icon={<User size={16} />}
          right={
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500 dark:text-slate-400">{form.enabled ? 'Ligado' : 'Desligado'}</span>
              <Toggle checked={form.enabled} onChange={(enabled) => patch({ enabled })} label="Agente ligado" />
            </div>
          }
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Nome do agente" htmlFor="agent-name" tip="Nome interno: aparece nas listas e nas execuções.">
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
              tip="Como o agente se apresenta ao lead. Vazio usa o nome do agente."
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
          {!form.enabled ? <Notice tone="amber">Desligado, o agente não responde e não pode ser iniciado.</Notice> : null}
        </Panel>

        <Panel
          title="Roteiro"
          description="Papel, condução, regras e tom. Pelo botão Testar você conversa com o agente e pede ajustes à IA."
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
            mediaLoaded={mediaQ.isSuccess}
            highlight={promptHighlight}
          />
        </Panel>

        <Panel title="Encerramento" icon={<CircleStop size={16} />}>
          <Field
            label="Regras de encerramento"
            htmlFor="agent-stop-rules"
            tip="Regras obrigatórias, junto do roteiro: assim que uma delas se cumprir, o agente manda a mensagem final e escolhe um dos resultados de Ações e recursos. Ex.: encerrar quando tiver nome, cidade e resumo do caso, ou quando a pessoa pedir para falar com a equipe."
          >
            <HighlightedScript
              id="agent-stop-rules"
              value={form.stop_rules}
              onChange={(stop_rules) => patch({ stop_rules })}
              known={knownTokens}
              rows={6}
              maxLength={4000}
              ariaLabel="Regras de encerramento"
              placeholder="Quando o agente deve encerrar o atendimento e o que dizer na mensagem final."
            />
          </Field>
        </Panel>
      </TabPanel>

      {/* 2. Conhecimento */}
      <TabPanel id="conhecimento" active={tab === 'conhecimento'} idPrefix="agent-tab" className="space-y-4">
        <KnowledgePanel
          agentId={agentId}
          onInsertMedia={(name) => insertPromptToken(mediaToken(name))}
          onRenameMedia={renameMediaTokens}
          onRequestSave={() => void handleSave()}
          saving={save.isPending}
        />
      </TabPanel>

      {/* 3. Ações e recursos */}
      <TabPanel id="acoes" active={tab === 'acoes'} idPrefix="agent-tab" className="space-y-4">
        <Panel
          title="Ações durante a conversa"
          description="O que o agente faz no meio do atendimento, sem encerrar."
          icon={<ListChecks size={16} />}
        >
          <CustomActionsEditor
            value={form.custom_actions}
            onChange={(custom_actions) => patch({ custom_actions })}
            agents={agents}
            options={options}
            aiVars={form.ai_vars}
            onAiVarsChange={(ai_vars) => patch({ ai_vars })}
            currentAgentId={agentId}
            onInsertToken={(token) => insertPromptToken(token)}
          />
        </Panel>

        <Panel
          title="Ações ao finalizar atendimento"
          description="Os resultados que o agente escolhe ao encerrar e o que acontece em cada um."
          icon={<Flag size={16} />}
        >
          <OutcomesEditor
            value={form.outcomes}
            onChange={(outcomes) => patch({ outcomes })}
            agents={agents}
            options={options}
            bots={botsMinimal}
            aiVars={form.ai_vars}
            onAiVarsChange={(ai_vars) => patch({ ai_vars })}
            currentAgentId={agentId}
          />
        </Panel>

        <Panel title="Recursos" icon={<Calculator size={16} />}>
          <div className={ROW_DIVIDER_CLASS}>
            <SettingRow
              title="Calculadora"
              tip="Ferramenta calcular: contas de parcelas, prazos e percentuais sem o modelo chutar números."
              control={
                <Toggle
                  checked={form.tools.calculator}
                  onChange={(calculator) => patch({ tools: { ...form.tools, calculator } })}
                  label="Calculadora"
                />
              }
            />
            <SettingRow
              title="Agentes auxiliares"
              tip="Este agente consulta os auxiliares durante a conversa (ferramenta consultar_agente). O auxiliar não fala com o lead: responde só a este agente, com o próprio roteiro e a própria base de conhecimento. Agentes desligados não podem ser auxiliares."
              control={
                form.helper_agent_ids.length > 0 ? (
                  <Badge tone="purple">
                    {form.helper_agent_ids.length} {form.helper_agent_ids.length === 1 ? 'selecionado' : 'selecionados'}
                  </Badge>
                ) : null
              }
            >
              {agentsQ.isLoading ? (
                <p className={HELP_CLASS}>Carregando agentes...</p>
              ) : helperCandidates.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Nenhum outro agente cadastrado. Crie um especialista com os próprios documentos para usá-lo aqui.
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
            </SettingRow>
          </div>
        </Panel>

        <Panel
          title="Integrações"
          description="Webhooks: avise outros sistemas quando algo acontecer no atendimento."
          icon={<Webhook size={16} />}
        >
          <WebhooksEditor value={form.webhooks} onChange={(webhooks) => patch({ webhooks })} />
        </Panel>
      </TabPanel>

      {/* 4. Atendimento e automações */}
      <TabPanel id="gatilhos" active={tab === 'gatilhos'} idPrefix="agent-tab" className="space-y-4">
        <Panel
          title="Números"
          description="Números conectados em que este agente atende."
          icon={<Phone size={16} />}
          right={
            <InfoTip
              label="Sobre os números"
              text="Deixe vazio se este agente só recebe conversas passadas por outro agente."
            />
          }
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
        </Panel>

        <Panel title="Gatilhos" description={`Quando o agente entra em ação: ${triggerSummary}.`} icon={<Zap size={16} />}>
          <TriggersFields value={form.triggers} onChange={(triggers) => patch({ triggers })} options={options} />
          <div className={`bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-white/10 rounded-lg p-3 ${ROW_DIVIDER_CLASS}`}>
            <SettingRow
              title="Ao ser ativado"
              tip="Vale para o botão Automações do chat e para o início pelo pipeline. Por palavra-chave o agente sempre responde à mensagem que o ativou."
              control={
                <Segmented
                  ariaLabel="Ao ser ativado"
                  value={form.start_mode}
                  onChange={(start_mode) => patch({ start_mode })}
                  options={START_MODES}
                />
              }
            />
            <SettingRow
              title="Somente conversas novas"
              tip="Ligado, o agente não entra em conversas que já tiveram mensagens enviadas pela equipe."
              control={
                <Toggle
                  checked={form.only_new_conversations}
                  onChange={(only_new_conversations) => patch({ only_new_conversations })}
                  label="Atender só conversas novas"
                />
              }
            />
          </div>
        </Panel>

        <Panel title="Lead automático" icon={<KanbanSquare size={16} />}>
          <SettingRow
            title="Criar lead quando o contato ainda não tiver um"
            tip="Ao atender, se o contato não tiver nenhum negócio aberto, o agente cria um (número sem contato no CRM ganha o contato junto). Se já existir, nada muda: nunca duplica. O responsável segue a distribuição de leads da organização."
            control={
              <Toggle
                checked={form.auto_lead.enabled}
                onChange={(enabled) => patch({ auto_lead: { ...form.auto_lead, enabled } })}
                label="Criar lead automaticamente"
              />
            }
          >
            {form.auto_lead.enabled ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Quadro" htmlFor="agent-auto-lead-board">
                  <select
                    id="agent-auto-lead-board"
                    className={INPUT_CLASS}
                    value={form.auto_lead.board_id ?? ''}
                    onChange={(e) =>
                      patch({ auto_lead: { ...form.auto_lead, board_id: e.target.value || null, stage_id: null } })
                    }
                  >
                    <option value="">Primeiro quadro da organização</option>
                    {(options?.boards ?? []).map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Etapa" htmlFor="agent-auto-lead-stage">
                  <select
                    id="agent-auto-lead-stage"
                    className={INPUT_CLASS}
                    value={form.auto_lead.stage_id ?? ''}
                    onChange={(e) => patch({ auto_lead: { ...form.auto_lead, stage_id: e.target.value || null } })}
                  >
                    <option value="">Primeira etapa do quadro</option>
                    {(
                      (form.auto_lead.board_id
                        ? options?.boards.find((b) => b.id === form.auto_lead.board_id)?.stages
                        : options?.boards[0]?.stages) ?? []
                    ).map((st) => (
                      <option key={st.id} value={st.id}>
                        {st.label}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            ) : null}
          </SettingRow>
        </Panel>

        <Panel
          title="Follow-ups"
          description="Quando o lead para de responder: o agente retoma sozinho ou um robô entra em ação."
          icon={<AlarmClock size={16} />}
        >
          <FollowupsEditor value={form.followups} onChange={(followups) => patch({ followups })} bots={botsQ.data ?? []} />
        </Panel>
      </TabPanel>

      {/* 5. Modelo e resposta */}
      <TabPanel id="config" active={tab === 'config'} idPrefix="agent-tab" className="space-y-4">
        <Panel title="Modelo" icon={<Cpu size={16} />}>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
            <Field
              label={`Temperatura: ${form.temperature.toFixed(2)}`}
              htmlFor="agent-temperature"
              tip="Baixa = respostas mais previsíveis; alta = mais criativas. Para atendimento, entre 0,3 e 0,7."
            >
              <input
                id="agent-temperature"
                type="range"
                min={0}
                max={1.5}
                step={0.05}
                value={form.temperature}
                onChange={(e) => patch({ temperature: Number(e.target.value) })}
                className="w-full accent-purple-600 mt-2.5"
              />
            </Field>
          </div>
        </Panel>

        <Panel
          title="Chave própria"
          description="Opcional. Vazio usa a chave da organização, configurada na Central de I.A."
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
                  : undefined
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
          {showAudioKey ? (
            <Field
              label="Chave auxiliar da OpenAI (áudio)"
              htmlFor="agent-audio-api-key"
              tip="Só para transcrever os áudios do lead (whisper-1) quando o provedor do agente não é a OpenAI. Vazio: o Google transcreve com a chave do próprio agente e a Anthropic usa a chave da OpenAI da organização (Central de I.A.)."
              help={
                form.clear_audio_api_key
                  ? 'A chave de áudio será removida ao salvar.'
                  : hasAudioApiKey
                    ? 'Este agente tem uma chave de áudio salva. Digite outra para substituir.'
                    : undefined
              }
            >
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <KeyRound size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                  <input
                    id="agent-audio-api-key"
                    type="password"
                    autoComplete="off"
                    className={`${INPUT_CLASS} pl-9`}
                    value={form.audio_api_key}
                    onChange={(e) => patch({ audio_api_key: e.target.value, clear_audio_api_key: false })}
                    placeholder={hasAudioApiKey ? 'Chave de áudio configurada' : 'sk-...'}
                    maxLength={500}
                    disabled={form.clear_audio_api_key}
                  />
                </div>
                {hasAudioApiKey ? (
                  <button
                    type="button"
                    className={BTN_SMALL}
                    onClick={() => patch({ clear_audio_api_key: !form.clear_audio_api_key, audio_api_key: '' })}
                  >
                    {form.clear_audio_api_key ? 'Manter chave' : 'Remover'}
                  </button>
                ) : null}
              </div>
            </Field>
          ) : null}
        </Panel>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Panel title="Memória" icon={<Brain size={16} />} className="h-full">
            <Field
              label="Mensagens de histórico"
              htmlFor="agent-history"
              tip="Quantas mensagens anteriores da conversa o modelo enxerga (5 a 200)."
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
          </Panel>

          <Panel title="Atendimento humano" icon={<UserRound size={16} />} className="h-full">
            <Field
              label="Pausa após atendente responder (minutos)"
              htmlFor="agent-human-pause"
              tip="Quando alguém da equipe responde, o agente pausa por esse tempo e retoma sozinho. 0 = só retoma manualmente."
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
          </Panel>
        </div>

        <Panel
          title="Velocidade de resposta"
          description="Antes de cada mensagem o contato vê o agente digitando por um tempo proporcional ao texto."
          icon={<Gauge size={16} />}
        >
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field
              label="Caracteres por segundo"
              htmlFor="agent-typing-speed"
              tip="22 = ritmo de celular. Menor = digita mais devagar."
            >
              <DraftNumberInput
                id="agent-typing-speed"
                min={2}
                max={200}
                step={1}
                className={INPUT_CLASS}
                value={form.typing.ms_per_char}
                toText={(ms) => String(charsPorSegundo(ms))}
                fromText={(t) => (t === '' || !(Number(t) > 0) ? null : charsPorSegundoEmMs(t))}
                onCommit={(ms_per_char) => patch({ typing: { ...form.typing, ms_per_char } })}
              />
            </Field>
            <Field label="Tempo mínimo (s)" htmlFor="agent-typing-min" tip="Piso por mensagem, mesmo numa linha curta.">
              <DraftNumberInput
                id="agent-typing-min"
                min={0}
                max={30}
                step={0.1}
                className={INPUT_CLASS}
                value={form.typing.min_ms}
                toText={(ms) => String(msEmSegundos(ms))}
                fromText={(t) => (t === '' || !Number.isFinite(Number(t)) ? null : segundosEmMs('min_ms', t))}
                onCommit={(min_ms) => patch({ typing: { ...form.typing, min_ms } })}
              />
            </Field>
            <Field label="Tempo máximo (s)" htmlFor="agent-typing-max" tip="Teto por mensagem, para uma linha longa não travar a conversa.">
              <DraftNumberInput
                id="agent-typing-max"
                min={0}
                max={60}
                step={0.5}
                className={INPUT_CLASS}
                value={form.typing.max_ms}
                toText={(ms) => String(msEmSegundos(ms))}
                fromText={(t) => (t === '' || !Number.isFinite(Number(t)) ? null : segundosEmMs('max_ms', t))}
                onCommit={(max_ms) => patch({ typing: { ...form.typing, max_ms } })}
              />
            </Field>
          </div>
          <p className={HELP_CLASS}>
            Prévia: mensagem curta <strong>{typingSecondsLabel(typingDelayMs('x'.repeat(40), typingPreview))} s</strong> · média{' '}
            <strong>{typingSecondsLabel(typingDelayMs('x'.repeat(120), typingPreview))} s</strong> · longa{' '}
            <strong>{typingSecondsLabel(typingDelayMs('x'.repeat(240), typingPreview))} s</strong> digitando.
          </p>
          <Disclosure label="Configurações avançadas">
            <Field
              label="Espera para agrupar mensagens (segundos)"
              htmlFor="agent-buffer"
              tip="O agente aguarda esse tempo para o lead terminar de digitar antes de responder (0 a 60)."
              className="sm:max-w-[260px]"
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
          </Disclosure>
        </Panel>

        <Panel
          title="Mídias recebidas no atendimento"
          description="Arquivos que o lead manda na conversa viram texto para o agente. Não tem relação com a base de conhecimento."
          icon={<Paperclip size={16} />}
        >
          <div className={ROW_DIVIDER_CLASS}>
            {(
              [
                ['audio', 'Ouvir áudios', 'Transcreve o que o lead falou. A transcrição também aparece no chat.'],
                ['image', 'Ver imagens', 'Descreve fotos e figurinhas e lê o texto de prints, boletos e documentos fotografados.'],
                ['document', 'Ler documentos', 'Extrai o texto de PDF, DOCX e arquivos de texto.'],
              ] as Array<[keyof AgentMediaUnderstanding, string, string]>
            ).map(([campo, titulo, ajuda]) => (
              <SettingRow
                key={campo}
                title={titulo}
                tip={ajuda}
                control={
                  <Toggle
                    checked={form.media_understanding[campo]}
                    onChange={(v) => patch({ media_understanding: { ...form.media_understanding, [campo]: v } })}
                    label={titulo}
                  />
                }
              />
            ))}
          </div>
          {form.media_understanding.audio && form.provider === 'anthropic' && !temChaveDeAudio ? (
            <Notice tone="amber">
              A Anthropic não transcreve áudio. Informe a chave auxiliar da OpenAI em Chave própria (ou na Central de
              I.A. da organização); sem ela, o áudio chega como &quot;[áudio]&quot;.
            </Notice>
          ) : null}
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
        draft={toPayload(form)}
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
