'use client';

/**
 * Aba "Contrato" da tela do lead (ao lado de Mensagem, Nota interna e
 * Atividade; só aparece com a ZapSign conectada): o documento mais recente
 * (aguardando, assinado, recusado, com link e PDF), o contrato preparado ao
 * entrar na etapa aguardando conferência, e o formulário completo para
 * conferir o que vai no documento e enviar para assinatura.
 */
import React, { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Clock, Copy, Download, ExternalLink, FileSignature, Loader2, Lock, Send, Trash2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useCRM } from '@/context/CRMContext';
import { useToast } from '@/context/ToastContext';
import { SignatureFields } from '@/features/zapsign/SignatureFields';
import { useSignatureDraft } from '@/features/zapsign/useSignatureDraft';
import { DT, STATUS_LABEL, dealSignaturesKey, useDealSignatures, type SendResponse, type Signature } from '@/features/zapsign/signatureTypes';
import { SEND_OPTIONS, ZAPSIGN_ORG_STATUS_KEY } from '@/features/zapsign/useZapSign';
import { invalidateLeadHistory } from './leadHistoryInvalidation';
import { dealHistoryKey } from './useDealHistory';
import type { Deal, DealView } from '@/types';

export function ContractComposer({ deal, canEdit }: { deal: Deal | DealView; canEdit: boolean }) {
  const sig = useDealSignatures(deal.id);
  const { boards } = useCRM();
  const stageLabel = (stageId: string | null) => boards.flatMap((b) => b.stages).find((s) => s.id === stageId)?.label ?? null;
  const list = useMemo(() => sig.data?.signatures ?? [], [sig.data]);
  const review = list.find((s) => s.status === 'review') ?? null;
  const documents = list.filter((s) => s.status !== 'review' && s.status !== 'cancelled');
  const latest = documents[0] ?? null;

  if (sig.isLoading) {
    return (
      <p className="inline-flex items-center gap-2 p-3 text-xs text-slate-500">
        <Loader2 size={12} className="animate-spin" aria-hidden="true" /> Carregando contratos...
      </p>
    );
  }
  if (sig.error) return <p className="p-3 text-xs text-red-600 dark:text-red-400">{(sig.error as Error).message}</p>;
  if (!sig.data?.connected) return <p className="p-3 text-xs text-slate-500">A ZapSign não está conectada nesta organização.</p>;

  return (
    <div className="flex max-h-[min(62vh,600px)] flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-custom px-3 pt-2 pb-3 space-y-3">
        {latest ? <LatestDocument latest={latest} fileUrl={sig.data.file_signature_id === latest.id ? sig.data.file_url : null} older={documents.slice(1)} /> : null}
        {review ? (
          <ReviewBanner review={review} dealId={deal.id} stageLabel={stageLabel(review.stage_id)} canEdit={canEdit} />
        ) : null}
        <ContractForm key={review?.id ?? `stage:${deal.status}`} deal={deal} stageId={review?.stage_id ?? deal.status ?? null} ruleStageId={review?.stage_id ?? null} canEdit={canEdit} hasDocuments={documents.length > 0} />
      </div>
    </div>
  );
}

function LatestDocument({ latest, fileUrl, older }: { latest: Signature; fileUrl: string | null; older: Signature[] }) {
  const { addToast } = useToast();
  const copyLink = async () => {
    if (!latest.sign_url) return;
    try {
      await navigator.clipboard.writeText(latest.sign_url);
      addToast('Link de assinatura copiado.', 'success');
    } catch {
      addToast('Não foi possível copiar.', 'error');
    }
  };
  let icon = <FileSignature size={14} aria-hidden="true" />;
  let tone = 'border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 text-slate-600 dark:text-slate-300';
  let iconTone = 'text-slate-500';
  if (latest.status === 'signed') {
    icon = <CheckCircle2 size={14} aria-hidden="true" />;
    tone = 'border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-900/15 text-emerald-800 dark:text-emerald-200';
    iconTone = 'text-emerald-600 dark:text-emerald-400';
  } else if (latest.status === 'refused' || latest.status === 'failed') {
    icon = <AlertTriangle size={14} aria-hidden="true" />;
    tone = 'border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-900/15 text-red-800 dark:text-red-200';
    iconTone = 'text-red-600 dark:text-red-400';
  } else if (latest.status === 'pending') {
    icon = <Clock size={14} aria-hidden="true" />;
    tone = 'border-sky-200 dark:border-sky-500/30 bg-sky-50 dark:bg-sky-900/15 text-sky-800 dark:text-sky-200';
    iconTone = 'text-sky-600 dark:text-sky-400';
  }
  const when =
    latest.status === 'pending' && latest.sent_at
      ? ` desde ${DT.format(new Date(latest.sent_at))}`
      : latest.status === 'signed' && latest.signed_at
        ? ` em ${DT.format(new Date(latest.signed_at))}`
        : latest.status === 'refused' && latest.refused_at
          ? ` em ${DT.format(new Date(latest.refused_at))}`
          : '';
  const detail = latest.status === 'refused' && latest.refused_reason ? `: ${latest.refused_reason}` : latest.status === 'failed' && latest.last_error ? `: ${latest.last_error}` : latest.status === 'pending' && latest.last_error ? ` (${latest.last_error})` : '';
  return (
    <section aria-label="Documento mais recente" className={`rounded-xl border px-3 py-2.5 text-xs ${tone}`} role="status">
      <p className="flex items-start gap-2">
        <span className={`mt-[1px] shrink-0 ${iconTone}`}>{icon}</span>
        <span className="min-w-0">
          <b>{latest.doc_name || latest.template_name || 'Documento'}</b>: {STATUS_LABEL[latest.status] ?? latest.status}
          {when}
          {detail}
        </span>
      </p>
      <div className="mt-1.5 flex flex-wrap items-center gap-3 pl-6">
        {latest.status === 'pending' && latest.sign_url ? (
          <>
            <button type="button" onClick={() => void copyLink()} className="inline-flex items-center gap-1 font-semibold hover:underline">
              <Copy size={11} aria-hidden="true" /> Copiar link
            </button>
            <a href={latest.sign_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold hover:underline">
              <ExternalLink size={11} aria-hidden="true" /> Abrir
            </a>
          </>
        ) : null}
        {latest.status === 'signed' && fileUrl ? (
          <a href={fileUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold hover:underline">
            <Download size={11} aria-hidden="true" /> PDF assinado
          </a>
        ) : null}
        {older.length > 0 ? (
          <details className="min-w-0">
            <summary className="cursor-pointer font-semibold opacity-80 hover:opacity-100">{older.length === 1 ? '1 documento anterior' : `${older.length} documentos anteriores`}</summary>
            <ul className="mt-1 space-y-0.5 opacity-90">
              {older.map((s) => (
                <li key={s.id} className="truncate">
                  {s.doc_name || s.template_name || 'Documento'}: {(STATUS_LABEL[s.status] ?? s.status).toLowerCase()} ({DT.format(new Date(s.signed_at ?? s.sent_at ?? s.created_at))})
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
    </section>
  );
}

function ReviewBanner({ review, dealId, stageLabel, canEdit }: { review: Signature; dealId: string; stageLabel: string | null; canEdit: boolean }) {
  const { addToast } = useToast();
  const { organizationId } = useAuth();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const discard = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/integrations/zapsign/deal/${dealId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ signature_id: review.id, action: 'discard' }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      await Promise.all([qc.invalidateQueries({ queryKey: dealSignaturesKey(dealId) }), qc.invalidateQueries({ queryKey: dealHistoryKey(dealId) }), invalidateLeadHistory(qc, organizationId, dealId)]);
      addToast('Contrato descartado. Se o lead entrar de novo na etapa, outro é preparado.', 'info');
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Não foi possível descartar', 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-label="Contrato aguardando conferência" className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-900/15 dark:text-amber-100">
      <Clock size={14} className="mt-[1px] shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <b>Contrato aguardando conferência</b>: preparado quando o lead entrou em <b>{stageLabel ?? 'uma etapa com contrato'}</b> ({DT.format(new Date(review.created_at))}). Nada foi enviado ainda. Confira abaixo e envie.
      </span>
      {canEdit ? (
        <button type="button" onClick={() => void discard()} disabled={busy} className="inline-flex shrink-0 items-center gap-1 font-semibold text-amber-800 hover:underline dark:text-amber-200 disabled:opacity-50" title="Descartar sem enviar">
          {busy ? <Loader2 size={11} className="animate-spin" aria-hidden="true" /> : <Trash2 size={11} aria-hidden="true" />} Descartar
        </button>
      ) : null}
    </section>
  );
}

function ContractForm({ deal, stageId, ruleStageId, canEdit, hasDocuments }: { deal: Deal | DealView; stageId: string | null; ruleStageId: string | null; canEdit: boolean; hasDocuments: boolean }) {
  const { addToast } = useToast();
  const { organizationId } = useAuth();
  const qc = useQueryClient();
  const draft = useSignatureDraft({ dealId: deal.id, stageId });
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string; link?: string | null } | null>(null);

  const submit = async () => {
    if (!draft.ready || sending || !canEdit) return;
    setSending(true);
    setResult(null);
    try {
      const res = await fetch('/api/integrations/zapsign/send', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ deal_id: deal.id, rule_stage_id: ruleStageId, ...draft.payload() }),
      });
      const body = (await res.json().catch(() => ({}))) as SendResponse;
      if (body.error && !body.outcome) throw new Error(body.error);
      const o = body.outcome;
      await Promise.all([qc.invalidateQueries({ queryKey: dealSignaturesKey(deal.id) }), qc.invalidateQueries({ queryKey: dealHistoryKey(deal.id) }), qc.invalidateQueries({ queryKey: ZAPSIGN_ORG_STATUS_KEY }), invalidateLeadHistory(qc, organizationId, deal.id)]);
      if (o?.status === 'pending') {
        const via = SEND_OPTIONS.find((x) => x.value === o.sent_via)?.label ?? o.sent_via;
        const text = `Documento criado e ${o.sent_via === 'link' ? 'link gerado' : `enviado (${via})`}.${o.note ? ` ${o.note}.` : ''}`;
        setResult({ ok: true, text, link: body.signature?.sign_url ?? null });
        addToast('Contrato enviado para assinatura.', 'success');
      } else {
        setResult({ ok: false, text: o?.error || o?.reason || body.error || 'Não foi possível enviar.' });
      }
    } catch (e) {
      setResult({ ok: false, text: e instanceof Error ? e.message : 'Falha ao enviar' });
    } finally {
      setSending(false);
    }
  };

  const idPrefix = `contract-${deal.id}`;
  return (
    <div className="space-y-3">
      {result ? (
        <div role="status" className={`rounded-xl border p-3 text-xs ${result.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-900/20 dark:text-emerald-200' : 'border-red-200 bg-red-50 text-red-800 dark:border-red-500/30 dark:bg-red-900/20 dark:text-red-200'}`}>
          <p className="flex items-start gap-2">
            {result.ok ? <CheckCircle2 size={14} className="mt-0.5 shrink-0" aria-hidden="true" /> : <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />}
            <span>{result.text}</span>
          </p>
          {result.link ? (
            <p className="mt-1 break-all pl-6">
              Link:{' '}
              <a href={result.link} target="_blank" rel="noreferrer" className="underline">
                {result.link}
              </a>
            </p>
          ) : null}
        </div>
      ) : null}
      {!hasDocuments && !result ? (
        <p className="text-[11px] text-slate-500 dark:text-slate-400">Nenhum contrato enviado para este lead ainda. Confira os dados abaixo e envie para assinatura.</p>
      ) : null}
      <SignatureFields draft={draft} idPrefix={idPrefix} disabled={!canEdit || sending} variablesMode="modal" />
      <div className="flex items-center justify-between gap-2 pt-1">
        <p className="flex items-center gap-1 text-[11px] text-slate-400">
          {canEdit ? (
            'O documento criado conta na franquia da ZapSign.'
          ) : (
            <>
              <Lock size={10} aria-hidden="true" /> Sem permissão para editar este lead.
            </>
          )}
        </p>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!canEdit || !draft.ready || sending}
          title={!draft.ready && draft.emptyVars.length && !draft.form.allowEmpty ? 'Preencha os campos em branco ou marque para enviar assim mesmo' : undefined}
          className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-sky-600 px-3 text-sm font-bold text-white transition-colors hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {sending ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Send size={14} aria-hidden="true" />}
          {ruleStageId ? 'Conferi, enviar contrato' : hasDocuments ? 'Enviar outro contrato' : 'Enviar para assinatura'}
        </button>
      </div>
    </div>
  );
}

export default ContractComposer;
