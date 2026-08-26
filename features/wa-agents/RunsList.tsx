'use client';

/**
 * Execuções: tabela das execuções dos agentes (com filtro por agente e
 * detalhes expansíveis) e, abaixo, as execuções dos robôs.
 */
import React, { useState } from 'react';
import { ChevronDown, ChevronRight, RefreshCw, History } from 'lucide-react';
import type { BotRunRow, RunRow } from '@/lib/wa-agents/types';
import { useWaAgentsList, useWaBotRuns, useWaBotsList, useWaRuns } from './useWaAgents';
import { BTN_SMALL, Badge, EmptyState, INPUT_CLASS, Notice, Spinner, errorMessage, formatDateTime } from './ui';

const TRIGGER_LABELS: Record<string, string> = {
  inbound: 'Mensagem recebida',
  resume: 'Retomada',
  manual_start: 'Início manual',
  handoff: 'Passagem',
  approval: 'Aprovação',
  bot: 'Robô',
  test: 'Teste',
};

const STATUS_LABELS: Record<string, { label: string; tone: 'green' | 'amber' | 'red' | 'slate' | 'blue' }> = {
  ok: { label: 'OK', tone: 'green' },
  skipped: { label: 'Ignorada', tone: 'amber' },
  error: { label: 'Erro', tone: 'red' },
};

const BOT_STATUS_LABELS: Record<string, { label: string; tone: 'green' | 'amber' | 'red' | 'slate' | 'blue' }> = {
  running: { label: 'Executando', tone: 'blue' },
  waiting_reply: { label: 'Aguardando resposta', tone: 'amber' },
  done: { label: 'Concluída', tone: 'green' },
  error: { label: 'Erro', tone: 'red' },
  cancelled: { label: 'Cancelada', tone: 'slate' },
};

const PAGE_SIZE = 50;

function str(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function tokensOf(usage: unknown): string {
  if (!usage || typeof usage !== 'object') return '';
  const u = usage as Record<string, unknown>;
  const num = (k: string) => (typeof u[k] === 'number' ? (u[k] as number) : null);
  const input = num('inputTokens') ?? num('promptTokens');
  const output = num('outputTokens') ?? num('completionTokens');
  const total = num('totalTokens') ?? (input !== null && output !== null ? input + output : null);
  if (total === null) return '';
  return input !== null && output !== null ? `${total} (${input}+${output})` : String(total);
}

function JsonBlock({ title, value }: { title: string; value: unknown }) {
  const empty = value === null || value === undefined || (Array.isArray(value) && value.length === 0);
  if (empty) return null;
  return (
    <div>
      <p className="text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">{title}</p>
      <pre className="max-h-64 overflow-auto rounded-md bg-slate-900 text-slate-100 p-2 text-[11px] whitespace-pre-wrap break-words">
        {typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

const TH = 'px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 whitespace-nowrap';
const TD = 'px-3 py-2 text-xs text-slate-700 dark:text-slate-200 align-top';

function AgentRunsTable({ runs, agents }: { runs: RunRow[]; agents: Record<string, string> }) {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-50 dark:bg-slate-950/60">
          <tr>
            <th className={TH} aria-label="Detalhes" />
            <th className={TH}>Data</th>
            <th className={TH}>Agente</th>
            <th className={TH}>Gatilho</th>
            <th className={TH}>Status</th>
            <th className={TH}>Motivo</th>
            <th className={TH}>Entrada</th>
            <th className={TH}>Resposta</th>
            <th className={TH}>Modelo</th>
            <th className={TH}>Tokens</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-white/5">
          {runs.map((run) => {
            const id = String(run.id);
            const open = openId === id;
            const status = STATUS_LABELS[str(run.status)] ?? { label: str(run.status), tone: 'slate' as const };
            const agentName = run.agent_id ? agents[run.agent_id] ?? 'Agente removido' : '';
            return (
              <React.Fragment key={id}>
                <tr className="hover:bg-slate-50 dark:hover:bg-white/5">
                  <td className={TD}>
                    <button
                      type="button"
                      className="p-1 rounded text-slate-500 hover:text-slate-800 dark:hover:text-white"
                      aria-label={open ? 'Ocultar detalhes' : 'Ver detalhes'}
                      aria-expanded={open}
                      onClick={() => setOpenId(open ? null : id)}
                    >
                      {open ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
                    </button>
                  </td>
                  <td className={`${TD} whitespace-nowrap`}>{formatDateTime(str(run.created_at))}</td>
                  <td className={TD}>{agentName}</td>
                  <td className={`${TD} whitespace-nowrap`}>{TRIGGER_LABELS[str(run.trigger)] ?? str(run.trigger)}</td>
                  <td className={TD}>
                    <Badge tone={status.tone}>{status.label}</Badge>
                  </td>
                  <td className={TD}>{truncate(str(run.reason), 60)}</td>
                  <td className={`${TD} max-w-[220px]`}>{truncate(str(run.input_text), 80)}</td>
                  <td className={`${TD} max-w-[260px]`}>{truncate(str(run.output_text), 100)}</td>
                  <td className={`${TD} font-mono whitespace-nowrap`}>{str(run.model)}</td>
                  <td className={`${TD} whitespace-nowrap`}>{tokensOf(run.usage)}</td>
                </tr>
                {open ? (
                  <tr className="bg-slate-50 dark:bg-slate-950/40">
                    <td colSpan={10} className="px-4 py-3">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="space-y-2 text-xs text-slate-600 dark:text-slate-300">
                          <p>
                            <span className="font-semibold">Conversa:</span>{' '}
                            <span className="font-mono">{str(run.conversation_id) || 'nenhuma'}</span>
                          </p>
                          <p>
                            <span className="font-semibold">Duração:</span>{' '}
                            {run.duration_ms !== null && run.duration_ms !== undefined ? `${str(run.duration_ms)} ms` : 'n/d'}
                          </p>
                          {str(run.reason) ? (
                            <p>
                              <span className="font-semibold">Motivo:</span> {str(run.reason)}
                            </p>
                          ) : null}
                          {str(run.error) ? (
                            <div className="rounded-md border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-900/15 p-2 text-red-700 dark:text-red-300 whitespace-pre-wrap break-words">
                              {str(run.error)}
                            </div>
                          ) : null}
                          <JsonBlock title="Entrada" value={str(run.input_text) || null} />
                          <JsonBlock title="Resposta" value={str(run.output_text) || null} />
                        </div>
                        <div className="space-y-2">
                          <JsonBlock title="Ferramentas chamadas" value={run.tool_calls} />
                          <JsonBlock title="Eventos" value={run.events} />
                          <JsonBlock title="Uso" value={run.usage} />
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : null}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function BotRunsTable({ runs, bots }: { runs: BotRunRow[]; bots: Record<string, string> }) {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-50 dark:bg-slate-950/60">
          <tr>
            <th className={TH} aria-label="Detalhes" />
            <th className={TH}>Data</th>
            <th className={TH}>Robô</th>
            <th className={TH}>Telefone</th>
            <th className={TH}>Status</th>
            <th className={TH}>Passo</th>
            <th className={TH}>Próxima ação</th>
            <th className={TH}>Erro</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-white/5">
          {runs.map((run) => {
            const id = String(run.id);
            const open = openId === id;
            const status = BOT_STATUS_LABELS[str(run.status)] ?? { label: str(run.status), tone: 'slate' as const };
            const botName = run.bot_id ? bots[String(run.bot_id)] ?? 'Robô removido' : '';
            return (
              <React.Fragment key={id}>
                <tr className="hover:bg-slate-50 dark:hover:bg-white/5">
                  <td className={TD}>
                    <button
                      type="button"
                      className="p-1 rounded text-slate-500 hover:text-slate-800 dark:hover:text-white"
                      aria-label={open ? 'Ocultar detalhes' : 'Ver detalhes'}
                      aria-expanded={open}
                      onClick={() => setOpenId(open ? null : id)}
                    >
                      {open ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
                    </button>
                  </td>
                  <td className={`${TD} whitespace-nowrap`}>{formatDateTime(str(run.created_at))}</td>
                  <td className={TD}>{botName}</td>
                  <td className={`${TD} font-mono whitespace-nowrap`}>{str(run.phone)}</td>
                  <td className={TD}>
                    <Badge tone={status.tone}>{status.label}</Badge>
                  </td>
                  <td className={TD}>{run.step_index !== null && run.step_index !== undefined ? Number(run.step_index) + 1 : ''}</td>
                  <td className={`${TD} whitespace-nowrap`}>{formatDateTime(str(run.wake_at) || null)}</td>
                  <td className={`${TD} max-w-[240px] text-red-600 dark:text-red-400`}>{truncate(str(run.error), 80)}</td>
                </tr>
                {open ? (
                  <tr className="bg-slate-50 dark:bg-slate-950/40">
                    <td colSpan={8} className="px-4 py-3">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="space-y-2 text-xs text-slate-600 dark:text-slate-300">
                          <p>
                            <span className="font-semibold">Negócio:</span>{' '}
                            <span className="font-mono">{str(run.deal_id) || 'nenhum'}</span>
                          </p>
                          <p>
                            <span className="font-semibold">Contato:</span>{' '}
                            <span className="font-mono">{str(run.contact_id) || 'nenhum'}</span>
                          </p>
                          <p>
                            <span className="font-semibold">Conversa:</span>{' '}
                            <span className="font-mono">{str(run.conversation_id) || 'nenhuma'}</span>
                          </p>
                          <p>
                            <span className="font-semibold">Atualizada:</span> {formatDateTime(str(run.updated_at) || null)}
                          </p>
                          {str(run.error) ? (
                            <div className="rounded-md border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-900/15 p-2 text-red-700 dark:text-red-300 whitespace-pre-wrap break-words">
                              {str(run.error)}
                            </div>
                          ) : null}
                          <JsonBlock title="Variáveis" value={run.vars} />
                        </div>
                        <JsonBlock title="Registro dos passos" value={run.log} />
                      </div>
                    </td>
                  </tr>
                ) : null}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Componente React `RunsList`.
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export const RunsList: React.FC = () => {
  const agentsQ = useWaAgentsList();
  const botsQ = useWaBotsList();
  const [agentId, setAgentId] = useState('');
  const [before, setBefore] = useState<string | undefined>(undefined);
  const [botId, setBotId] = useState('');

  const runsQ = useWaRuns({ agentId: agentId || undefined, limit: PAGE_SIZE, before });
  const botRunsQ = useWaBotRuns(botId || null, PAGE_SIZE);

  const runs = runsQ.data?.runs ?? [];
  const oldest = runs.length > 0 ? str(runs[runs.length - 1].created_at) : '';

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">Execuções dos agentes</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Cada vez que um agente foi acionado: o que entrou, o que respondeu e as ferramentas usadas.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <label htmlFor="runs-agent-filter" className="sr-only">
              Filtrar por agente
            </label>
            <select
              id="runs-agent-filter"
              className={`${INPUT_CLASS} w-auto min-w-[180px]`}
              value={agentId}
              onChange={(e) => {
                setAgentId(e.target.value);
                setBefore(undefined);
              }}
            >
              <option value="">Todos os agentes</option>
              {(agentsQ.data ?? []).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className={BTN_SMALL}
              onClick={() => void runsQ.refetch()}
              disabled={runsQ.isFetching}
              aria-label="Atualizar execuções dos agentes"
            >
              <RefreshCw size={14} className={runsQ.isFetching ? 'animate-spin' : ''} aria-hidden="true" />
              Atualizar
            </button>
          </div>
        </div>

        {runsQ.isLoading ? (
          <Spinner label="Carregando execuções..." />
        ) : runsQ.error ? (
          <Notice tone="red">{errorMessage(runsQ.error, 'Falha ao carregar as execuções')}</Notice>
        ) : runs.length === 0 ? (
          <EmptyState
            icon={<History size={22} aria-hidden="true" />}
            title={before ? 'Não há execuções mais antigas' : 'Nenhuma execução ainda'}
            description={before ? undefined : 'As execuções aparecem aqui assim que um agente responder uma conversa.'}
            action={
              before ? (
                <button type="button" className={BTN_SMALL} onClick={() => setBefore(undefined)}>
                  Voltar às mais recentes
                </button>
              ) : undefined
            }
          />
        ) : (
          <>
            <AgentRunsTable runs={runs} agents={runsQ.data?.agents ?? {}} />
            <div className="flex items-center gap-2 flex-wrap">
              {before ? (
                <button type="button" className={BTN_SMALL} onClick={() => setBefore(undefined)}>
                  Voltar às mais recentes
                </button>
              ) : null}
              {runs.length >= PAGE_SIZE && oldest ? (
                <button type="button" className={BTN_SMALL} onClick={() => setBefore(oldest)}>
                  Ver mais antigas
                </button>
              ) : null}
            </div>
          </>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">Execuções dos robôs</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Em que passo cada robô está, quando age de novo e o registro do que já fez.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <label htmlFor="runs-bot-filter" className="sr-only">
              Filtrar por robô
            </label>
            <select
              id="runs-bot-filter"
              className={`${INPUT_CLASS} w-auto min-w-[180px]`}
              value={botId}
              onChange={(e) => setBotId(e.target.value)}
            >
              <option value="">Todos os robôs</option>
              {(botsQ.data ?? []).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className={BTN_SMALL}
              onClick={() => void botRunsQ.refetch()}
              disabled={botRunsQ.isFetching}
              aria-label="Atualizar execuções dos robôs"
            >
              <RefreshCw size={14} className={botRunsQ.isFetching ? 'animate-spin' : ''} aria-hidden="true" />
              Atualizar
            </button>
          </div>
        </div>

        {botRunsQ.isLoading ? (
          <Spinner label="Carregando execuções dos robôs..." />
        ) : botRunsQ.error ? (
          <Notice tone="red">{errorMessage(botRunsQ.error, 'Falha ao carregar as execuções dos robôs')}</Notice>
        ) : (botRunsQ.data?.runs ?? []).length === 0 ? (
          <EmptyState title="Nenhuma execução de robô" description="Dispare um robô pelo gatilho ou pelo botão Testar." />
        ) : (
          <BotRunsTable runs={botRunsQ.data?.runs ?? []} bots={botRunsQ.data?.bots ?? {}} />
        )}
      </section>
    </div>
  );
};

export default RunsList;
