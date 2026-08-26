'use client';

/**
 * Painel lateral de teste do agente: o chat de teste em cima e a caixa
 * "Ajustar com IA" embaixo (feedback em texto -> roteiro reescrito, com
 * confirmação antes de substituir). Abre de qualquer aba do editor e fica
 * montado fechado para não perder a conversa.
 */
import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Loader2, Save, Sparkles } from 'lucide-react';
import type { AgentProvider } from '@/lib/wa-agents/types';
import { AgentTestChat } from './AgentTestChat';
import { AgentAssistPanel, ASSIST_EXAMPLES_LIMIT } from './AgentAssistPanel';
import type { WaTestMessage } from './useWaAgents';
import { BTN_SMALL, Drawer, Notice } from './ui';

/**
 * Componente React `AgentTestDrawer`.
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export const AgentTestDrawer: React.FC<{
  open: boolean;
  onClose: () => void;
  /** Agente salvo (null enquanto o agente novo não foi salvo) */
  agentId: string | null;
  agentName: string;
  provider: AgentProvider;
  model: string;
  /** Roteiro atual do formulário (base do ajuste com IA) */
  currentPrompt: string;
  /** Há alterações no formulário que ainda não foram salvas */
  dirty: boolean;
  saving: boolean;
  onSave: () => Promise<boolean>;
  /** Aplica o roteiro ajustado no formulário */
  onApplyPrompt: (prompt: string) => void;
}> = ({ open, onClose, agentId, agentName, provider, model, currentPrompt, dirty, saving, onSave, onApplyPrompt }) => {
  const [messages, setMessages] = useState<WaTestMessage[]>([]);
  const [assistOpen, setAssistOpen] = useState(true);

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={`Testar: ${agentName || 'agente'}`}
      description="Converse como o lead. Depois, conte para a IA o que o agente errou e ajuste o roteiro."
    >
      {dirty ? (
        <div className="px-4 pt-3">
          <Notice tone="amber">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>Há alterações não salvas. O teste usa a última versão salva.</span>
              <button type="button" className={BTN_SMALL} onClick={() => void onSave()} disabled={saving}>
                {saving ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Save size={14} aria-hidden="true" />}
                Salvar
              </button>
            </div>
          </Notice>
        </div>
      ) : null}

      <div className="flex-1 min-h-0 flex flex-col px-4 pt-3 pb-2">
        {agentId ? (
          <AgentTestChat agentId={agentId} agentName={agentName} className="flex-1 min-h-0" onMessagesChange={setMessages} />
        ) : (
          <Notice tone="amber">Salve o agente para liberar o teste.</Notice>
        )}
      </div>

      <div className="border-t border-slate-200 dark:border-white/10">
        <button
          type="button"
          className="w-full flex items-center justify-between gap-2 px-4 py-2.5 text-sm font-semibold text-slate-900 dark:text-white hover:bg-slate-50 dark:hover:bg-white/5"
          aria-expanded={assistOpen}
          aria-controls="agent-assist-body"
          onClick={() => setAssistOpen((v) => !v)}
        >
          <span className="inline-flex items-center gap-2">
            <Sparkles size={16} className="text-purple-600 dark:text-purple-400" aria-hidden="true" />
            Ajustar com IA
          </span>
          {assistOpen ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronUp size={16} aria-hidden="true" />}
        </button>
        {assistOpen ? (
          <div id="agent-assist-body" className="px-4 pb-4 max-h-[50vh] overflow-y-auto">
            <AgentAssistPanel
              provider={provider}
              model={model}
              currentPrompt={currentPrompt}
              examples={messages.slice(-ASSIST_EXAMPLES_LIMIT)}
              onApply={onApplyPrompt}
            />
          </div>
        ) : null}
      </div>
    </Drawer>
  );
};

export default AgentTestDrawer;
