'use client';

/**
 * Modal "Preencher as variáveis do modelo" da configuração da etapa
 * (Automatizar): para cada {{VARIÁVEL}} do DOCX, de onde vem o valor no CRM
 * (dado do contato ou do negócio, campo personalizado, texto fixo ou em
 * branco). Abre sozinho quando o administrador escolhe o modelo.
 */
import React from 'react';
import { Check, FileSignature, Loader2 } from 'lucide-react';
import { NativeSelect } from '@/components/ui/NativeSelect';
import type { SourceOption } from '@/lib/zapsign/variables';
import { FillModal, FILL_PRIMARY_BTN } from './FillModal';

const FIELD = 'w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-900 dark:text-white placeholder:text-slate-400 focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500 outline-none';

export function mappingSummary(variables: string[], mapping: Record<string, string>): { total: number; linked: number; empty: number; text: string } {
  const total = variables.length;
  const empty = variables.filter((v) => !(mapping[v] ?? '').trim() || mapping[v] === 'texto:').length;
  const linked = total - empty;
  const text = total === 0 ? 'Sem variáveis' : empty === 0 ? `${linked} ${linked === 1 ? 'variável preenchida' : 'variáveis preenchidas'}` : `${linked} ${linked === 1 ? 'preenchida' : 'preenchidas'}, ${empty} em branco`;
  return { total, linked, empty, text };
}

export function VariableMappingModal({
  open,
  onClose,
  templateName,
  variables,
  mapping,
  onChange,
  sources,
  loading,
  error,
  note,
  idPrefix,
}: {
  open: boolean;
  onClose: () => void;
  templateName: string;
  variables: string[];
  mapping: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  sources: SourceOption[];
  loading?: boolean;
  error?: string | null;
  note?: string | null;
  idPrefix: string;
}) {
  const groups = Array.from(new Set(sources.map((s) => s.group)));
  const selectValue = (src: string) => (src.startsWith('texto:') ? 'texto:' : src);
  const summary = mappingSummary(variables, mapping);
  const label = (value: string) => (value.startsWith('texto:') ? 'Texto fixo' : (sources.find((s) => s.value === value)?.label ?? 'Em branco'));
  return (
    <FillModal
      open={open}
      onClose={onClose}
      title="Preencher as variáveis do modelo"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className={`text-xs font-semibold ${summary.empty ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>{summary.text}</p>
          <button type="button" onClick={onClose} className={FILL_PRIMARY_BTN}>
            <Check size={14} aria-hidden="true" /> Concluir
          </button>
        </div>
      }
    >
      <div className="flex items-start gap-3 rounded-xl bg-primary-50 dark:bg-primary-900/20 p-3.5">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/80 dark:bg-white/10 text-primary-600 dark:text-primary-300">
          <FileSignature size={16} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">{templateName || 'Modelo da ZapSign'}</p>
          <p className="mt-0.5 text-xs text-primary-800 dark:text-primary-200">Diga de onde vem cada variável do documento. O CRM já sugeriu o que reconheceu pelo nome; o que ficar em branco pode ser preenchido na hora do envio.</p>
        </div>
      </div>
      {loading ? (
        <p className="inline-flex items-center gap-1.5 py-2 text-xs text-slate-500">
          <Loader2 size={12} className="animate-spin" aria-hidden="true" /> Lendo o modelo...
        </p>
      ) : error ? (
        <p className="text-xs text-red-600">{error}</p>
      ) : variables.length === 0 ? (
        <p className="rounded-lg bg-slate-50 dark:bg-white/5 px-3 py-2 text-xs text-slate-500">{note ?? 'Este modelo não tem variáveis entre chaves. O documento vai como está.'}</p>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-white/5 rounded-xl border border-slate-200 dark:border-white/10 px-3">
          {variables.map((name, index) => {
            const src = mapping[name] ?? '';
            const empty = !src.trim() || src === 'texto:';
            return (
              <li key={name} className="py-2.5 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <label htmlFor={`${idPrefix}-${name}`} className="inline-flex min-w-0 items-center gap-1.5 font-mono text-[11px] font-semibold text-slate-700 dark:text-slate-200">
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${empty ? 'bg-amber-500' : 'bg-emerald-500'}`} aria-hidden="true" />
                    <span className="truncate">{name}</span>
                  </label>
                  <span className="shrink-0 text-[11px] text-slate-400">{empty ? 'em branco' : label(src)}</span>
                </div>
                <NativeSelect
                  id={`${idPrefix}-${name}`}
                  aria-label={`Origem de ${name}`}
                  autoFocus={index === 0}
                  className={`${FIELD} ${empty ? 'border-amber-300 dark:border-amber-500/40' : ''}`}
                  value={selectValue(src)}
                  onChange={(e) => onChange({ ...mapping, [name]: e.target.value === 'texto:' ? 'texto:' : e.target.value })}
                >
                  <option value="">Deixar em branco (preencher na hora do envio)</option>
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
                {src.startsWith('texto:') ? (
                  <input
                    type="text"
                    aria-label={`Texto fixo de ${name}`}
                    className={FIELD}
                    value={src.slice(6)}
                    placeholder="Texto que vai no documento"
                    onChange={(e) => onChange({ ...mapping, [name]: `texto:${e.target.value}` })}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </FillModal>
  );
}

export default VariableMappingModal;
