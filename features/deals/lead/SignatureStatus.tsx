'use client';

/**
 * Assinatura eletrônica no lead: o documento mais recente (aguardando, assinado,
 * recusado), o link para reenviar na mão, o PDF assinado e o botão "Enviar para
 * assinatura", que abre a prévia dos valores antes de criar o documento.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Clock, Copy, Download, FileSignature, Loader2, Send, X } from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import { Modal } from '@/components/ui/Modal';
import { NativeSelect } from '@/components/ui/NativeSelect';
import { VariableMappingTable } from '@/features/zapsign/VariableMappingTable';
import { AUTH_OPTIONS, DEFAULT_SIGN_MESSAGE, SEND_OPTIONS, useZapSignTemplateVariables, useZapSignTemplates } from '@/features/zapsign/useZapSign';
import { dealHistoryKey } from './useDealHistory';
import type { Deal, DealView } from '@/types';
import type { SourceOption } from '@/lib/zapsign/variables';

type SignerLite = { name: string; status: string; signed_at: string | null; role: string };
type Signature = {
  id: string;
  origin: 'rule' | 'manual';
  status: string;
  template_name: string | null;
  doc_name: string | null;
  sign_url: string | null;
  sent_via: string | null;
  sent_at: string | null;
  signed_at: string | null;
  refused_at: string | null;
  refused_reason: string | null;
  file_id: string | null;
  last_error: string | null;
  signers: SignerLite[];
  created_at: string;
};
type DealSignatures = { connected: boolean; signatures: Signature[]; file_url: string | null; file_signature_id: string | null; pendingMigration?: boolean };

const DT = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const dealSignaturesKey = (dealId: string) => ['zapsign', 'deal', dealId] as const;

const STATUS_LABEL: Record<string, string> = {
  queued: 'Na fila para envio',
  processing: 'Enviando...',
  pending: 'Aguardando assinatura',
  signed: 'Assinado',
  refused: 'Recusado',
  deleted: 'Excluído na ZapSign',
  expired: 'Expirado',
  failed: 'Falha no envio',
  cancelled: 'Cancelado',
};

export function SignatureStatus({ deal, canEdit }: { deal: Deal | DealView; canEdit: boolean }) {
  const [open, setOpen] = useState(false);
  const { addToast } = useToast();
  const q = useQuery<DealSignatures>({
    queryKey: dealSignaturesKey(deal.id),
    queryFn: async () => {
      const res = await fetch(`/api/integrations/zapsign/deal/${deal.id}`, { credentials: 'include' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error || `HTTP ${res.status}`);
      return body as DealSignatures;
    },
    retry: false,
    staleTime: 10_000,
    refetchInterval: (query) => {
      const list = query.state.data?.signatures ?? [];
      return list.some((s) => ['queued', 'processing', 'pending'].includes(s.status)) ? 15_000 : false;
    },
  });
  const data = q.data;
  if (!data || data.pendingMigration || (!data.connected && data.signatures.length === 0)) return null;
  const latest = data.signatures[0] ?? null;

  const copyLink = async () => {
    if (!latest?.sign_url) return;
    try {
      await navigator.clipboard.writeText(latest.sign_url);
      addToast('Link de assinatura copiado.', 'success');
    } catch {
      addToast('Não foi possível copiar.', 'error');
    }
  };

  let icon = <FileSignature size={12} aria-hidden="true" />;
  let tone = 'text-slate-500 dark:text-slate-400';
  if (latest?.status === 'signed') {
    icon = <CheckCircle2 size={12} aria-hidden="true" />;
    tone = 'text-emerald-700 dark:text-emerald-400';
  } else if (latest?.status === 'refused' || latest?.status === 'failed') {
    icon = <AlertTriangle size={12} aria-hidden="true" />;
    tone = 'text-red-600 dark:text-red-400';
  } else if (latest?.status === 'pending') {
    icon = <Clock size={12} aria-hidden="true" />;
  }

  return (
    <div className="space-y-1.5" aria-label="Assinatura eletrônica">
      {latest ? (
        <div className={`text-[11px] leading-snug ${tone}`} role="status">
          <p className="flex items-start gap-1.5">
            <span className="mt-[1px] shrink-0">{icon}</span>
            <span>
              <b>{latest.doc_name || latest.template_name || 'Documento'}</b>: {STATUS_LABEL[latest.status] ?? latest.status}
              {latest.status === 'pending' && latest.sent_at ? ` desde ${DT.format(new Date(latest.sent_at))}` : ''}
              {latest.status === 'signed' && latest.signed_at ? ` em ${DT.format(new Date(latest.signed_at))}` : ''}
              {latest.status === 'refused' && latest.refused_reason ? `: ${latest.refused_reason}` : ''}
              {latest.status === 'failed' && latest.last_error ? `: ${latest.last_error}` : ''}
              {latest.status === 'pending' && latest.last_error ? ` (${latest.last_error})` : ''}
            </span>
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2 pl-[18px]">
            {latest.status === 'pending' && latest.sign_url ? (
              <>
                <button type="button" onClick={() => void copyLink()} className="inline-flex items-center gap-1 font-semibold text-primary-600 dark:text-primary-400 hover:underline">
                  <Copy size={11} aria-hidden="true" /> Copiar link
                </button>
                <a href={latest.sign_url} target="_blank" rel="noreferrer" className="font-semibold text-primary-600 dark:text-primary-400 hover:underline">
                  Abrir
                </a>
              </>
            ) : null}
            {latest.status === 'signed' && data.file_url && data.file_signature_id === latest.id ? (
              <a href={data.file_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-primary-600 dark:text-primary-400 hover:underline">
                <Download size={11} aria-hidden="true" /> PDF assinado
              </a>
            ) : null}
            {canEdit && data.connected ? (
              <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1 font-semibold text-slate-600 dark:text-slate-300 hover:text-primary-600 hover:underline">
                <Send size={11} aria-hidden="true" /> {latest.status === 'pending' ? 'Enviar outro' : 'Enviar de novo'}
              </button>
            ) : null}
          </div>
        </div>
      ) : canEdit && data.connected ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-slate-300 dark:border-white/15 px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 dark:text-slate-300 hover:border-primary-400 hover:text-primary-700 dark:hover:text-primary-300 transition-colors"
        >
          <FileSignature size={12} aria-hidden="true" /> Enviar para assinatura
        </button>
      ) : null}
      {open ? <SendSignatureModal deal={deal} onClose={() => setOpen(false)} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------- envio manual

type Prep = {
  connected: boolean;
  sandbox: boolean;
  rule: {
    template_token: string;
    template_name: string | null;
    doc_name: string | null;
    variables: Record<string, string>;
    signer: { auth_mode?: string; require_cpf?: boolean; require_selfie_photo?: boolean; send?: string; message?: string; allow_refuse?: boolean };
    extra_signers: Array<{ name: string; email?: string; phone?: string; qualification?: string }>;
    on_signed: Record<string, unknown>;
    on_refused: Record<string, unknown>;
  } | null;
  contact: { name: string; email: string; phone: string };
  sources: SourceOption[];
  preview: Record<string, string>;
};

const FIELD = 'w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500 outline-none';
const LABEL = 'block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1';

function SendSignatureModal({ deal, onClose }: { deal: Deal | DealView; onClose: () => void }) {
  const { addToast } = useToast();
  const qc = useQueryClient();
  const prep = useQuery<Prep>({
    queryKey: ['zapsign', 'send-prep', deal.id],
    queryFn: async () => {
      const res = await fetch(`/api/integrations/zapsign/send?deal_id=${deal.id}`, { credentials: 'include' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error || `HTTP ${res.status}`);
      return body as Prep;
    },
    staleTime: 0,
    retry: false,
  });
  const templatesQ = useZapSignTemplates(true);
  const [templateToken, setTemplateToken] = useState('');
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [send, setSend] = useState('crm_whatsapp');
  const [authMode, setAuthMode] = useState('assinaturaTela');
  const [requireCpf, setRequireCpf] = useState(false);
  const [message, setMessage] = useState(DEFAULT_SIGN_MESSAGE);
  const [docName, setDocName] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string; link?: string | null } | null>(null);
  const varsQ = useZapSignTemplateVariables(templateToken || null);

  // Padrão: a regra da etapa atual
  useEffect(() => {
    const r = prep.data?.rule;
    if (!r || templateToken) return;
    setTemplateToken(r.template_token);
    setMapping(r.variables ?? {});
    setSend(r.signer?.send ?? 'crm_whatsapp');
    setAuthMode(r.signer?.auth_mode ?? 'assinaturaTela');
    setRequireCpf(!!r.signer?.require_cpf);
    setMessage(r.signer?.message || DEFAULT_SIGN_MESSAGE);
    setDocName(r.doc_name ?? '');
  }, [prep.data, templateToken]);

  useEffect(() => {
    const v = varsQ.data;
    if (!v) return;
    setMapping((m) => {
      const next = { ...m };
      let changed = false;
      for (const name of v.variables) {
        if (!(name in next)) {
          next[name] = v.suggestions[name] ?? '';
          changed = true;
        }
      }
      return changed ? next : m;
    });
  }, [varsQ.data]);

  const templates = templatesQ.data?.templates ?? [];
  const templateName = useMemo(() => templates.find((t) => t.token === templateToken)?.name ?? prep.data?.rule?.template_name ?? '', [templates, templateToken, prep.data]);
  const variables = varsQ.data?.variables ?? [];
  const sendOk = !!templateToken && !varsQ.isLoading && !!prep.data?.contact.name;

  const submit = async () => {
    if (!sendOk || sending) return;
    setSending(true);
    setResult(null);
    try {
      const vars: Record<string, string> = {};
      for (const name of variables) vars[name] = mapping[name] ?? '';
      const res = await fetch('/api/integrations/zapsign/send', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          deal_id: deal.id,
          template_token: templateToken,
          template_name: templateName || null,
          doc_name: docName || null,
          variables: vars,
          overrides,
          signer: { send, auth_mode: authMode, require_cpf: requireCpf, message, allow_refuse: prep.data?.rule?.signer?.allow_refuse ?? true },
          extra_signers: prep.data?.rule?.extra_signers ?? [],
          on_signed: prep.data?.rule?.on_signed ?? {},
          on_refused: prep.data?.rule?.on_refused ?? {},
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; signature?: Signature; outcome?: { status: string; sent_via?: string; note?: string; error?: string; reason?: string } };
      if (body.error && !body.outcome) throw new Error(body.error);
      const o = body.outcome;
      if (o?.status === 'pending') {
        const via = SEND_OPTIONS.find((x) => x.value === o.sent_via)?.label ?? o.sent_via;
        setResult({ ok: true, text: `Documento criado e ${o.sent_via === 'link' ? 'link gerado' : `enviado (${via})`}.${o.note ? ` ${o.note}.` : ''}`, link: body.signature?.sign_url ?? null });
        await qc.invalidateQueries({ queryKey: dealSignaturesKey(deal.id) });
        await qc.invalidateQueries({ queryKey: dealHistoryKey(deal.id) });
      } else {
        setResult({ ok: false, text: o?.error || o?.reason || body.error || 'Não foi possível enviar.' });
        await qc.invalidateQueries({ queryKey: dealSignaturesKey(deal.id) });
      }
    } catch (e) {
      setResult({ ok: false, text: e instanceof Error ? e.message : 'Falha ao enviar' });
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title="Enviar para assinatura" size="xl">
      <div data-esc-local="" className="space-y-4">
        {prep.isLoading ? (
          <p className="inline-flex items-center gap-2 text-sm text-slate-500">
            <Loader2 size={14} className="animate-spin" aria-hidden="true" /> Carregando os dados do lead...
          </p>
        ) : prep.error ? (
          <p className="text-sm text-red-600">{(prep.error as Error).message}</p>
        ) : result ? (
          <div className={`rounded-xl border p-4 text-sm ${result.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-900/20 dark:text-emerald-200' : 'border-red-200 bg-red-50 text-red-800 dark:border-red-500/30 dark:bg-red-900/20 dark:text-red-200'}`}>
            <p className="flex items-start gap-2">
              {result.ok ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> : <AlertTriangle size={16} className="mt-0.5 shrink-0" />}
              <span>{result.text}</span>
            </p>
            {result.link ? (
              <p className="mt-2 break-all text-xs">
                Link de assinatura:{' '}
                <a href={result.link} target="_blank" rel="noreferrer" className="underline">
                  {result.link}
                </a>
              </p>
            ) : null}
            <div className="mt-3 flex justify-end">
              <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-white/70 dark:bg-black/20 border border-current/20">
                Fechar
              </button>
            </div>
          </div>
        ) : (
          <>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Signatário: <b className="text-slate-700 dark:text-slate-200">{prep.data?.contact.name || 'sem nome'}</b>
              {prep.data?.contact.phone ? ` · ${prep.data.contact.phone}` : ' · sem telefone'}
              {prep.data?.contact.email ? ` · ${prep.data.contact.email}` : ''}
              {prep.data?.sandbox ? ' · ambiente de testes (sem validade jurídica)' : ''}
            </p>
            {!prep.data?.contact.name ? <p className="text-xs text-red-600">O lead precisa de um contato com nome para assinar.</p> : null}

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="sig-send-tpl" className={LABEL}>
                  Modelo
                </label>
                <NativeSelect
                  id="sig-send-tpl"
                  className={FIELD}
                  value={templateToken}
                  onChange={(e) => {
                    setTemplateToken(e.target.value);
                    setMapping(e.target.value === prep.data?.rule?.template_token ? (prep.data?.rule?.variables ?? {}) : {});
                    setOverrides({});
                  }}
                >
                  <option value="">{templatesQ.isLoading ? 'Carregando...' : 'Escolha o modelo'}</option>
                  {templates.map((t) => (
                    <option key={t.token} value={t.token}>
                      {t.name}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div>
                <label htmlFor="sig-send-doc" className={LABEL}>
                  Nome do documento
                </label>
                <input id="sig-send-doc" className={FIELD} value={docName} onChange={(e) => setDocName(e.target.value)} placeholder={`${templateName || 'Documento'} - ${prep.data?.contact.name ?? ''}`} />
              </div>
            </div>

            {templateToken ? (
              varsQ.isLoading ? (
                <p className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                  <Loader2 size={12} className="animate-spin" aria-hidden="true" /> Lendo o modelo...
                </p>
              ) : varsQ.error ? (
                <p className="text-xs text-red-600">{(varsQ.error as Error).message}</p>
              ) : variables.length === 0 ? (
                <p className="text-xs text-slate-500">{varsQ.data?.note ?? 'Este modelo não tem variáveis. O documento vai como está.'}</p>
              ) : (
                <div>
                  <p className={LABEL}>Confira o que vai no documento</p>
                  <VariableMappingTable
                    variables={variables}
                    mapping={mapping}
                    onChange={setMapping}
                    sources={prep.data?.sources ?? []}
                    preview={prep.data?.preview}
                    overrides={overrides}
                    onOverride={(name, value) =>
                      setOverrides((o) => {
                        const next = { ...o };
                        if (value === null) delete next[name];
                        else next[name] = value;
                        return next;
                      })
                    }
                  />
                </div>
              )
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="sig-send-how" className={LABEL}>
                  Como o cliente recebe o link
                </label>
                <NativeSelect id="sig-send-how" className={FIELD} value={send} onChange={(e) => setSend(e.target.value)}>
                  {SEND_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </NativeSelect>
                <p className="mt-1 text-[11px] text-slate-500">{SEND_OPTIONS.find((o) => o.value === send)?.hint}</p>
              </div>
              <div>
                <label htmlFor="sig-send-auth" className={LABEL}>
                  Como o cliente comprova quem é
                </label>
                <NativeSelect id="sig-send-auth" className={FIELD} value={authMode} onChange={(e) => setAuthMode(e.target.value)}>
                  {AUTH_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </NativeSelect>
                <label className="mt-1.5 inline-flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-300">
                  <input type="checkbox" className="h-3.5 w-3.5 accent-primary-600" checked={requireCpf} onChange={(e) => setRequireCpf(e.target.checked)} /> Pedir CPF ao assinar
                </label>
              </div>
            </div>
            {send === 'crm_whatsapp' ? (
              <div>
                <label htmlFor="sig-send-msg" className={LABEL}>
                  Mensagem no WhatsApp
                </label>
                <textarea id="sig-send-msg" className={`${FIELD} resize-y`} rows={2} maxLength={1000} value={message} onChange={(e) => setMessage(e.target.value)} />
              </div>
            ) : null}

            <div className="flex items-center justify-between gap-2 pt-1">
              <p className="text-[11px] text-slate-500">O documento criado conta na franquia da ZapSign.</p>
              <div className="flex items-center gap-2">
                <button type="button" onClick={onClose} className="inline-flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10">
                  <X size={14} aria-hidden="true" /> Cancelar
                </button>
                <button type="button" onClick={() => void submit()} disabled={!sendOk || sending} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-bold bg-primary-600 hover:bg-primary-500 text-white disabled:opacity-50">
                  {sending ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Send size={14} aria-hidden="true" />} Enviar para assinatura
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

export default SignatureStatus;
