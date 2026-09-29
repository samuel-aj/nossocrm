'use client';
import React from 'react';
import { Check } from 'lucide-react';
import { NativeSelect } from '@/components/ui/NativeSelect';

export function FormSelect({ label, value, onChange, options, placeholder = 'Selecione', disabled = false, compact = false, searchable = false }: {
  label: string; value: string; onChange: (value: string) => void;
  options: { value: string; label: string; disabled?: boolean; group?: string }[]; placeholder?: string; disabled?: boolean; compact?: boolean; searchable?: boolean;
}) {
  const children: React.ReactNode[] = [];
  let currentGroup: string | undefined;
  let grouped: React.ReactNode[] = [];
  const flushGroup = () => {
    if (currentGroup) children.push(<optgroup key={`${currentGroup}:${children.length}`} label={currentGroup}>{grouped}</optgroup>);
    else children.push(...grouped);
    grouped = [];
  };
  for (const option of options) {
    if (option.group !== currentGroup) { flushGroup(); currentGroup = option.group; }
    grouped.push(<option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>);
  }
  flushGroup();
  return <NativeSelect aria-label={label} value={value} onChange={event => onChange(event.target.value)} disabled={disabled} searchable={searchable} placeholder={placeholder}
    className={compact ? 'w-full min-h-8 px-2 py-1 text-xs' : 'w-full min-h-11 rounded-xl px-3.5 py-2.5 shadow-sm'}>{children}</NativeSelect>;
}

export function FormCheckbox({ label, checked, onChange, disabled = false, children }: {
  label: string; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean; children: React.ReactNode;
}) {
  return <label className="group flex cursor-pointer items-center gap-2.5">
    <span className="relative flex h-5 w-5 shrink-0 items-center justify-center">
      <input type="checkbox" aria-label={label} checked={checked} onChange={e => onChange(e.target.checked)} disabled={disabled}
        className="peer h-5 w-5 cursor-pointer appearance-none rounded-md border border-slate-300 bg-white outline-none transition checked:border-primary-600 checked:bg-primary-600 hover:border-primary-400 focus-visible:ring-4 focus-visible:ring-primary-500/20 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:checked:border-primary-500 dark:checked:bg-primary-500" />
      <Check size={13} strokeWidth={3} aria-hidden="true" className="pointer-events-none absolute text-white opacity-0 peer-checked:opacity-100" />
    </span>{children}
  </label>;
}
