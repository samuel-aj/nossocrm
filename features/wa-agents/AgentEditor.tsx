'use client';

/**
 * Editor de agente de IA: identidade, números, modelo, roteiro,
 * comportamento, resultados/ações e webhooks. Salva via POST (novo) ou
 * PATCH (existente). "Testar" abre o chat de teste depois de salvar.
 */
import React, { useRef, useState } from 'react';
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
  Webhook,
  KeyRound,
} from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/context/ToastContext';
import {
  AI_PROVIDERS,
  AgentInputSchema,
  type AgentInput,
  type AgentPublic,
  type AgentWebhook,
  type Outcome,
} from '@/lib/wa-agents/types';
import { MODEL_CATALOG, PROMPT_VARIABLES, PROVIDER_LABELS } from '@/lib/wa-agents/catalog';
import { DEFAULT_OUTCOMES, DEFAULT_SYSTEM_PROMPT } from '@/lib/wa-agents/defaults';
import { useSaveWaAgent, useWaAgentOptions, useWaAgentsList } from './useWaAgents';
import { OutcomesEditor } from './OutcomesEditor';
import { WebhooksEditor } from './WebhooksEditor';
import { AgentTestChat } from './AgentTestChat';
import {
  BTN_PRIMARY,
  BTN_SECONDARY,
  BTN_SMALL,
  Badge,
  Field,
  HELP_CLASS,
  INPUT_CLASS,
  Notice,
  Section,
  TEXTAREA_CLASS,
  Toggle,
  errorMessage,
} from './ui';

type AiProvider = (typeof AI_PROVIDERS)[number];

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
  buffer_seconds: number;
  history_limit: number;
  line_delay_ms: number;
  human_pause_minutes: number;
  only_new_conversations: boolean;
  outcomes: Outcome[];
  webhooks: AgentWebhook[];
};

const CUSTOM_MODEL = '__custom__';

function firstModel(provider: AiProvider): string {
  return MODEL_CATALOG[provider]?.[0]?.id ?? '';
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
    buffer_seconds: src.buffer_seconds ?? 10,
    history_limit: src.history_limit ?? 40,
    line_delay_ms: src.line_delay_ms ?? 1500,
    human_pause_minutes: src.human_pause_minutes ?? 30,
    only_new_conversations: src.only_new_conversations ?? false,
    outcomes: src.outcomes ?? DEFAULT_OUTCOMES,
    webhooks: src.webhooks ?? [],
  };
}

function toPayload(form: AgentFormState): Partial<AgentInput> {
  const payload: Partial<AgentInput> = {
    name: form.name.trim(),
    persona_name: form.persona_name.trim() || null,
    enabled: form.enabled,
    connection_ids: form.connection_ids,
    provider: form.provider,
    model: form.model.trim(),
    temperature: form.temperature,
    system_prompt: form.system_prompt,
    buffer_seconds: form.buffer_seconds,
    history_limit: form.history_limit,
    line_delay_ms: form.line_delay_ms,
    human_pause_minutes: form.human_pause_minutes,
    only_new_conversations: form.only_new_conversations,
    outcomes: form.outcomes,
    webhooks: form.webhooks,
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
  buffer_seconds: 'Espera para agrupar mensagens',
  history_limit: 'Mensagens de histórico',
  line_delay_ms: 'Intervalo entre linhas',
  human_pause_minutes: 'Pausa após atendente responder',
  outcomes: 'Resultados',
  webhooks: 'Webhooks',
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
  const [agentId, setAgentId] = useState<string | null>(agent?.id ?? null);
  const [hasApiKey, setHasApiKey] = useState<boolean>(agent?.has_api_key ?? false);
  const [testOpen, setTestOpen] = useState(false);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  const patch = (p: Partial<AgentFormState>) => setForm((prev) => ({ ...prev, ...p }));

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

  const toggleConnection = (id: string, checked: boolean) => {
    patch({
      connection_ids: checked
        ? Array.from(new Set([...form.connection_ids, id]))
        : form.connection_ids.filter((c) => c !== id),
    });
  };

  const insertVariable = (key: string) => {
    const el = promptRef.current;
    const value = form.system_prompt;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const next = value.slice(0, start) + key + value.slice(end);
    patch({ system_prompt: next });
    const caret = start + key.length;
    window.setTimeout(() => {
      if (!promptRef.current) return;
      promptRef.current.focus();
      promptRef.current.setSelectionRange(caret, caret);
    }, 0);
  };

  const handleSave = async (): Promise<boolean> => {
    const payload = toPayload(form);
    const parsed = AgentInputSchema.safeParse(payload);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      showToast(issue ? describeIssue(issue.path, issue.message) : 'Dados inválidos', 'error');
      return false;
    }
    try {
      const saved = await save.mutateAsync({ id: agentId, input: payload });
      setAgentId(saved.id);
      setHasApiKey(!!saved.has_api_key);
      patch({ api_key: '', clear_api_key: false });
      showToast(agentId ? 'Agente salvo' : 'Agente criado', 'success');
      return true;
    } catch (err) {
      showToast(errorMessage(err, 'Falha ao salvar o agente'), 'error');
      return false;
    }
  };

  const handleSaveAndClose = async () => {
    const ok = await handleSave();
    if (ok) onClose();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <button type="button" className={BTN_SECONDARY} onClick={onClose} aria-label="Voltar para a lista de agentes">
            <ArrowLeft size={16} aria-hidden="true" />
            Voltar
          </button>
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white font-display truncate">
              {agentId ? `Editar agente: ${form.name || 'sem nome'}` : 'Novo agente'}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Salve para liberar o teste. Alterações só valem depois de salvar.
            </p>
          </div>
        </div>
      </div>

      {optionsQ.error ? <Notice tone="red">{errorMessage(optionsQ.error, 'Falha ao carregar as opções')}</Notice> : null}

      <Section title="Identidade" description="Como o agente se apresenta e se está ligado." icon={<User size={16} />}>
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
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Ligado</p>
            <p className={HELP_CLASS}>Desligado, o agente não responde e não pode ser iniciado.</p>
          </div>
          <Toggle checked={form.enabled} onChange={(enabled) => patch({ enabled })} label="Agente ligado" />
        </div>
      </Section>

      <Section
        title="Números"
        description="Em quais números conectados este agente responde as conversas novas."
        icon={<Phone size={16} />}
      >
        {connections.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Nenhum número conectado. Conecte um número em WhatsApp, Conexão.
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {connections.map((c) => {
              const checked = form.connection_ids.includes(c.id);
              return (
                <label
                  key={c.id}
                  className={`flex items-center gap-3 rounded-lg border px-3 py-2 cursor-pointer text-sm ${
                    checked
                      ? 'border-purple-300 dark:border-purple-500/40 bg-purple-50 dark:bg-purple-900/15'
                      : 'border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-slate-800'
                  }`}
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-slate-300 text-purple-600 focus:ring-purple-500"
                    checked={checked}
                    onChange={(e) => toggleConnection(c.id, e.target.checked)}
                  />
                  <span className="flex-1 min-w-0 truncate text-slate-900 dark:text-white">{c.label}</span>
                  <Badge tone={c.status === 'connected' ? 'green' : 'amber'}>
                    {c.status === 'connected' ? 'Conectado' : c.status || 'Desconectado'}
                  </Badge>
                </label>
              );
            })}
          </div>
        )}
        <p className={HELP_CLASS}>Deixe vazio se este agente só recebe conversas de outro agente.</p>
      </Section>

      <Section title="Modelo" description="Provedor, modelo, criatividade e chave da API." icon={<Cpu size={16} />}>
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
        <Field
          label="Chave própria da API (opcional)"
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
      </Section>

      <Section
        title="Roteiro"
        description="As instruções que guiam o agente. Use as variáveis para personalizar."
        icon={<FileText size={16} />}
      >
        <div className="flex flex-wrap gap-1.5">
          {PROMPT_VARIABLES.map((v) => (
            <button
              key={v.key}
              type="button"
              className="px-2 py-1 rounded-md text-xs font-mono bg-slate-100 dark:bg-white/10 text-slate-700 dark:text-slate-200 hover:bg-purple-100 dark:hover:bg-purple-900/30"
              title={v.description}
              onClick={() => insertVariable(v.key)}
            >
              {v.key}
            </button>
          ))}
        </div>
        <textarea
          ref={promptRef}
          id="agent-system-prompt"
          className={`${TEXTAREA_CLASS} font-mono text-xs leading-relaxed min-h-[360px]`}
          rows={22}
          value={form.system_prompt}
          onChange={(e) => patch({ system_prompt: e.target.value })}
          aria-label="Roteiro do agente"
          maxLength={60000}
          spellCheck={false}
        />
        <Notice tone="blue">
          Lembrete: cada quebra de linha da resposta vira uma mensagem separada no WhatsApp. Peça ao agente uma ideia por
          linha, no máximo 3 linhas e nunca linhas em branco.
        </Notice>
      </Section>

      <Section
        title="Comportamento"
        description="Tempos de espera, histórico e pausa quando um atendente responde."
        icon={<SlidersHorizontal size={16} />}
        defaultOpen={false}
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
              onChange={(e) => patch({ buffer_seconds: clampInt(e.target.value, 0, 60) })}
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
              onChange={(e) => patch({ history_limit: clampInt(e.target.value, 5, 200) })}
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
              onChange={(e) => patch({ line_delay_ms: clampInt(e.target.value, 0, 10000) })}
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
              onChange={(e) => patch({ human_pause_minutes: clampInt(e.target.value, 0, 1440) })}
            />
          </Field>
        </div>
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
      </Section>

      <Section
        title="Resultados e ações"
        description="Como o agente pode encerrar o atendimento e o que acontece em cada caso."
        icon={<Flag size={16} />}
      >
        <OutcomesEditor
          value={form.outcomes}
          onChange={(outcomes) => patch({ outcomes })}
          agents={agents}
          options={options}
          currentAgentId={agentId}
        />
      </Section>

      <Section
        title="Webhooks"
        description="Avise outros sistemas quando algo acontecer no atendimento."
        icon={<Webhook size={16} />}
        defaultOpen={form.webhooks.length > 0}
      >
        <WebhooksEditor value={form.webhooks} onChange={(webhooks) => patch({ webhooks })} />
      </Section>

      {/* Barra fixa inferior */}
      <div className="sticky bottom-0 z-10 -mx-1 px-1 pb-1">
        <div className="bg-white/95 dark:bg-slate-900/95 backdrop-blur border border-slate-200 dark:border-white/10 rounded-xl shadow-lg p-3 flex items-center justify-between gap-2 flex-wrap">
          <button
            type="button"
            className={BTN_SECONDARY}
            onClick={() => setTestOpen(true)}
            disabled={!agentId || save.isPending}
            title={agentId ? 'Abrir o chat de teste' : 'Salve o agente antes de testar'}
          >
            <FlaskConical size={16} aria-hidden="true" />
            Testar
          </button>
          <div className="flex items-center gap-2">
            <button type="button" className={BTN_SECONDARY} onClick={onClose} disabled={save.isPending}>
              Cancelar
            </button>
            <button type="button" className={BTN_SECONDARY} onClick={() => void handleSave()} disabled={save.isPending}>
              {save.isPending ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Save size={16} aria-hidden="true" />}
              Salvar
            </button>
            <button type="button" className={BTN_PRIMARY} onClick={() => void handleSaveAndClose()} disabled={save.isPending}>
              {save.isPending ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Save size={16} aria-hidden="true" />}
              Salvar e voltar
            </button>
          </div>
        </div>
      </div>

      {agentId ? (
        <Modal
          isOpen={testOpen}
          onClose={() => setTestOpen(false)}
          title={`Testar: ${form.persona_name || form.name || 'agente'}`}
          size="xl"
        >
          <AgentTestChat agentId={agentId} agentName={form.persona_name || form.name} />
        </Modal>
      ) : null}
    </div>
  );
};

export default AgentEditor;
