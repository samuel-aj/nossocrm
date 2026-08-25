'use client';

/**
 * Card "Versão beta: Agentes de IA e Robôs de atendimento".
 * Liga/desliga a beta da organização (só admin) e abre a aba Agentes.
 */
import React, { useState } from 'react';
import Link from 'next/link';
import { Bot, ArrowRight, Loader2 } from 'lucide-react';
import { useWaAgentsBeta } from '@/hooks/useWaAgentsBeta';
import { useToast } from '@/context/ToastContext';
import { Toggle, errorMessage } from './ui';

/**
 * Componente React `WaAgentsBetaCard`.
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export const WaAgentsBetaCard: React.FC = () => {
  const { enabled, isAdmin, isLoading, setEnabled } = useWaAgentsBeta();
  const { showToast } = useToast();
  const [saving, setSaving] = useState(false);

  const handleToggle = async (value: boolean) => {
    if (!isAdmin || saving) return;
    setSaving(true);
    try {
      await setEnabled(value);
      showToast(value ? 'Versão beta ligada. A aba Agentes já está disponível.' : 'Versão beta desligada.', 'success');
    } catch (err) {
      showToast(errorMessage(err, 'Falha ao alterar a versão beta'), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-slate-900 dark:text-white flex items-center gap-2">
            <span className="p-1.5 bg-purple-100 dark:bg-purple-900/20 rounded-lg text-purple-600 dark:text-purple-400">
              <Bot size={18} aria-hidden="true" />
            </span>
            Versão beta: Agentes de IA e Robôs de atendimento
            <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
              BETA
            </span>
          </h2>
          <p className="text-sm text-slate-600 dark:text-slate-300 mt-2">
            Agentes de IA que respondem sozinhos no WhatsApp (pré-atendimento, qualificação e passagem para a equipe)
            e robôs de mensagens automáticas por etapa do funil, tudo dentro do NossoCRM.
          </p>
          <p className="text-sm text-slate-600 dark:text-slate-300 mt-2">
            Ligar mostra a aba Agentes em Configurações e ativa o atendimento automático nos números configurados.
            Desligar volta tudo ao normal, sem apagar as configurações.
          </p>
          {!isAdmin && !isLoading ? (
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
              Apenas administradores podem ligar ou desligar a versão beta.
            </p>
          ) : null}
          {enabled ? (
            <Link
              href="/settings/agentes"
              className="inline-flex items-center gap-1.5 mt-3 text-sm font-medium text-purple-600 dark:text-purple-400 hover:underline"
            >
              Abrir Agentes
              <ArrowRight size={14} aria-hidden="true" />
            </Link>
          ) : null}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {isLoading || saving ? <Loader2 size={16} className="animate-spin text-slate-400" aria-hidden="true" /> : null}
          <Toggle
            checked={enabled}
            onChange={(v) => void handleToggle(v)}
            disabled={!isAdmin || isLoading || saving}
            label="Ligar a versão beta de Agentes de IA e Robôs"
          />
        </div>
      </div>
    </div>
  );
};

export default WaAgentsBetaCard;
