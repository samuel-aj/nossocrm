'use client';

/**
 * Campos de um envio para assinatura (apresentação do rascunho de
 * useSignatureDraft): quem assina, como recebe o link e comprova quem é, o
 * documento (nome e, por último, o modelo da ZapSign) e o que vai no
 * contrato.
 *
 * - `compact` (aba Contrato do lead): signatário numa linha, envio recolhido
 *   num resumo com "Ajustar", modelo por último e o cartão "O que vai no
 *   contrato" abrindo o modal de preenchimento (variablesMode="modal").
 * - completo (modal de conferência ao mudar de etapa): seções abertas e os
 *   campos do contrato inline.
 */
import React, { useEffect, useState } from 'react';
import { AlertTriangle, Loader2, Mail, PenLine, Phone, UserRound } from 'lucide-react';
import { NativeSelect } from '@/components/ui/NativeSelect';
import { AUTH_OPTIONS, SEND_OPTIONS } from './useZapSign';
import { VariableValueRows, fillSummary } from './VariableValueRows';
import { VariableValuesModal } from './VariableValuesModal';
import type { SignatureDraft } from './useSignatureDraft';

export const FIELD =
  'w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-900 dark:text-white placeholder:text-slate-400 focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500 outline-none disabled:opacity-60';
export const LABEL = 'block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1';
const SECTION = 'text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400';
const WARN = 'flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-900/15 dark:text-amber-200';
const BLOCK = 'flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-500/30 dark:bg-red-900/15 dark:text-red-300';

type Props = {
  draft: SignatureDraft;
  idPrefix: string;
  disabled?: boolean;
  variablesMode?: 'inline' | 'modal';
  /** aba Contrato: menos texto, opções de envio recolhidas */
  compact?: boolean;
};

export function SignatureFields({ draft, idPrefix, disabled, variablesMode = 'inline', compact = false }: Props) {
  const { prep, templatesQ, varsQ, templates, templateName, form, set, chooseTemplate, variables, issues } = draft;
  const data = prep.data;
  const id = (s: string) => `${idPrefix}-${s}`;

  // Modo modal: escolher o modelo abre o preenchimento assim que o modelo é lido
  const [fillOpen, setFillOpen] = useState(false);
  const [pendingOpen, setPendingOpen] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(false);
  useEffect(() => {
    if (!pendingOpen || pendingOpen !== form.templateToken || varsQ.isLoading || (!varsQ.data && !varsQ.error)) return;
    setPendingOpen(null);
    if (variables.length > 0) setFillOpen(true);
  }, [pendingOpen, form.templateToken, varsQ.isLoading, varsQ.data, varsQ.error, variables.length]);
  const pickTemplate = (token: string) => {
    chooseTemplate(token);
    if (variablesMode === 'modal') setPendingOpen(token || null);
  };

  if (prep.isLoading) {
    return (
      <p className="inline-flex items-center gap-2 py-6 text-sm text-slate-500">
        <Loader2 size={14} className="animate-spin" aria-hidden="true" /> Carregando os dados do lead...
      </p>
    );
  }
  if (prep.error || !data) {
    return <p className="text-sm text-red-600 dark:text-red-400">{(prep.error as Error | null)?.message ?? 'Não foi possível carregar os dados do lead.'}</p>;
  }

  const contact = data.contact;
  const summary = fillSummary(draft);
  const blocks = issues.filter((i) => i.kind === 'block');
  const warns = issues.filter((i) => i.kind === 'warn');
  const sendLabel = SEND_OPTIONS.find((o) => o.value === form.send)?.label ?? form.send;
  const authLabel = AUTH_OPTIONS.find((o) => o.value === form.authMode)?.label.replace(' (padrão)', '') ?? form.authMode;

  const modelSelect = (
    <NativeSelect id={id('tpl')} className={FIELD} value={form.templateToken} onChange={(e) => pickTemplate(e.target.value)}>
      <option value="">{templatesQ.isLoading ? 'Carregando...' : 'Escolha o modelo'}</option>
      {templates.map((t) => (
        <option key={t.token} value={t.token}>
          {t.name}
        </option>
      ))}
    </NativeSelect>
  );

  const deliveryFields = (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={id('how')} className={LABEL}>
            Como o cliente recebe o link
          </label>
          <NativeSelect id={id('how')} className={FIELD} value={form.send} onChange={(e) => set({ send: e.target.value })}>
            {SEND_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </NativeSelect>
          {!compact ? <p className="mt-1 text-[11px] text-slate-500">{SEND_OPTIONS.find((o) => o.value === form.send)?.hint}</p> : null}
        </div>
        <div>
          <label htmlFor={id('auth')} className={LABEL}>
            Como o cliente comprova quem é
          </label>
          <NativeSelect id={id('auth')} className={FIELD} value={form.authMode} onChange={(e) => set({ authMode: e.target.value })}>
            {AUTH_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </NativeSelect>
          <label className="mt-1.5 inline-flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-300">
            <input type="checkbox" className="h-3.5 w-3.5 accent-primary-600" checked={form.requireCpf} onChange={(e) => set({ requireCpf: e.target.checked })} /> Pedir CPF ao assinar
          </label>
        </div>
      </div>
      {form.send === 'crm_whatsapp' ? (
        <div>
          <label htmlFor={id('msg')} className={LABEL}>
            Mensagem no WhatsApp
          </label>
          <textarea id={id('msg')} className={`${FIELD} resize-y`} rows={2} maxLength={1000} value={form.message} onChange={(e) => set({ message: e.target.value })} />
          <p className="mt-1 text-[11px] text-slate-500">
            Variáveis: {'{{nome}}'}, {'{{primeiro_nome}}'}, {'{{documento}}'}, {'{{link}}'}.
          </p>
        </div>
      ) : null}
    </>
  );

  const docNameField = (
    <div>
      <label htmlFor={id('name')} className={LABEL}>
        Nome do documento
      </label>
      <input id={id('name')} className={FIELD} value={form.docName} onChange={(e) => set({ docName: e.target.value })} placeholder={`${templateName || 'Documento'} - ${contact.name || 'cliente'}`} maxLength={255} />
    </div>
  );

  const fieldsBlock = !form.templateToken ? null : variablesMode === 'modal' ? (
    <section aria-labelledby={id('vars-h')}>
      <h4 id={id('vars-h')} className="sr-only">
        O que vai no contrato
      </h4>
      {varsQ.isLoading ? (
        <p className="inline-flex items-center gap-1.5 py-1 text-xs text-slate-500">
          <Loader2 size={12} className="animate-spin" aria-hidden="true" /> Lendo o modelo...
        </p>
      ) : varsQ.error ? (
        <p className="text-xs text-red-600">{(varsQ.error as Error).message}</p>
      ) : variables.length === 0 ? (
        <p className="rounded-lg bg-slate-50 dark:bg-white/5 px-3 py-2 text-xs text-slate-500">{varsQ.data?.note ?? 'Este modelo não tem variáveis entre chaves. O documento vai como está.'}</p>
      ) : (
        <button
          type="button"
          onClick={() => setFillOpen(true)}
          className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors hover:border-primary-400 dark:hover:border-primary-500/50 ${
            summary.empty && !form.allowEmpty ? 'border-amber-300 bg-amber-50/60 dark:border-amber-500/40 dark:bg-amber-900/10' : 'border-slate-200 bg-white dark:border-white/10 dark:bg-white/5'
          }`}
        >
          <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${summary.empty && !form.allowEmpty ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300'}`}>
            <PenLine size={15} aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-slate-900 dark:text-white">O que vai no contrato</span>
            <span className="block truncate text-[11px] text-slate-500 dark:text-slate-400">
              {summary.text}
              {summary.empty ? ` (${draft.emptyVars.join(', ')})` : ''}
              {summary.empty && form.allowEmpty ? ' · vai assim mesmo' : ''}
            </span>
          </span>
          <span className="shrink-0 text-xs font-semibold text-primary-600 dark:text-primary-400">{summary.empty && !form.allowEmpty ? 'Preencher' : 'Conferir'}</span>
        </button>
      )}
      <VariableValuesModal open={fillOpen} onClose={() => setFillOpen(false)} draft={draft} idPrefix={idPrefix} />
    </section>
  ) : (
    <section className="space-y-2" aria-labelledby={id('vars-h')}>
      <div className="flex items-center justify-between gap-2">
        <h4 id={id('vars-h')} className={SECTION}>
          O que vai no contrato
        </h4>
        {variables.length > 0 ? (
          <span className={`text-[11px] font-semibold ${summary.empty ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>{summary.text}</span>
        ) : null}
      </div>
      <VariableValueRows draft={draft} idPrefix={idPrefix} />
    </section>
  );

  if (compact) {
    return (
      <fieldset disabled={disabled} className="space-y-3 min-w-0">
        {/* Quem assina, numa linha */}
        <p aria-label="Signatário" className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-600 dark:text-slate-300">
          <UserRound size={13} className="shrink-0 text-slate-400" aria-hidden="true" />
          <span className="font-semibold text-slate-900 dark:text-white">{contact.name || <span className="text-red-600 dark:text-red-400">Contato sem nome</span>}</span>
          <span className="text-slate-300 dark:text-slate-600" aria-hidden="true">
            ·
          </span>
          <span>{contact.phone || <span className="text-amber-600 dark:text-amber-400">sem telefone</span>}</span>
          <span className="text-slate-300 dark:text-slate-600" aria-hidden="true">
            ·
          </span>
          <span>{contact.email || <span className="text-slate-400">sem e-mail</span>}</span>
          {data.sandbox ? (
            <span className="ml-auto rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800 dark:bg-amber-500/15 dark:text-amber-300" title="Ambiente de testes da ZapSign: documento sem validade jurídica">
              Testes
            </span>
          ) : null}
        </p>

        {blocks.map((i) => (
          <p key={i.text} role="alert" className={BLOCK}>
            <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" /> {i.text}
          </p>
        ))}

        {/* Envio: resumo recolhido; "Ajustar" abre as opções */}
        <div className="rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50/70 dark:bg-white/[0.03]">
          <div className="flex items-center justify-between gap-2 px-3 py-2 text-xs text-slate-600 dark:text-slate-300">
            <span className="min-w-0 truncate">
              <span className="font-semibold text-slate-700 dark:text-slate-200">Envio:</span> {sendLabel} · {authLabel}
              {form.requireCpf ? ' · pede CPF' : ''}
            </span>
            <button type="button" onClick={() => setAdvanced((v) => !v)} aria-expanded={advanced} className="shrink-0 font-semibold text-primary-600 dark:text-primary-400 hover:underline">
              {advanced ? 'Ocultar' : 'Ajustar'}
            </button>
          </div>
          {advanced ? (
            <div className="space-y-3 border-t border-slate-200 dark:border-white/10 p-3">
              {deliveryFields}
              {docNameField}
            </div>
          ) : null}
        </div>
        {warns.map((i) => (
          <p key={i.text} className={WARN}>
            <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" /> {i.text}
          </p>
        ))}

        {/* Modelo, por último */}
        <div className="flex items-center gap-3">
          <label htmlFor={id('tpl')} className="shrink-0 text-xs font-semibold text-slate-600 dark:text-slate-300">
            Modelo
          </label>
          <div className="min-w-0 flex-1">{modelSelect}</div>
        </div>
        {templatesQ.error ? <p className="text-[11px] text-red-600">{(templatesQ.error as Error).message}</p> : null}

        {fieldsBlock}
      </fieldset>
    );
  }

  const initial = (contact.name.trim()[0] ?? '?').toUpperCase();
  return (
    <fieldset disabled={disabled} className="space-y-5 min-w-0">
      {/* Quem assina */}
      <section aria-label="Signatário" className="flex items-center gap-3 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50/70 dark:bg-white/[0.03] px-3 py-2.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-100 text-primary-700 dark:bg-primary-500/20 dark:text-primary-300 text-sm font-bold" aria-hidden="true">
          {contact.name ? initial : <UserRound size={16} />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">{contact.name || <span className="text-red-600 dark:text-red-400">Contato sem nome</span>}</p>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-500 dark:text-slate-400">
            <span className="inline-flex items-center gap-1">
              <Phone size={10} aria-hidden="true" /> {contact.phone || <span className="text-amber-600 dark:text-amber-400">sem telefone</span>}
            </span>
            <span className="inline-flex items-center gap-1">
              <Mail size={10} aria-hidden="true" /> {contact.email || <span className="text-slate-400">sem e-mail</span>}
            </span>
          </p>
        </div>
        {data.sandbox ? (
          <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800 dark:bg-amber-500/15 dark:text-amber-300" title="Ambiente de testes da ZapSign: documento sem validade jurídica">
            Testes
          </span>
        ) : null}
      </section>

      {blocks.map((i) => (
        <p key={i.text} role="alert" className={BLOCK}>
          <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" /> {i.text}
        </p>
      ))}

      {/* Envio */}
      <section className="space-y-3" aria-labelledby={id('send-h')}>
        <h4 id={id('send-h')} className={SECTION}>
          Envio e assinatura
        </h4>
        {deliveryFields}
        {warns.map((i) => (
          <p key={i.text} className={WARN}>
            <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" /> {i.text}
          </p>
        ))}
      </section>

      {/* Documento: nome e, por último, o modelo */}
      <section className="space-y-3" aria-labelledby={id('doc-h')}>
        <h4 id={id('doc-h')} className={SECTION}>
          Documento
        </h4>
        <div className="grid gap-3 sm:grid-cols-2">
          {docNameField}
          <div>
            <label htmlFor={id('tpl')} className={LABEL}>
              Modelo da ZapSign
            </label>
            {modelSelect}
            {templatesQ.error ? <p className="mt-1 text-[11px] text-red-600">{(templatesQ.error as Error).message}</p> : null}
          </div>
        </div>
      </section>

      {fieldsBlock}
    </fieldset>
  );
}

export default SignatureFields;
