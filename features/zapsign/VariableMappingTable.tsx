'use client';

/**
 * Tabela "variável do modelo -> de onde vem no CRM", usada na regra da etapa e
 * no envio manual. Cada linha: nome da variável do DOCX, origem (campo do
 * lead/contato, campo personalizado, texto fixo ou em branco) e, quando há
 * prévia, o valor que vai para o documento (editável no envio manual).
 */
import React from 'react';
import { NativeSelect } from '@/components/ui/NativeSelect';
import type { SourceOption } from '@/lib/zapsign/variables';

const FIELD = 'w-full px-2.5 py-1.5 text-sm rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500 outline-none';

export function VariableMappingTable({
  variables,
  mapping,
  onChange,
  sources,
  preview,
  overrides,
  onOverride,
}: {
  variables: string[];
  mapping: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  sources: SourceOption[];
  /** origem -> valor resolvido para este lead (envio manual) */
  preview?: Record<string, string>;
  overrides?: Record<string, string>;
  onOverride?: (name: string, value: string | null) => void;
}) {
  if (variables.length === 0) return null;
  const groups = Array.from(new Set(sources.map((s) => s.group)));
  const selectValue = (src: string) => (src.startsWith('texto:') ? 'texto:' : src);
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-white/10">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 dark:bg-white/5 text-[11px] uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-3 py-2 text-left font-semibold">Variável no modelo</th>
            <th className="px-3 py-2 text-left font-semibold">De onde vem</th>
            {preview ? <th className="px-3 py-2 text-left font-semibold">Vai no documento</th> : null}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-white/5">
          {variables.map((name) => {
            const src = mapping[name] ?? '';
            const resolved = overrides && name in overrides ? overrides[name] : src.startsWith('texto:') ? src.slice(6) : (preview?.[src] ?? '');
            const empty = preview && !resolved.trim();
            return (
              <tr key={name}>
                <td className="px-3 py-2 align-top font-mono text-xs text-slate-700 dark:text-slate-200 whitespace-nowrap">{`{{${name}}}`}</td>
                <td className="px-3 py-2 align-top min-w-[220px]">
                  <NativeSelect
                    aria-label={`Origem de ${name}`}
                    className={FIELD}
                    value={selectValue(src)}
                    onChange={(e) => {
                      const v = e.target.value;
                      onChange({ ...mapping, [name]: v === 'texto:' ? 'texto:' : v });
                      onOverride?.(name, null);
                    }}
                  >
                    <option value="">Deixar em branco</option>
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
                      className={`${FIELD} mt-1`}
                      value={src.slice(6)}
                      placeholder="Texto que vai no documento"
                      onChange={(e) => onChange({ ...mapping, [name]: `texto:${e.target.value}` })}
                    />
                  ) : null}
                </td>
                {preview ? (
                  <td className="px-3 py-2 align-top min-w-[200px]">
                    {onOverride ? (
                      <input
                        type="text"
                        aria-label={`Valor de ${name}`}
                        className={`${FIELD} ${empty ? 'border-amber-300 dark:border-amber-500/40' : ''}`}
                        value={resolved}
                        placeholder="vazio"
                        onChange={(e) => onOverride(name, e.target.value)}
                      />
                    ) : (
                      <span className={empty ? 'text-amber-600 italic' : 'text-slate-700 dark:text-slate-200'}>{resolved || 'vazio'}</span>
                    )}
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default VariableMappingTable;
