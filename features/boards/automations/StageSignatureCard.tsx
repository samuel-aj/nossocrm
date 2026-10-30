'use client';

/**
 * Modo Automatizar: "ao entrar nesta etapa, prepara o contrato e pede
 * conferência antes de enviar" (ZapSign) como um card da coluna. Clicar abre a mesma configuração da
 * janela da etapa.
 */
import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileSignature, Plus } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { StageSignatureSection } from '@/features/boards/components/Modals/StageSignatureSection';

type Rule = { enabled: boolean; template_name: string | null; signer?: { send?: string } | null };
type Stats = { review?: number; pending: number; signed: number };

export function StageSignatureCard({ stageId, stageLabel }: { stageId: string; stageLabel: string }) {
  const [open, setOpen] = useState(false);
  const q = useQuery<{ rule: Rule | null; stats: Stats | null; connected?: boolean; pendingMigration?: boolean }>({
    queryKey: ['stageSignature', stageId],
    queryFn: async () => {
      const res = await fetch(`/api/integrations/zapsign/stage-rules/${stageId}`, { credentials: 'include' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error || `HTTP ${res.status}`);
      return body;
    },
    retry: false,
    staleTime: 30_000,
  });
  const rule = q.data?.rule ?? null;
  // Só aparece com a ZapSign conectada na organização (nada de contrato antes disso)
  if (!q.data?.connected || q.data.pendingMigration) return null;

  return (
    <div className="space-y-2 pt-2" aria-label="Assinatura eletrônica">
      <p className="flex items-center gap-1.5 px-1 text-[10px] font-bold uppercase tracking-wider text-primary-700 dark:text-primary-300">
        <FileSignature size={11} aria-hidden="true" /> Contrato ao entrar
      </p>
      {rule ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          title="Editar o envio para assinatura"
          className={`w-full text-left rounded-xl border bg-white dark:bg-dark-card p-3 shadow-sm transition-all hover:shadow-md hover:border-primary-300 dark:hover:border-primary-500/40 focus-visible-ring ${
            rule.enabled ? 'border-slate-200 dark:border-white/10' : 'border-dashed border-slate-300 dark:border-white/15 opacity-70'
          }`}
        >
          <span className="flex items-start gap-2">
            <span className="mt-0.5 p-1.5 rounded-lg bg-primary-500/10 text-primary-600 dark:text-primary-400 shrink-0">
              <FileSignature size={14} aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold leading-snug text-slate-900 dark:text-white">Conferir e enviar para assinatura</span>
              <span className="block mt-0.5 text-xs leading-snug text-slate-500 dark:text-slate-400 truncate">
                {rule.template_name || 'Modelo da ZapSign'}
                {rule.signer?.send === 'crm_whatsapp' || !rule.signer?.send ? ' · link pelo WhatsApp do CRM' : rule.signer.send === 'zapsign_whatsapp' ? ' · WhatsApp da ZapSign' : rule.signer.send === 'zapsign_email' ? ' · e-mail da ZapSign' : ' · só gera o link'}
              </span>
            </span>
          </span>
          <span className="mt-2 pl-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider">
            <span className={`w-1.5 h-1.5 rounded-full ${rule.enabled ? 'bg-emerald-500' : 'bg-slate-400'}`} aria-hidden="true" />
            <span className={rule.enabled ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400'}>{rule.enabled ? 'Ativo' : 'Desativado'}</span>
            {q.data?.stats ? (
              <>
                <span className="text-slate-300 dark:text-slate-600">·</span>
                <span className="text-slate-400 dark:text-slate-500 normal-case tracking-normal font-medium">
                  {q.data.stats.review ? `${q.data.stats.review} a conferir, ` : ''}{q.data.stats.pending} aguardando, {q.data.stats.signed} assinado(s)
                </span>
              </>
            ) : null}
          </span>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          disabled={q.isLoading}
          className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-slate-300 dark:border-white/15 px-3 py-3 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:border-primary-400 hover:text-primary-700 dark:hover:border-primary-500/60 dark:hover:text-primary-300 hover:bg-primary-50/50 dark:hover:bg-primary-500/5 transition-colors focus-visible-ring disabled:opacity-60"
        >
          <Plus size={14} aria-hidden="true" /> {q.isLoading ? 'Carregando...' : 'Enviar contrato para assinatura'}
        </button>
      )}

      {open ? (
        <Modal isOpen onClose={() => setOpen(false)} title={`Assinatura: ${stageLabel}`} size="xl">
          <StageSignatureSection stageId={stageId} stageSaved />
        </Modal>
      ) : null}
    </div>
  );
}

export default StageSignatureCard;
