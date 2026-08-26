'use client';

/**
 * "Criar com IA" no topo do roteiro: gera um roteiro do zero a partir de uma
 * descrição, melhora o roteiro atual ou aplica um ajuste pedido em texto.
 * Chama POST /api/wa-agents/assist com o provedor/modelo do formulário.
 *
 * Regras de aplicação:
 * - roteiro existente só é substituído depois de confirmação;
 * - persona, resultados e ações durante a conversa só são preenchidos quando
 *   estão vazios; senão o painel oferece "Adicionar sugestões" (merge por chave,
 *   sem duplicar).
 */
import React, { useState } from 'react';
import { Loader2, Plus, Sparkles, X } from 'lucide-react';
import ConfirmModal from '@/components/ConfirmModal';
import { useToast } from '@/context/ToastContext';
import type { AgentProvider, CustomAction, Outcome } from '@/lib/wa-agents/types';
import { useWaAgentAssist, type WaAssistMode, type WaAssistResult, type WaAssistSuggestion } from './useWaAgents';
import { slugifyKey } from './OutcomesEditor';
import { BTN_PRIMARY, BTN_SECONDARY, BTN_SMALL, HELP_CLASS, INPUT_CLASS, Notice, TEXTAREA_CLASS, errorMessage } from './ui';

/** Campos do formulário que o painel pode preencher. */
export type AgentAssistPatch = {
  persona_name?: string;
  system_prompt?: string;
  outcomes?: Outcome[];
  custom_actions?: CustomAction[];
};

export type AgentAssistPanelProps = {
  provider: AgentProvider;
  model: string;
  personaName: string;
  currentPrompt: string;
  outcomes: Outcome[];
  customActions: CustomAction[];
  onApply: (patch: AgentAssistPatch) => void;
};

const MODE_DONE_TOAST: Record<WaAssistMode, string> = {
  generate: 'Roteiro gerado',
  improve: 'Roteiro melhorado',
  adjust: 'Ajuste aplicado',
};

const MODE_PENDING_TOAST: Record<WaAssistMode, string> = {
  generate: 'Roteiro gerado. Confirme para substituir o atual.',
  improve: 'Roteiro melhorado. Confirme para substituir o atual.',
  adjust: 'Ajuste pronto. Confirme para substituir o roteiro atual.',
};

/** Normaliza as sugestões da IA: chave válida (gerada do nome se preciso), sem repetidas, sem vazias. */
function normalizeSuggestions(list: WaAssistSuggestion[]): WaAssistSuggestion[] {
  const seen = new Set<string>();
  const out: WaAssistSuggestion[] = [];
  for (const s of list) {
    const label = String(s?.label ?? '').trim().slice(0, 80);
    const key = slugifyKey(String(s?.key ?? '').trim() || label);
    if (!key || !label || seen.has(key)) continue;
    seen.add(key);
    out.push({ key, label, description: String(s?.description ?? '').trim() });
  }
  return out;
}

function toOutcome(s: WaAssistSuggestion): Outcome {
  return { key: s.key, label: s.label, description: s.description.slice(0, 500), actions: [] };
}

function toCustomAction(s: WaAssistSuggestion): CustomAction {
  return { key: s.key, label: s.label, description: (s.description || s.label).slice(0, 600), actions: [] };
}

/** Sugestões cuja chave ainda não existe na lista atual. */
function onlyNew(suggestions: WaAssistSuggestion[], existing: Array<{ key: string }>): WaAssistSuggestion[] {
  return suggestions.filter((s) => !existing.some((e) => e.key === s.key));
}

/**
 * Componente React `AgentAssistPanel`.
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export const AgentAssistPanel: React.FC<AgentAssistPanelProps> = ({
  provider,
  model,
  personaName,
  currentPrompt,
  outcomes,
  customActions,
  onApply,
}) => {
  const { showToast } = useToast();
  const assist = useWaAgentAssist();

  const [description, setDescription] = useState('');
  const [instruction, setInstruction] = useState('');
  /** Resultado recebido enquanto o roteiro atual ainda não foi substituído (aguarda confirmação). */
  const [pending, setPending] = useState<{ mode: WaAssistMode; result: WaAssistResult } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  /** Sugestões (já normalizadas) que não foram aplicadas automaticamente por já haver itens no formulário. */
  const [suggestions, setSuggestions] = useState<WaAssistResult | null>(null);

  const hasPrompt = currentPrompt.trim().length > 0;
  const busy = assist.isPending;

  /** Aplica o resultado: roteiro (se pedido) e o que estiver vazio; guarda o restante como sugestão. */
  const applyResult = (result: WaAssistResult, replacePrompt: boolean) => {
    const outs = normalizeSuggestions(result.outcomes);
    const acts = normalizeSuggestions(result.custom_actions);
    const persona = result.persona_name.trim().slice(0, 80);

    const patch: AgentAssistPatch = {};
    if (replacePrompt && result.system_prompt.trim()) patch.system_prompt = result.system_prompt;
    if (!personaName.trim() && persona) patch.persona_name = persona;
    if (outcomes.length === 0 && outs.length > 0) patch.outcomes = outs.map(toOutcome);
    if (customActions.length === 0 && acts.length > 0) patch.custom_actions = acts.map(toCustomAction);
    if (Object.keys(patch).length > 0) onApply(patch);

    const leftoverOutcomes = outcomes.length === 0 ? [] : onlyNew(outs, outcomes);
    const leftoverActions = customActions.length === 0 ? [] : onlyNew(acts, customActions);
    setSuggestions(
      leftoverOutcomes.length > 0 || leftoverActions.length > 0
        ? { persona_name: persona, system_prompt: '', outcomes: leftoverOutcomes, custom_actions: leftoverActions }
        : null
    );
  };

  const run = async (mode: WaAssistMode) => {
    if (busy) return;
    if (mode === 'generate' && !description.trim()) {
      showToast('Descreva o atendimento antes de gerar o roteiro', 'error');
      return;
    }
    if (mode !== 'generate' && !hasPrompt) {
      showToast('Não há roteiro para melhorar. Gere um primeiro.', 'error');
      return;
    }
    if (mode === 'adjust' && !instruction.trim()) {
      showToast('Escreva o ajuste que você quer no roteiro', 'error');
      return;
    }
    const modelId = model.trim();
    try {
      const result = await assist.mutateAsync({
        mode,
        description: mode === 'generate' ? description.trim() : undefined,
        current_prompt: mode === 'generate' ? undefined : currentPrompt,
        instruction: mode === 'adjust' ? instruction.trim() : undefined,
        // Sem modelo definido no formulário, o servidor usa o provedor/modelo da Central de I.A.
        ...(modelId ? { provider, model: modelId } : {}),
      });
      if (!result.system_prompt.trim()) {
        showToast('A IA não devolveu um roteiro. Tente descrever melhor o atendimento.', 'error');
        return;
      }
      if (hasPrompt) {
        setPending({ mode, result });
        setConfirmOpen(true);
        showToast(MODE_PENDING_TOAST[mode], 'info');
      } else {
        applyResult(result, true);
        showToast(MODE_DONE_TOAST[mode], 'success');
        // O pedido de ajuste só é limpo depois de aplicado (ao confirmar, fica no campo).
        if (mode === 'adjust') setInstruction('');
      }
    } catch (err) {
      showToast(errorMessage(err, 'Falha ao gerar o roteiro com IA'), 'error');
    }
  };

  const confirmReplace = () => {
    if (!pending) return;
    applyResult(pending.result, true);
    showToast(`${MODE_DONE_TOAST[pending.mode]}: roteiro substituído`, 'success');
    if (pending.mode === 'adjust') setInstruction('');
    setPending(null);
  };

  const keepPromptOnlySuggestions = () => {
    if (!pending) return;
    applyResult(pending.result, false);
    showToast('Roteiro mantido; sugestões separadas', 'info');
    if (pending.mode === 'adjust') setInstruction('');
    setPending(null);
  };

  // Sugestões pendentes calculadas contra o formulário atual (o usuário pode ter editado depois).
  const newOutcomes = suggestions ? onlyNew(suggestions.outcomes, outcomes) : [];
  const newActions = suggestions ? onlyNew(suggestions.custom_actions, customActions) : [];
  const suggestPersona = !!suggestions?.persona_name && !personaName.trim();
  const hasSuggestions = newOutcomes.length > 0 || newActions.length > 0 || suggestPersona;

  const addSuggestions = () => {
    if (!suggestions) return;
    const patch: AgentAssistPatch = {};
    if (suggestPersona) patch.persona_name = suggestions.persona_name;
    if (newOutcomes.length > 0) patch.outcomes = [...outcomes, ...newOutcomes.map(toOutcome)];
    if (newActions.length > 0) patch.custom_actions = [...customActions, ...newActions.map(toCustomAction)];
    if (Object.keys(patch).length > 0) onApply(patch);
    setSuggestions(null);
    const parts: string[] = [];
    if (newOutcomes.length > 0) parts.push(`${newOutcomes.length} resultado(s)`);
    if (newActions.length > 0) parts.push(`${newActions.length} ação(ões)`);
    if (suggestPersona) parts.push('nome da persona');
    showToast(`Sugestões adicionadas: ${parts.join(', ')}`, 'success');
  };

  const suggestionSummary = [
    newOutcomes.length > 0 ? `${newOutcomes.length} resultado(s)` : '',
    newActions.length > 0 ? `${newActions.length} ação(ões) durante a conversa` : '',
    suggestPersona ? 'nome da persona' : '',
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <div className="rounded-lg border border-purple-200 dark:border-purple-500/30 bg-purple-50/60 dark:bg-purple-900/10 p-3 space-y-3">
      <div className="flex items-center gap-2">
        <span className="p-1.5 bg-purple-100 dark:bg-purple-900/30 rounded-lg text-purple-600 dark:text-purple-400">
          <Sparkles size={16} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900 dark:text-white">Criar com IA</p>
          <p className={HELP_CLASS}>
            Usa o provedor e o modelo da seção Modelo, com a chave da organização. Nada é salvo até você clicar em
            Salvar.
          </p>
        </div>
      </div>

      <div>
        <label htmlFor="agent-assist-description" className="sr-only">
          Descreva o atendimento
        </label>
        <textarea
          id="agent-assist-description"
          className={TEXTAREA_CLASS}
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Descreva o atendimento: área, quem é a persona, o que perguntar, quando encerrar e o que fazer"
          maxLength={4000}
          disabled={busy}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={BTN_PRIMARY} onClick={() => void run('generate')} disabled={busy}>
          {busy && assist.variables?.mode === 'generate' ? (
            <Loader2 size={16} className="animate-spin" aria-hidden="true" />
          ) : (
            <Sparkles size={16} aria-hidden="true" />
          )}
          Gerar roteiro com IA
        </button>
        {hasPrompt ? (
          <button type="button" className={BTN_SECONDARY} onClick={() => void run('improve')} disabled={busy}>
            {busy && assist.variables?.mode === 'improve' ? (
              <Loader2 size={16} className="animate-spin" aria-hidden="true" />
            ) : null}
            Melhorar roteiro
          </button>
        ) : null}
      </div>

      {hasPrompt ? (
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 items-center">
          <label htmlFor="agent-assist-instruction" className="sr-only">
            Ajuste que você quer no roteiro
          </label>
          <input
            id="agent-assist-instruction"
            className={INPUT_CLASS}
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder='Pedir ajuste. Ex.: "pergunte a cidade antes do caso" ou "fale de forma mais formal"'
            maxLength={2000}
            disabled={busy}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void run('adjust');
              }
            }}
          />
          <button type="button" className={BTN_SECONDARY} onClick={() => void run('adjust')} disabled={busy}>
            {busy && assist.variables?.mode === 'adjust' ? (
              <Loader2 size={16} className="animate-spin" aria-hidden="true" />
            ) : null}
            Pedir ajuste
          </button>
        </div>
      ) : null}

      {busy ? (
        <p className={HELP_CLASS} role="status">
          Gerando com IA... isso pode levar alguns segundos.
        </p>
      ) : null}

      {pending && !confirmOpen ? (
        <Notice tone="blue">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>Há um roteiro gerado que ainda não foi aplicado.</span>
            <span className="flex flex-wrap items-center gap-2">
              <button type="button" className={BTN_SMALL} onClick={() => setConfirmOpen(true)}>
                Substituir roteiro
              </button>
              <button type="button" className={BTN_SMALL} onClick={keepPromptOnlySuggestions}>
                Manter roteiro, só sugestões
              </button>
              <button
                type="button"
                className={BTN_SMALL}
                onClick={() => setPending(null)}
                aria-label="Descartar roteiro gerado"
              >
                <X size={14} aria-hidden="true" />
                Descartar
              </button>
            </span>
          </div>
        </Notice>
      ) : null}

      {hasSuggestions ? (
        <Notice tone="blue">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>A IA sugeriu {suggestionSummary} que ainda não estão no formulário.</span>
            <span className="flex items-center gap-2">
              <button type="button" className={BTN_SMALL} onClick={addSuggestions}>
                <Plus size={14} aria-hidden="true" />
                Adicionar sugestões
              </button>
              <button
                type="button"
                className={BTN_SMALL}
                onClick={() => setSuggestions(null)}
                aria-label="Ignorar sugestões"
              >
                <X size={14} aria-hidden="true" />
                Ignorar
              </button>
            </span>
          </div>
        </Notice>
      ) : null}

      <ConfirmModal
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={confirmReplace}
        title="Substituir o roteiro atual?"
        message="O texto do roteiro será trocado pelo gerado com IA. Você ainda pode editar antes de salvar. Nome da persona, resultados e ações durante a conversa só são preenchidos se estiverem vazios."
        confirmText="Substituir"
        cancelText="Agora não"
        variant="primary"
      />
    </div>
  );
};

export default AgentAssistPanel;
