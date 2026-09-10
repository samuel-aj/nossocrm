'use client';
import React, { useState } from 'react';
import * as Select from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';
import { useModalOverlay } from '@/components/ui/Modal';

export function RoleSelect({ label, value, onChange, options, placeholder = 'Selecione', disabled = false }: {
  label: string; value: string; onChange: (value: string) => void;
  options: { value: string; label: string }[]; placeholder?: string; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  useModalOverlay(open);
  return <Select.Root value={value} onValueChange={onChange} open={open} onOpenChange={setOpen} disabled={disabled}>
    <Select.Trigger aria-label={label} className="group flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-left text-sm text-slate-700 shadow-sm outline-none transition hover:border-primary-300 focus-visible:border-primary-500 focus-visible:ring-4 focus-visible:ring-primary-500/10 data-[state=open]:border-primary-400 data-[state=open]:ring-4 data-[state=open]:ring-primary-500/10 disabled:opacity-50 dark:border-white/15 dark:bg-slate-900 dark:text-slate-200 [&>span:first-child]:truncate">
      <Select.Value placeholder={placeholder} /><Select.Icon asChild><ChevronDown size={16} className="shrink-0 text-slate-400 transition-transform group-data-[state=open]:rotate-180" /></Select.Icon>
    </Select.Trigger>
    <Select.Portal>
      <Select.Content position="popper" sideOffset={6} collisionPadding={12} className="z-[10050] max-h-[min(320px,var(--radix-select-content-available-height))] w-[var(--radix-select-trigger-width)] overflow-hidden rounded-xl border border-slate-200 bg-white p-1.5 text-slate-700 shadow-xl dark:border-white/15 dark:bg-slate-900 dark:text-slate-200">
        <Select.Viewport>{options.map(option => <Select.Item key={option.value} value={option.value} className="relative flex min-h-11 cursor-pointer select-none items-center rounded-lg py-2.5 pl-3 pr-9 text-sm outline-none data-[highlighted]:bg-primary-50 data-[highlighted]:text-primary-700 data-[state=checked]:font-semibold dark:data-[highlighted]:bg-primary-500/15 dark:data-[highlighted]:text-primary-300">
          <Select.ItemText>{option.label}</Select.ItemText>
          <Select.ItemIndicator className="absolute right-3 text-primary-600 dark:text-primary-400"><Check size={16} /></Select.ItemIndicator>
        </Select.Item>)}</Select.Viewport>
      </Select.Content>
    </Select.Portal>
  </Select.Root>;
}

export function RoleCheckbox({ label, checked, onChange, disabled = false, children }: {
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
