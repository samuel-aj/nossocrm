'use client';

/**
 * Conferência do contrato ao mover um lead para uma etapa com "contrato ao
 * entrar" (ZapSign). O movimento (useMoveDeal) pede por aqui; o modal mostra o
 * que vai no documento, a pessoa ajusta e decide: mover e enviar, mover sem
 * enviar (o contrato fica aguardando na aba Contrato) ou cancelar (o lead não
 * sai do lugar). Nenhum contrato sai sem essa confirmação.
 */
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, CheckCircle2, FileSignature, Loader2, Send } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { invalidateLeadHistory } from '@/features/deals/lead/leadHistoryInvalidation';
import { dealHistoryKey } from '@/features/deals/lead/useDealHistory';
import type { Deal } from '@/types';
import { SignatureReviewContext, type SignatureReviewRequest, type SignatureReviewResult } from './SignatureReviewContext';
import { SignatureFields } from './SignatureFields';
import { useSignatureDraft } from './useSignatureDraft';
import { DT, STATUS_LABEL, dealSignaturesKey, type SendResponse } from './signatureTypes';
import { SEND_OPTIONS, ZAPSIGN_ORG_STATUS_KEY, useZapSignOrgStatus } from './useZapSign';

type Pending = SignatureReviewRequest & { resolve: (r: SignatureReviewResult) => void; scope: string; settled: boolean; committing: boolean };

export function SignatureReviewProvider({ children }: { children: React.ReactNode }) {
  const { organizationId, user } = useAuth();
  // Carrega cedo o "conectada? quais etapas?" que o movimento do lead consulta
  useZapSignOrgStatus(!!organizationId);
  const scope = `${organizationId}:${user?.id}`;
  const scopeRef = useRef(scope);
  useLayoutEffect(() => {
    scopeRef.current = scope;
  }, [scope]);
  const pendingRef = useRef<Pending | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  useEffect(
    () => () => {
      const p = pendingRef.current;
      if (p && !p.settled && !p.committing) p.resolve({ cancelled: true });
    },
    []
  );
  const request = useCallback(async (req: SignatureReviewRequest) => {
    if (pendingRef.current) throw new Error('Conclua ou cancele a conferência do contrato aberta antes de continuar.');
    return new Promise<SignatureReviewResult>((resolve) => {
      const p: Pending = { ...req, resolve, scope: scopeRef.current, settled: false, committing: false };
      pendingRef.current = p;
      setPending(p);
    });
  }, []);
  /** Entrega o resultado ao movimento (o modal pode continuar aberto mostrando o que houve). */
  const settle = useCallback((result: SignatureReviewResult) => {
    const p = pendingRef.current;
    if (!p || p.settled) return;
    p.settled = true;
    p.resolve(result);
  }, []);
  const close = useCallback(() => {
    const p = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    if (p && !p.settled) {
      p.settled = true;
      p.resolve({ cancelled: true });
    }
  }, []);
  return (
    <SignatureReviewContext.Provider value={request}>
      {children}
      {pending ? <ReviewDialog key={`${pending.deal.id}:${pending.stage.id}:${pending.scope}`} pending={pending} currentScope={scope} scopeRef={scopeRef} settle={settle} close={close} /> : null}
    </SignatureReviewContext.Provider>
  );
}

function ReviewDialog({
  pending,
  currentScope,
  scopeRef,
  settle,
  close,
}: {
  pending: Pending;
  currentScope: string;
  scopeRef: React.RefObject<string>;
  settle: (r: SignatureReviewResult) => void;
  close: () => void;
}) {
  const { addToast } = useToast();
  const { organizationId } = useAuth();
  const qc = useQueryClient();
  const draft = useSignatureDraft({ dealId: pending.deal.id, stageId: pending.stage.id });
  const [busy, setBusy] = useState<null | 'send' | 'move'>(null);
  const [moved, setMoved] = useState(pending.moved);
  const [error, setError] = useState('');
  const [done, setDone] = useState<null | { ok: boolean; text: string; link?: string | null }>(null);
  const submitting = useRef(false);

  // Sessão/organização trocou com o modal aberto: fecha sem fazer nada
  useEffect(() => {
    if (currentScope !== pending.scope && !submitting.current) close();
  }, [currentScope, pending.scope, close]);

  const existing = draft.prep.data?.existing ?? null;
  const stageLabel = pending.stage.label;
  const after = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: dealSignaturesKey(pending.deal.id) }),
      qc.invalidateQueries({ queryKey: dealHistoryKey(pending.deal.id) }),
      qc.invalidateQueries({ queryKey: ['stageSignature', pending.stage.id] }),
      qc.invalidateQueries({ queryKey: ZAPSIGN_ORG_STATUS_KEY }),
      invalidateLeadHistory(qc, organizationId, pending.deal.id),
    ]);
  };

  /** Move o lead (quando ainda não moveu). Devolve false se falhou. */
  const doMove = async (): Promise<{ ok: true; confirmed?: Partial<Deal> } | { ok: false }> => {
    if (moved || !pending.persistMove) return { ok: true };
    try {
      const confirmed = await pending.persistMove();
      setMoved(true);
      return { ok: true, confirmed };
    } catch (e) {
      setError((e as Error).message || 'Não foi possível mudar de etapa. Nada foi alterado.');
      return { ok: false };
    }
  };

  const sendNow = async () => {
    if (submitting.current || !draft.ready) return;
    if (scopeRef.current !== pending.scope) {
      close();
      return;
    }
    submitting.current = true;
    pending.committing = true;
    setBusy('send');
    setError('');
    try {
      const mv = await doMove();
      if (!mv.ok) return;
      // o movimento já vale para o CRM; o envio é a segunda parte
      settle({ cancelled: false, confirmed: mv.confirmed, sent: true });
      const res = await fetch('/api/integrations/zapsign/send', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ deal_id: pending.deal.id, rule_stage_id: pending.stage.id, ...draft.payload() }),
      });
      const body = (await res.json().catch(() => ({}))) as SendResponse;
      if (body.error && !body.outcome) throw new Error(body.error);
      const o = body.outcome;
      await after();
      if (o?.status === 'pending') {
        const via = SEND_OPTIONS.find((x) => x.value === o.sent_via)?.label ?? o.sent_via;
        addToast(`Contrato enviado para assinatura (${o.sent_via === 'link' ? 'link gerado' : via}).${o.note ? ` ${o.note}.` : ''}`, 'success');
        close();
        return;
      }
      setDone({ ok: false, text: o?.error || o?.reason || body.error || 'Não foi possível enviar.' });
    } catch (e) {
      await after().catch(() => undefined);
      setDone({ ok: false, text: (e as Error).message || 'Não foi possível enviar.' });
    } finally {
      submitting.current = false;
      pending.committing = false;
      setBusy(null);
    }
  };

  const moveOnly = async () => {
    if (submitting.current) return;
    if (scopeRef.current !== pending.scope) {
      close();
      return;
    }
    submitting.current = true;
    pending.committing = true;
    setBusy('move');
    setError('');
    try {
      const mv = await doMove();
      if (!mv.ok) return;
      settle({ cancelled: false, confirmed: mv.confirmed, sent: false });
      await after().catch(() => undefined);
      addToast(existing ? `Lead movido para ${stageLabel} sem enviar outro contrato.` : `Lead movido para ${stageLabel}. O contrato ficou aguardando conferência na aba Contrato.`, 'info');
      close();
    } finally {
      submitting.current = false;
      pending.committing = false;
      setBusy(null);
    }
  };

  const cancel = () => {
    if (submitting.current) return;
    if (moved) {
      // o lead já está na etapa: o contrato fica esperando na aba Contrato
      settle({ cancelled: false, sent: false });
      if (!done) addToast('O contrato ficou aguardando conferência na aba Contrato do lead.', 'info');
    }
    close();
  };

  const title = moved ? 'Conferir e enviar o contrato' : 'Conferir contrato antes de enviar';
  const emptyBlock = !!draft.prep.data && !draft.ready && draft.emptyVars.length > 0 && !draft.form.allowEmpty && !draft.blocked;
  const footer = done ? (
    <div className="flex justify-end">
      <button type="button" onClick={close} className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-500">
        Fechar
      </button>
    </div>
  ) : (
    <div className="space-y-2">
      {error ? (
        <p role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-500/30 dark:bg-red-900/15 dark:text-red-300">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" /> {error}
        </p>
      ) : null}
    <div className="flex flex-wrap items-center justify-between gap-2">
      {emptyBlock ? (
        <p className="text-[11px] font-medium text-amber-700 dark:text-amber-300">
          Preencha ou confirme {draft.emptyVars.length === 1 ? 'o campo em branco' : `os ${draft.emptyVars.length} campos em branco`} no fim da lista para enviar.
        </p>
      ) : (
        <p className="text-[11px] text-slate-500">O documento criado conta na franquia da ZapSign.</p>
      )}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <button type="button" onClick={cancel} disabled={!!busy} className="px-3 py-2 text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10 rounded-lg disabled:opacity-50">
          {moved ? 'Deixar para depois' : 'Cancelar'}
        </button>
        {!moved ? (
          <button
            type="button"
            onClick={() => void moveOnly()}
            disabled={!!busy || draft.prep.isLoading}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-50 ${
              existing ? 'bg-primary-600 text-white hover:bg-primary-500' : 'border border-slate-200 dark:border-white/15 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/5'
            }`}
          >
            {busy === 'move' ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : null}
            {existing ? 'Mover sem enviar de novo' : 'Mover sem enviar'}
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => void sendNow()}
          disabled={!!busy || !draft.ready}
          title={emptyBlock ? 'Preencha os campos em branco ou marque para enviar assim mesmo' : undefined}
          className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-bold disabled:opacity-50 ${
            existing && !moved ? 'border border-primary-300 dark:border-primary-500/40 text-primary-700 dark:text-primary-300 hover:bg-primary-50 dark:hover:bg-primary-500/10' : 'bg-primary-600 text-white hover:bg-primary-500'
          }`}
        >
          {busy === 'send' ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Send size={14} aria-hidden="true" />}
          {moved ? 'Enviar contrato' : existing ? 'Mover e enviar outro' : 'Mover e enviar contrato'}
        </button>
      </div>
    </div>
    </div>
  );

  return createPortal(
    <div className="relative z-[10020]">
      <Modal isOpen title={title} onClose={cancel} size="2xl" footer={footer}>
        <div data-esc-local="" className="space-y-4">
          <div className="flex items-start gap-3 rounded-xl bg-primary-50 dark:bg-primary-900/20 p-3.5">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/80 dark:bg-white/10 text-primary-600 dark:text-primary-300">
              <FileSignature size={16} aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">{draft.templateName || pending.templateName || 'Contrato da etapa'}</p>
              <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-primary-800 dark:text-primary-200">
                <span className="truncate">{pending.deal.title}</span>
                <ArrowRight size={12} className="shrink-0" aria-hidden="true" />
                <span className="shrink-0 font-semibold">{stageLabel}</span>
              </p>
              <p className="mt-1 text-[11px] text-primary-700/80 dark:text-primary-300/80">
                {moved ? `O lead já está em ${stageLabel}. Confira o que vai no contrato antes de enviar.` : 'Confira o que vai no contrato. O lead só muda de etapa depois que você decidir.'}
              </p>
            </div>
          </div>

          {existing && !done ? (
            <p className="flex items-start gap-2 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 px-3 py-2 text-xs text-slate-600 dark:text-slate-300">
              <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-emerald-500" aria-hidden="true" />
              <span>
                Este lead já tem um contrato desta etapa: <b>{existing.doc_name || existing.template_name || 'documento'}</b>, {(STATUS_LABEL[existing.status] ?? existing.status).toLowerCase()}
                {existing.signed_at ? ` em ${DT.format(new Date(existing.signed_at))}` : existing.sent_at ? ` desde ${DT.format(new Date(existing.sent_at))}` : ''}. Enviar de novo cria outro documento.
              </span>
            </p>
          ) : null}

          {done ? (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-500/30 dark:bg-red-900/20 dark:text-red-200">
              <p className="flex items-start gap-2">
                <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                <span>
                  O lead foi movido para <b>{stageLabel}</b>, mas o contrato não foi enviado: {done.text}. Você pode tentar de novo pela aba Contrato do lead.
                </span>
              </p>
            </div>
          ) : (
            <>
              <SignatureFields draft={draft} idPrefix={`review-${pending.deal.id}`} disabled={!!busy} />
            </>
          )}
        </div>
      </Modal>
    </div>,
    document.body
  );
}

export default SignatureReviewProvider;
