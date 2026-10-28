'use client';

/**
 * Campos de um envio para assinatura (apresentação do rascunho de
 * useSignatureDraft): quem assina, qual modelo, o valor de cada variável do
 * contrato (conferível e editável), como o cliente recebe o link e como
 * comprova quem é. Cabe na aba Contrato do lead e no modal de conferência ao
 * mudar de etapa.
 */
import React from 'react';
import { AlertTriangle, Loader2, Mail, Phone, RotateCcw, UserRound } from 'lucide-react';
import { NativeSelect } from '@/components/ui/NativeSelect';
import { AUTH_OPTIONS, SEND_OPTIONS } from './useZapSign';
import type { SignatureDraft } from './useSignatureDraft';

export const FIELD =
  'w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-900 dark:text-white placeholder:text-slate-400 focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500 outline-none disabled:opacity-60';
export const LABEL = 'block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1';
const SECTION = 'text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400';

export function SignatureFields({ draft, idPrefix, disabled }: { draft: SignatureDraft; idPrefix: string; disabled?: boolean }) {
  const { prep, templatesQ, varsQ, templates, templateName, form, set, setSource, setValue, chooseTemplate, variables, values, emptyVars, issues } = draft;
  const data = prep.data;
  const id = (s: string) => `${idPrefix}-${s}`;

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

  const sources = data.sources;
  const groups = Array.from(new Set(sources.map((s) => s.group)));
  const selectValue = (src: string) => (src.startsWith('texto:') ? 'texto:' : src);
  const contact = data.contact;
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

      {issues.filter((i) => i.kind === 'block').map((i) => (
        <p key={i.text} role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-500/30 dark:bg-red-900/15 dark:text-red-300">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" /> {i.text}
        </p>
      ))}

      {/* Documento */}
      <section className="space-y-3" aria-labelledby={id('doc-h')}>
        <h4 id={id('doc-h')} className={SECTION}>
          Documento
        </h4>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor={id('tpl')} className={LABEL}>
              Modelo da ZapSign
            </label>
            <NativeSelect id={id('tpl')} className={FIELD} value={form.templateToken} onChange={(e) => chooseTemplate(e.target.value)}>
              <option value="">{templatesQ.isLoading ? 'Carregando...' : 'Escolha o modelo'}</option>
              {templates.map((t) => (
                <option key={t.token} value={t.token}>
                  {t.name}
                </option>
              ))}
            </NativeSelect>
            {templatesQ.error ? <p className="mt-1 text-[11px] text-red-600">{(templatesQ.error as Error).message}</p> : null}
          </div>
          <div>
            <label htmlFor={id('name')} className={LABEL}>
              Nome do documento
            </label>
            <input id={id('name')} className={FIELD} value={form.docName} onChange={(e) => set({ docName: e.target.value })} placeholder={`${templateName || 'Documento'} - ${contact.name || 'cliente'}`} maxLength={255} />
          </div>
        </div>
      </section>

      {/* O que vai no contrato */}
      {form.templateToken ? (
        <section className="space-y-2" aria-labelledby={id('vars-h')}>
          <div className="flex items-center justify-between gap-2">
            <h4 id={id('vars-h')} className={SECTION}>
              O que vai no contrato
            </h4>
            {variables.length > 0 ? (
              <span className={`text-[11px] font-semibold ${emptyVars.length ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                {emptyVars.length ? `${emptyVars.length} de ${variables.length} em branco` : `${variables.length} ${variables.length === 1 ? 'campo preenchido' : 'campos preenchidos'}`}
              </span>
            ) : null}
          </div>
          {varsQ.isLoading ? (
            <p className="inline-flex items-center gap-1.5 py-2 text-xs text-slate-500">
              <Loader2 size={12} className="animate-spin" aria-hidden="true" /> Lendo o modelo...
            </p>
          ) : varsQ.error ? (
            <p className="text-xs text-red-600">{(varsQ.error as Error).message}</p>
          ) : variables.length === 0 ? (
            <p className="rounded-lg bg-slate-50 dark:bg-white/5 px-3 py-2 text-xs text-slate-500">{varsQ.data?.note ?? 'Este modelo não tem variáveis entre chaves. O documento vai como está.'}</p>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-white/5 rounded-xl border border-slate-200 dark:border-white/10 px-3">
              {variables.map((name) => {
                const src = form.mapping[name] ?? '';
                const value = values[name] ?? '';
                const empty = !value.trim();
                const overridden = name in form.overrides;
                return (
                  <li key={name} className="py-2.5 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <label htmlFor={id(`v-${name}`)} className="inline-flex min-w-0 items-center gap-1.5 font-mono text-[11px] font-semibold text-slate-700 dark:text-slate-200">
                        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${empty ? 'bg-amber-500' : 'bg-emerald-500'}`} aria-hidden="true" />
                        <span className="truncate">{name}</span>
                      </label>
                      <span className="flex shrink-0 items-center gap-1.5">
                        {overridden ? (
                          <button type="button" onClick={() => setValue(name, null)} className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500 hover:text-primary-600 dark:text-slate-400" title="Voltar ao valor do CRM">
                            <RotateCcw size={11} aria-hidden="true" /> Restaurar
                          </button>
                        ) : null}
                        <NativeSelect
                          aria-label={`De onde vem ${name}`}
                          className="max-w-[190px] rounded-md border border-transparent bg-slate-100 dark:bg-white/10 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:border-slate-300 dark:hover:border-white/20 focus:ring-2 focus:ring-primary-500/30 outline-none"
                          value={selectValue(src)}
                          onChange={(e) => setSource(name, e.target.value === 'texto:' ? 'texto:' : e.target.value)}
                        >
                          <option value="">Em branco</option>
                          <option value="texto:">Texto fixo</option>
                          {groups.map((g) => (
                            <optgroup key={g} label={g}>
                              {sources
                                .filter((s) => s.group === g)
                                .map((s) => (
                                  <option key={s.value} value={s.value}>
                                    {s.label}
                                  </option>
                                ))}
                            </optgroup>
                          ))}
                        </NativeSelect>
                      </span>
                    </div>
                    {src.startsWith('texto:') ? (
                      <input
                        id={id(`v-${name}`)}
                        type="text"
                        className={`${FIELD} ${empty ? 'border-amber-300 dark:border-amber-500/40' : ''}`}
                        value={src.slice(6)}
                        placeholder="Texto que vai no documento"
                        onChange={(e) => setSource(name, `texto:${e.target.value}`)}
                      />
                    ) : (
                      <input
                        id={id(`v-${name}`)}
                        type="text"
                        className={`${FIELD} ${empty ? 'border-amber-300 dark:border-amber-500/40' : ''} ${overridden ? 'bg-primary-50/40 dark:bg-primary-500/5' : ''}`}
                        value={value}
                        placeholder={src ? 'vazio no CRM: digite aqui ou preencha o lead' : 'vai em branco'}
                        onChange={(e) => setValue(name, e.target.value)}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {emptyVars.length > 0 ? (
            <label className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-900/15 dark:text-amber-200">
              <input type="checkbox" className="mt-0.5 h-3.5 w-3.5 accent-amber-600" checked={form.allowEmpty} onChange={(e) => set({ allowEmpty: e.target.checked })} />
              <span>
                <b>{emptyVars.length === 1 ? '1 campo vai em branco' : `${emptyVars.length} campos vão em branco`}</b> ({emptyVars.join(', ')}). Marque para enviar assim mesmo, ou preencha acima.
              </span>
            </label>
          ) : null}
        </section>
      ) : null}

      {/* Envio */}
      <section className="space-y-3" aria-labelledby={id('send-h')}>
        <h4 id={id('send-h')} className={SECTION}>
          Envio e assinatura
        </h4>
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
            <p className="mt-1 text-[11px] text-slate-500">{SEND_OPTIONS.find((o) => o.value === form.send)?.hint}</p>
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
        {issues.filter((i) => i.kind === 'warn').map((i) => (
          <p key={i.text} className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-900/15 dark:text-amber-200">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" /> {i.text}
          </p>
        ))}
      </section>
    </fieldset>
  );
}

export default SignatureFields;
