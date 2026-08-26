'use client';

/**
 * "Ajustar com IA": no painel de teste, você descreve o que o agente fez de
 * errado e a IA reescreve o roteiro aplicando a correção (POST assist, modo
 * 'adjust', com as últimas mensagens do teste como exemplo). Antes de
 * substituir, mostra o resumo do que mudou (linhas, caracteres) e a
 * diferença linha a linha; só troca o roteiro depois de confirmar.
 */
import React, { useState } from 'react';
import { Loader2, Sparkles, X, Check, ChevronDown, ChevronUp, TriangleAlert } from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import type { AgentProvider } from '@/lib/wa-agents/types';
import { useWaAgentAssist, type WaTestMessage } from './useWaAgents';
import { describeDiff, diffLines, type DiffOp, type PromptDiff } from './promptDiff';
import { BTN_PRIMARY, BTN_SMALL, HELP_CLASS, Notice, TEXTAREA_CLASS, errorMessage } from './ui';

export type AgentAssistPanelProps = {
  provider: AgentProvider;
  model: string;
  /** Roteiro atual do formulário (o que será ajustado) */
  currentPrompt: string;
  /** Últimas mensagens do chat de teste (contexto do ajuste) */
  examples: WaTestMessage[];
  /** Aplica o novo roteiro no formulário (nada é salvo no servidor) */
  onApply: (systemPrompt: string) => void;
};

/** Quantas mensagens do teste vão junto com o pedido. */
export const ASSIST_EXAMPLES_LIMIT = 10;

type Proposal = { base: string; prompt: string; diff: PromptDiff; feedback: string };

type DiffRow = DiffOp | { type: 'skip'; count: number };

/** Mantém só as linhas mudadas com até `context` linhas iguais ao redor; o resto vira "N linhas iguais". */
export function compactDiff(ops: DiffOp[], context = 2): DiffRow[] {
  const keep = new Array<boolean>(ops.length).fill(false);
  ops.forEach((op, i) => {
    if (op.type === 'same') return;
    for (let j = Math.max(0, i - context); j <= Math.min(ops.length - 1, i + context); j++) keep[j] = true;
  });
  const rows: DiffRow[] = [];
  let skipped = 0;
  ops.forEach((op, i) => {
    if (keep[i]) {
      if (skipped > 0) {
        rows.push({ type: 'skip', count: skipped });
        skipped = 0;
      }
      rows.push(op);
    } else {
      skipped++;
    }
  });
  if (skipped > 0) rows.push({ type: 'skip', count: skipped });
  return rows;
}

function DiffView({ diff }: { diff: PromptDiff }) {
  const rows = compactDiff(diff.ops);
  return (
    <pre
      className="max-h-72 overflow-auto rounded-md bg-slate-900 text-slate-100 p-2 text-[11px] leading-relaxed whitespace-pre-wrap break-words"
      aria-label="Diferenças entre o roteiro atual e o sugerido"
    >
      {rows.map((row, i) =>
        row.type === 'skip' ? (
          <div key={i} className="text-slate-500 italic">
            ... {row.count} {row.count === 1 ? 'linha igual' : 'linhas iguais'} ...
          </div>
        ) : (
          <div
            key={i}
            className={
              row.type === 'add'
                ? 'bg-green-900/50 text-green-200'
                : row.type === 'del'
                  ? 'bg-red-900/50 text-red-200'
                  : 'text-slate-400'
            }
          >
            <span className="select-none inline-block w-4 text-center">{row.type === 'add' ? '+' : row.type === 'del' ? '-' : ' '}</span>
            {row.text || ' '}
          </div>
        )
      )}
    </pre>
  );
}

/**
 * Componente React `AgentAssistPanel`.
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export const AgentAssistPanel: React.FC<AgentAssistPanelProps> = ({ provider, model, currentPrompt, examples, onApply }) => {
  const { showToast } = useToast();
  const assist = useWaAgentAssist();

  const [feedback, setFeedback] = useState('');
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [showDiff, setShowDiff] = useState(false);
  // Último aviso também aqui no painel: o toast, no canto da tela, pode passar despercebido.
  const [notice, setNotice] = useState<{ tone: 'red' | 'amber'; text: string } | null>(null);

  const busy = assist.isPending;
  const recent = examples.slice(-ASSIST_EXAMPLES_LIMIT);

  const run = async () => {
    if (busy) return;
    const text = feedback.trim();
    if (!text) {
      showToast('Descreva o que o agente fez de errado', 'error');
      return;
    }
    if (!currentPrompt.trim()) {
      showToast('Não há roteiro para ajustar', 'error');
      return;
    }
    const modelId = model.trim();
    setNotice(null);
    try {
      const result = await assist.mutateAsync({
        mode: 'adjust',
        current_prompt: currentPrompt,
        feedback: text,
        // Mesmo texto no campo antigo, para servidores que ainda só leem `instruction`.
        instruction: text,
        examples: recent,
        // Sem modelo definido no formulário, o servidor usa o provedor/modelo da Central de I.A.
        ...(modelId ? { provider, model: modelId } : {}),
      });
      const next = result.system_prompt;
      if (!next.trim()) {
        const message = 'A IA não devolveu um roteiro. Tente descrever melhor o problema.';
        setNotice({ tone: 'red', text: message });
        showToast(message, 'error');
        return;
      }
      const diff = diffLines(currentPrompt, next);
      if (diff.added === 0 && diff.removed === 0) {
        const message = 'A IA não mudou nada no roteiro. Tente ser mais específico.';
        setNotice({ tone: 'amber', text: message });
        showToast(message, 'info');
        return;
      }
      setProposal({ base: currentPrompt, prompt: next, diff, feedback: text });
      setShowDiff(false);
      showToast('Sugestão pronta. Confira a diferença e confirme para substituir.', 'info');
    } catch (err) {
      const message = errorMessage(err, 'Falha ao ajustar o roteiro com IA');
      setNotice({ tone: 'red', text: message });
      showToast(message, 'error');
    }
  };

  const apply = () => {
    if (!proposal) return;
    onApply(proposal.prompt);
    setProposal(null);
    setFeedback('');
    setNotice(null);
    showToast('Roteiro substituído. Salve para valer no atendimento.', 'success');
  };

  const baseChanged = !!proposal && proposal.base !== currentPrompt;

  return (
    <div className="rounded-lg border border-purple-200 dark:border-purple-500/30 bg-purple-50/60 dark:bg-purple-900/10 p-3 space-y-3">
      <div className="flex items-center gap-2">
        <span className="p-1.5 bg-purple-100 dark:bg-purple-900/30 rounded-lg text-purple-600 dark:text-purple-400">
          <Sparkles size={16} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900 dark:text-white">Ajustar com IA</p>
          <p className={HELP_CLASS}>
            A IA reescreve o roteiro aplicando a correção e mantendo o resto igual. Nada é salvo até você clicar em
            Salvar.
          </p>
        </div>
      </div>

      <div>
        <label htmlFor="agent-assist-feedback" className="sr-only">
          O que o agente fez de errado?
        </label>
        <textarea
          id="agent-assist-feedback"
          className={TEXTAREA_CLASS}
          rows={3}
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          placeholder="O que o agente fez de errado? Ex.: ele se apresentou duas vezes; não quero que ofereça desconto"
          maxLength={4000}
          disabled={busy}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              void run();
            }
          }}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" className={BTN_PRIMARY} onClick={() => void run()} disabled={busy || !feedback.trim()}>
          {busy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Sparkles size={16} aria-hidden="true" />}
          Ajustar roteiro
        </button>
        <span className="text-[11px] text-slate-500 dark:text-slate-400">
          {recent.length > 0
            ? `Usa as últimas ${recent.length} ${recent.length === 1 ? 'mensagem' : 'mensagens'} do teste como exemplo. Ctrl+Enter envia.`
            : 'Converse no teste primeiro para a IA ver o erro no contexto. Ctrl+Enter envia.'}
        </span>
      </div>

      {busy ? (
        <p className={HELP_CLASS} role="status">
          Ajustando o roteiro... isso pode levar alguns segundos.
        </p>
      ) : null}

      {notice && !busy ? (
        <div role="alert">
          <Notice tone={notice.tone}>{notice.text}</Notice>
        </div>
      ) : null}

      {proposal ? (
        <Notice tone="blue">
          <div className="space-y-2">
            <p className="font-medium">Sugestão pronta. Substituir o roteiro atual?</p>
            <p className="text-xs">{describeDiff(proposal.diff)}</p>
            <p className="text-xs">
              <span className="font-medium">Pedido:</span> {proposal.feedback}
            </p>
            {baseChanged ? (
              <p className="text-xs flex items-start gap-1 text-amber-800 dark:text-amber-200">
                <TriangleAlert size={14} className="shrink-0 mt-0.5" aria-hidden="true" />
                O roteiro foi editado depois da sugestão. Ao substituir, essas edições se perdem.
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className={BTN_SMALL} onClick={() => setShowDiff((v) => !v)} aria-expanded={showDiff}>
                {showDiff ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
                {showDiff ? 'Ocultar diferenças' : 'Ver diferenças'}
              </button>
              <button type="button" className={`${BTN_SMALL} !bg-purple-600 !text-white !border-purple-600 hover:!bg-purple-700`} onClick={apply}>
                <Check size={14} aria-hidden="true" />
                Substituir roteiro
              </button>
              <button type="button" className={BTN_SMALL} onClick={() => setProposal(null)} aria-label="Descartar sugestão">
                <X size={14} aria-hidden="true" />
                Descartar
              </button>
            </div>
            {showDiff ? <DiffView diff={proposal.diff} /> : null}
          </div>
        </Notice>
      ) : null}
    </div>
  );
};

export default AgentAssistPanel;
