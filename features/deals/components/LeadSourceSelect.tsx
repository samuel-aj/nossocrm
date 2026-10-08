'use client';

import React, { useId } from 'react';
import { NativeSelect } from '@/components/ui/NativeSelect';
import { useOrgPreferences } from '@/lib/query/hooks/useOrgPreferences';
import { normalizeLeadSource } from '@/lib/deals/leadSource';

type Props = {
  value: string | null | undefined;
  onChange: (value: string | null) => void;
  disabled?: boolean;
};

/** A removed category remains visible on its existing leads until explicitly changed. */
export function LeadSourceSelect({ value, onChange, disabled }: Props) {
  const id = useId();
  const { leadSourceOptions } = useOrgPreferences();
  const current = normalizeLeadSource(value);
  const options = Array.from(new Set(leadSourceOptions.map(normalizeLeadSource).filter((option): option is string => !!option)));
  if (current && !options.includes(current)) options.unshift(current);
  return (
    <div>
      <label htmlFor={id} className="block text-xs text-slate-500 mb-1">Origem do lead</label>
      <NativeSelect
        id={id}
        value={current ?? ''}
        disabled={disabled}
        onChange={event => onChange(normalizeLeadSource(event.target.value))}
        className="w-full rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 px-2 py-2 text-sm text-slate-900 dark:text-white disabled:opacity-60"
      >
        <option value="">Não informado</option>
        {options.map(option => <option key={option} value={option}>{option}</option>)}
      </NativeSelect>
    </div>
  );
}
