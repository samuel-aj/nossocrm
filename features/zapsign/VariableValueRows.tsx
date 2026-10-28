'use client';

/**
 * Linhas "o que vai no contrato" de um envio: para cada variável do modelo, o
 * valor que vai para o documento (editável) e, discreto ao lado, de onde ele
 * vem no CRM. Campos em branco ficam marcados e pedem confirmação para enviar.
 * Usado inline (modal de conferência ao mudar de etapa) e dentro do modal de
 * preenchimento da aba Contrato.
 */
import React from 'react';
import { Loader2, RotateCcw } from 'lucide-react';
import { NativeSelect } from '@/components/ui/NativeSelect';
import type { SignatureDraft } from './useSignatureDraft';

const FIELD =
  'w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-900 dark:text-white placeholder:text-slate-400 focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500 outline-none disabled:opacity-60';

export function VariableValueRows({ draft, idPrefix, autoFocusFirst }: { draft: SignatureDraft; idPrefix: string; autoFocusFirst?: boolean }) {
  const { prep, varsQ, form, set, setSource, setValue, variables, values, emptyVars } = draft;
  const data = prep.data;
  if (!data) return null;
  const id = (s: string) => `${idPrefix}-${s}`;
  const sources = data.sources;
  const groups = Array.from(new Set(sources.map((s) => s.group)));
  const selectValue = (src: string) => (src.startsWith('texto:') ? 'texto:' : src);

  if (varsQ.isLoading) {
    return (
      <p className="inline-flex items-center gap-1.5 py-2 text-xs text-slate-500">
        <Loader2 size={12} className="animate-spin" aria-hidden="true" /> Lendo o modelo...
      </p>
    );
  }
  if (varsQ.error) return <p className="text-xs text-red-600">{(varsQ.error as Error).message}</p>;
  if (variables.length === 0) {
    return <p className="rounded-lg bg-slate-50 dark:bg-white/5 px-3 py-2 text-xs text-slate-500">{varsQ.data?.note ?? 'Este modelo não tem variáveis entre chaves. O documento vai como está.'}</p>;
  }

  return (
    <div className="space-y-2">
      <ul className="divide-y divide-slate-100 dark:divide-white/5 rounded-xl border border-slate-200 dark:border-white/10 px-3">
        {variables.map((name, index) => {
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
                  autoFocus={autoFocusFirst && index === 0}
                  className={`${FIELD} ${empty ? 'border-amber-300 dark:border-amber-500/40' : ''}`}
                  value={src.slice(6)}
                  placeholder="Texto que vai no documento"
                  onChange={(e) => setSource(name, `texto:${e.target.value}`)}
                />
              ) : (
                <input
                  id={id(`v-${name}`)}
                  type="text"
                  autoFocus={autoFocusFirst && index === 0}
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
      {emptyVars.length > 0 ? (
        <label className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-900/15 dark:text-amber-200">
          <input type="checkbox" className="mt-0.5 h-3.5 w-3.5 accent-amber-600" checked={form.allowEmpty} onChange={(e) => set({ allowEmpty: e.target.checked })} />
          <span>
            <b>{emptyVars.length === 1 ? '1 campo vai em branco' : `${emptyVars.length} campos vão em branco`}</b> ({emptyVars.join(', ')}). Marque para enviar assim mesmo, ou preencha acima.
          </span>
        </label>
      ) : null}
    </div>
  );
}

/** Resumo curto do preenchimento, para o cartão que abre o modal. */
export function fillSummary(draft: SignatureDraft): { total: number; filled: number; empty: number; text: string } {
  const total = draft.variables.length;
  const empty = draft.emptyVars.length;
  const filled = total - empty;
  const text = total === 0 ? 'Sem variáveis' : empty === 0 ? `${filled} ${filled === 1 ? 'campo preenchido' : 'campos preenchidos'}` : `${filled} ${filled === 1 ? 'preenchido' : 'preenchidos'}, ${empty} em branco`;
  return { total, filled, empty, text };
}

export default VariableValueRows;
