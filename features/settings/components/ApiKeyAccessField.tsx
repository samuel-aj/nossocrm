import React, { useId } from 'react';
import { NativeSelect } from '@/components/ui/NativeSelect';
import { ACCESS_MODE_LABELS, API_KEY_ACCESS_MODES, type ApiKeyAccessMode } from '@/lib/apiKeys/accessModes';

export function ApiKeyAccessField({ value, onChange, disabled }: {
  value: ApiKeyAccessMode;
  onChange: (mode: ApiKeyAccessMode) => void;
  disabled: boolean;
}) {
  const id = useId();
  return (
    <div className="mb-3">
      <label htmlFor={id} className="mb-1 block text-sm font-semibold text-slate-800 dark:text-slate-100">
        Acesso da nova chave
      </label>
      <NativeSelect id={id} value={value} disabled={disabled}
        onChange={event => onChange(event.target.value as ApiKeyAccessMode)}
        className="w-full max-w-md rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-white/10 dark:bg-slate-900">
        {API_KEY_ACCESS_MODES.map(mode => <option key={mode} value={mode}>{ACCESS_MODE_LABELS[mode]}</option>)}
      </NativeSelect>
    </div>
  );
}
