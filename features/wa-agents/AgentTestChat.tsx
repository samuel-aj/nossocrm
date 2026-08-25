'use client';

/**
 * Chat de teste de um agente salvo. As mensagens ficam só no navegador;
 * a cada envio todo o histórico vai para POST /api/wa-agents/agents/[id]/test.
 * Nada é enviado ao WhatsApp e nenhuma ação é executada.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Send, Loader2, Eraser, Wrench } from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import { useTestWaAgent, type WaTestMessage } from './useWaAgents';
import { BTN_PRIMARY, BTN_SMALL, INPUT_CLASS, errorMessage, newId } from './ui';

type Entry = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  lines: string[];
  toolCalls: unknown[];
  usage: unknown;
};

function describeUsage(usage: unknown): string | null {
  if (!usage || typeof usage !== 'object') return null;
  const u = usage as Record<string, unknown>;
  const num = (k: string) => (typeof u[k] === 'number' ? (u[k] as number) : null);
  const input = num('inputTokens') ?? num('promptTokens');
  const output = num('outputTokens') ?? num('completionTokens');
  const total = num('totalTokens') ?? (input !== null && output !== null ? input + output : null);
  if (input === null && output === null && total === null) return null;
  const parts: string[] = [];
  if (input !== null) parts.push(`${input} entrada`);
  if (output !== null) parts.push(`${output} saída`);
  if (total !== null) parts.push(`${total} total`);
  return `Tokens: ${parts.join(', ')}`;
}

function toolName(call: unknown): string {
  if (call && typeof call === 'object') {
    const c = call as Record<string, unknown>;
    if (typeof c.toolName === 'string') return c.toolName;
    if (typeof c.name === 'string') return c.name;
  }
  return 'ferramenta';
}

function toolInput(call: unknown): unknown {
  if (call && typeof call === 'object') {
    const c = call as Record<string, unknown>;
    return c.input ?? c.args ?? null;
  }
  return null;
}

/** Junta os dados salvos por `salvar_dados` para reenviar como estado. */
function mergeSavedData(state: Record<string, unknown>, toolCalls: unknown[]): Record<string, unknown> {
  let next = state;
  for (const call of toolCalls) {
    if (toolName(call) !== 'salvar_dados') continue;
    const input = toolInput(call);
    if (input && typeof input === 'object') {
      const dados = (input as Record<string, unknown>).dados;
      if (dados && typeof dados === 'object') next = { ...next, ...(dados as Record<string, unknown>) };
    }
  }
  return next;
}

/**
 * Componente React `AgentTestChat`.
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export const AgentTestChat: React.FC<{ agentId: string; agentName?: string | null }> = ({ agentId, agentName }) => {
  const test = useTestWaAgent(agentId);
  const { showToast } = useToast();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [state, setState] = useState<Record<string, unknown>>({});
  const [text, setText] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [entries.length, test.isPending]);

  const send = async () => {
    const value = text.trim();
    if (!value || test.isPending) return;
    const userEntry: Entry = { id: newId(), role: 'user', text: value, lines: [value], toolCalls: [], usage: null };
    const history: WaTestMessage[] = [...entries, userEntry].map((e) => ({ role: e.role, text: e.text }));
    setEntries((prev) => [...prev, userEntry]);
    setText('');
    try {
      const result = await test.mutateAsync({ messages: history, state: Object.keys(state).length ? state : undefined });
      const lines = result.lines.length > 0 ? result.lines : result.text ? [result.text] : [];
      setEntries((prev) => [
        ...prev,
        {
          id: newId(),
          role: 'assistant',
          text: result.text,
          lines,
          toolCalls: result.toolCalls,
          usage: result.usage,
        },
      ]);
      setState((prev) => mergeSavedData(prev, result.toolCalls));
    } catch (err) {
      showToast(errorMessage(err, 'Falha ao testar o agente'), 'error');
    } finally {
      inputRef.current?.focus();
    }
  };

  const clear = () => {
    setEntries([]);
    setState({});
    setText('');
    inputRef.current?.focus();
  };

  return (
    <div className="flex flex-col h-[70vh] max-h-[640px]">
      <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-200 dark:border-white/10">
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Simulação com um lead fictício. Nada é enviado ao WhatsApp e nenhuma ação é executada.
        </p>
        <button type="button" className={BTN_SMALL} onClick={clear} disabled={entries.length === 0 && !text}>
          <Eraser size={14} aria-hidden="true" />
          Limpar
        </button>
      </div>

      <div className="flex-1 overflow-y-auto py-3 space-y-2 bg-slate-50 dark:bg-slate-950/40 rounded-lg px-3 my-2" role="log" aria-live="polite">
        {entries.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400 text-center py-8">
            Escreva como o lead escreveria e veja como {agentName || 'o agente'} responde.
          </p>
        ) : null}
        {entries.map((entry) =>
          entry.role === 'user' ? (
            <div key={entry.id} className="flex justify-end">
              <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-green-500 text-white px-3 py-2 text-sm whitespace-pre-wrap">
                {entry.text}
              </div>
            </div>
          ) : (
            <div key={entry.id} className="space-y-1">
              {entry.lines.length === 0 ? (
                <div className="flex justify-start">
                  <div className="max-w-[80%] rounded-2xl rounded-bl-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-white/10 px-3 py-2 text-xs italic text-slate-500 dark:text-slate-400">
                    (sem resposta)
                  </div>
                </div>
              ) : (
                entry.lines.map((line, i) => (
                  <div key={`${entry.id}-${i}`} className="flex justify-start">
                    <div className="max-w-[80%] rounded-2xl rounded-bl-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-white/10 px-3 py-2 text-sm text-slate-900 dark:text-white whitespace-pre-wrap">
                      {line}
                    </div>
                  </div>
                ))
              )}
              {entry.toolCalls.length > 0 ? (
                <div className="flex flex-wrap gap-1 pl-1">
                  {entry.toolCalls.map((call, i) => (
                    <details key={`${entry.id}-tool-${i}`} className="text-xs">
                      <summary className="cursor-pointer inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 font-medium select-none">
                        <Wrench size={11} aria-hidden="true" />
                        {toolName(call)}
                      </summary>
                      <pre className="mt-1 max-w-full overflow-x-auto rounded-md bg-slate-900 text-slate-100 p-2 text-[11px]">
                        {JSON.stringify(toolInput(call) ?? call, null, 2)}
                      </pre>
                    </details>
                  ))}
                </div>
              ) : null}
              {describeUsage(entry.usage) ? (
                <p className="pl-1 text-[11px] text-slate-400">{describeUsage(entry.usage)}</p>
              ) : null}
            </div>
          )
        )}
        {test.isPending ? (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-white/10 px-3 py-2 text-sm text-slate-500 inline-flex items-center gap-2">
              <Loader2 size={14} className="animate-spin" aria-hidden="true" />
              Pensando...
            </div>
          </div>
        ) : null}
        <div ref={endRef} />
      </div>

      <div className="flex items-end gap-2 pt-2 border-t border-slate-200 dark:border-white/10">
        <textarea
          ref={inputRef}
          className={`${INPUT_CLASS} resize-none`}
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder="Escreva como o lead (Enter envia, Shift+Enter quebra linha)"
          aria-label="Mensagem de teste"
          disabled={test.isPending}
        />
        <button
          type="button"
          className={BTN_PRIMARY}
          onClick={() => void send()}
          disabled={test.isPending || !text.trim()}
          aria-label="Enviar mensagem de teste"
        >
          {test.isPending ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Send size={16} aria-hidden="true" />}
          Enviar
        </button>
      </div>
    </div>
  );
};

export default AgentTestChat;
