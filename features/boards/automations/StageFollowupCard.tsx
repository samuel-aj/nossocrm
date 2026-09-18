'use client';

/**
 * Modo Automatizar: follow-up por inatividade da etapa como um card da coluna,
 * abaixo das automações de entrada. Clicar abre a mesma configuração da janela
 * da etapa (tempo sem mensagem do lead + robô ou mensagem).
 */
import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Clock, Plus } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { StageFollowupSection } from '@/features/boards/components/Modals/StageFollowupSection';

type Rule = { enabled: boolean; delay_seconds: number; action_type: 'bot' | 'message' };

function delayLabel(seconds: number): string {
  if (seconds % 86400 === 0) return `${seconds / 86400} dia${seconds === 86400 ? '' : 's'}`;
  if (seconds % 3600 === 0) return `${seconds / 3600} h`;
  return `${Math.round(seconds / 60)} min`;
}

export function StageFollowupCard({ stageId, stageLabel }: { stageId: string; stageLabel: string }) {
  const [open, setOpen] = useState(false);
  // mesma chave da seção de configuração: salvar lá atualiza o card aqui
  const q = useQuery<{ rule: Rule | null; stats: { pending: number } | null; pendingMigration?: boolean }>({
    queryKey: ['stageFollowup', stageId],
    queryFn: async () => {
      const res = await fetch(`/api/wa-agents/stage-followups/${stageId}`, { credentials: 'include' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error || `HTTP ${res.status}`);
      return body;
    },
    retry: false,
    staleTime: 30_000,
  });
  const rule = q.data?.rule ?? null;

  return (
    <div className="space-y-2 pt-2" aria-label="Follow-up por inatividade">
      <p className="flex items-center gap-1.5 px-1 text-[10px] font-bold uppercase tracking-wider text-primary-700 dark:text-primary-300">
        <Clock size={11} aria-hidden="true" /> Sem resposta do lead
      </p>
      {rule ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          title="Editar o follow-up por inatividade"
          className={`w-full text-left rounded-xl border bg-white dark:bg-dark-card p-3 shadow-sm transition-all hover:shadow-md hover:border-primary-300 dark:hover:border-primary-500/40 focus-visible-ring ${
            rule.enabled ? 'border-slate-200 dark:border-white/10' : 'border-dashed border-slate-300 dark:border-white/15 opacity-70'
          }`}
        >
          <span className="flex items-start gap-2">
            <span className="mt-0.5 p-1.5 rounded-lg bg-primary-500/10 text-primary-600 dark:text-primary-400 shrink-0">
              <Clock size={14} aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold leading-snug text-slate-900 dark:text-white">Follow-up por inatividade</span>
              <span className="block mt-0.5 text-xs leading-snug text-slate-500 dark:text-slate-400">
                Após {delayLabel(rule.delay_seconds)} sem mensagem: {rule.action_type === 'bot' ? 'executa um robô' : 'envia uma mensagem'}
              </span>
            </span>
          </span>
          <span className="mt-2 pl-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider">
            <span className={`w-1.5 h-1.5 rounded-full ${rule.enabled ? 'bg-emerald-500' : 'bg-slate-400'}`} aria-hidden="true" />
            <span className={rule.enabled ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400'}>
              {rule.enabled ? 'Ativo' : 'Desativado'}
            </span>
            <span className="text-slate-300 dark:text-slate-600">·</span>
            <span className="text-slate-400 dark:text-slate-500 normal-case tracking-normal font-medium">
              {rule.enabled && q.data?.stats ? `${q.data.stats.pending} lead(s) aguardando` : 'uma vez por lead'}
            </span>
          </span>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          disabled={q.isLoading}
          className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-slate-300 dark:border-white/15 px-3 py-3 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:border-primary-400 hover:text-primary-700 dark:hover:border-primary-500/60 dark:hover:text-primary-300 hover:bg-primary-50/50 dark:hover:bg-primary-500/5 transition-colors focus-visible-ring disabled:opacity-60"
        >
          <Plus size={14} aria-hidden="true" /> {q.isLoading ? 'Carregando...' : 'Follow-up por inatividade'}
        </button>
      )}

      {open ? (
        <Modal isOpen onClose={() => setOpen(false)} title={`Follow-up: ${stageLabel}`} size="lg">
          <StageFollowupSection stageId={stageId} stageSaved />
        </Modal>
      ) : null}
    </div>
  );
}

export default StageFollowupCard;
