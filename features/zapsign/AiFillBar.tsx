'use client';

/**
 * Faixa da IA no preenchimento do contrato: lendo a conversa, quantos campos
 * ela preencheu (com o que leu) ou por que não deu, e o botão para preencher
 * de novo. As variáveis preenchidas ficam marcadas em VariableValueRows.
 */
import React from 'react';
import { AlertTriangle, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import type { SignatureDraft } from './useSignatureDraft';

export const AI_ORIGIN_LABEL: Record<string, string> = { conversa: 'Da conversa', ligacao: 'Da ligação', lead: 'Do lead' };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function usedText(used: { messages: number; audios: number; calls: number; notes: number }): string {
  const parts: string[] = [];
  if (used.messages) parts.push(plural(used.messages, 'mensagem', 'mensagens'));
  if (used.audios) parts.push(plural(used.audios, 'áudio transcrito', 'áudios transcritos'));
  if (used.calls) parts.push(plural(used.calls, 'ligação', 'ligações'));
  if (used.notes) parts.push(plural(used.notes, 'nota', 'notas'));
  return parts.length ? `Leu ${parts.join(', ')}.` : 'Não havia conversa, ligação nem nota para ler.';
}

const BTN = 'inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold text-primary-700 hover:bg-primary-100 dark:text-primary-200 dark:hover:bg-primary-500/20 focus-visible-ring disabled:opacity-50';

export function AiFillBar({ draft }: { draft: SignatureDraft }) {
  const { ai, runAi, variables } = draft;
  if (variables.length === 0) return null;
  const count = Object.keys(ai.applied).length;

  if (ai.status === 'running') {
    return (
      <div role="status" className="flex items-center gap-2 rounded-xl border border-primary-200 bg-primary-50/70 px-3 py-2 text-xs text-primary-800 dark:border-primary-500/30 dark:bg-primary-500/10 dark:text-primary-100">
        <Loader2 size={14} className="shrink-0 animate-spin" aria-hidden="true" />
        <span>A IA está lendo a conversa e as ligações para preencher o contrato...</span>
      </div>
    );
  }

  if (ai.status === 'error') {
    const noKey = ai.code === 'NO_AI_KEY' || ai.code === 'AI_FEATURE_DISABLED';
    return (
      <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-900/15 dark:text-amber-200">
        <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1">{noKey ? ai.error : `A IA não conseguiu preencher: ${ai.error}`}</span>
        {!noKey ? (
          <button type="button" onClick={() => void runAi(true)} className={BTN}>
            <RefreshCw size={11} aria-hidden="true" /> Tentar de novo
          </button>
        ) : null}
      </div>
    );
  }

  if (ai.status === 'done' && ai.result) {
    return (
      <div className="flex items-start gap-2 rounded-xl border border-primary-200 bg-primary-50/70 px-3 py-2 text-xs text-primary-900 dark:border-primary-500/30 dark:bg-primary-500/10 dark:text-primary-100">
        <Sparkles size={14} className="mt-0.5 shrink-0 text-primary-600 dark:text-primary-300" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <b>{count ? `A IA preencheu ${plural(count, 'campo', 'campos')}` : 'A IA não achou nada novo para este contrato'}</b>
          {count ? ' (marcados com IA). Confira antes de enviar.' : '.'}{' '}
          <span className="text-primary-700/80 dark:text-primary-200/80">{usedText(ai.result.used)}</span>
          {ai.result.notes.map((n) => (
            <span key={n} className="block text-[11px] text-amber-700 dark:text-amber-300">
              {n}
            </span>
          ))}
        </span>
        <button type="button" onClick={() => void runAi(true)} className={BTN} title="Ler de novo a conversa e as ligações">
          <RefreshCw size={11} aria-hidden="true" /> Preencher de novo
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-end">
      <button type="button" onClick={() => void runAi(false)} className={BTN}>
        <Sparkles size={12} aria-hidden="true" /> Preencher com IA
      </button>
    </div>
  );
}

export default AiFillBar;
