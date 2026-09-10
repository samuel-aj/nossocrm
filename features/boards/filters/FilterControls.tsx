import React from 'react';
import { FormSelect } from '@/components/ui/FormControls';

export const FILTER_PANEL = 'w-[min(420px,calc(100vw-24px))] max-h-[min(680px,var(--radix-popover-content-available-height))] overflow-y-auto scrollbar-custom rounded-2xl border border-slate-200 bg-white p-5 shadow-xl shadow-slate-900/10 dark:border-white/10 dark:bg-slate-900 dark:shadow-black/30 space-y-4';
export const FILTER_INPUT = 'min-h-11 min-w-0 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-700 shadow-sm outline-none transition hover:border-primary-300 focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 dark:border-white/15 dark:bg-slate-900 dark:text-slate-200';

export function FilterSelect({ label, value, onChange, options }: {
  label: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[];
}) {
  // Encode values so an empty "all" filter is a selectable Radix item.
  return <div className="min-w-0 flex-1"><FormSelect label={label} value={JSON.stringify(value)}
    onChange={encoded => onChange(JSON.parse(encoded) as string)}
    options={options.map(option => ({ ...option, value: JSON.stringify(option.value) }))} /></div>;
}
