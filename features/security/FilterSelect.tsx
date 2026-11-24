'use client';

import React from 'react';
import * as Select from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';

/**
 * Campo de filtro com rótulo embutido: [ícone Rótulo | valor ▾].
 *
 * `FilterField` é só a moldura (serve também para envolver o NativeSelect com
 * busca, usado na lista de organizações). `FilterSelect` é a lista suspensa
 * para poucas opções, com bolinha de cor e descrição em cada uma.
 */

export type FilterOption = {
  value: string;
  label: string;
  /** Linha menor abaixo do nome, dentro da lista. */
  description?: string;
  /** Classe de cor da bolinha (ex.: "bg-red-500"). */
  dot?: string;
};

export function FilterField({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="inline-flex items-stretch rounded-lg border border-slate-200 bg-white transition hover:border-primary-300 focus-within:border-primary-500 focus-within:ring-2 focus-within:ring-primary-500/20 dark:border-white/15 dark:bg-slate-900">
      <span className="flex items-center gap-1.5 rounded-l-lg border-r border-slate-200 bg-slate-50 px-2.5 text-xs font-medium text-slate-500 dark:border-white/10 dark:bg-white/5 dark:text-slate-400">
        {icon}
        {label}
      </span>
      {children}
    </div>
  );
}

export function FilterSelect({
  icon,
  label,
  value,
  onChange,
  options,
  widthClass = 'w-44',
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: FilterOption[];
  /** Largura fixa do valor, para o campo não mudar de tamanho ao trocar a opção. */
  widthClass?: string;
}) {
  const current = options.find(o => o.value === value);
  return (
    <FilterField icon={icon} label={label}>
      <Select.Root value={value} onValueChange={onChange}>
        <Select.Trigger
          aria-label={label}
          className={`group flex min-h-9 ${widthClass} items-center justify-between gap-2 rounded-r-lg px-3 py-1.5 text-left text-sm text-slate-800 outline-none dark:text-slate-100`}
        >
          <span className="flex min-w-0 items-center gap-2">
            {current?.dot && <span className={`h-2 w-2 shrink-0 rounded-full ${current.dot}`} aria-hidden="true" />}
            <span className="truncate">
              <Select.Value />
            </span>
          </span>
          <Select.Icon asChild>
            <ChevronDown size={15} className="shrink-0 text-slate-400 transition-transform group-data-[state=open]:rotate-180" />
          </Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Content
            position="popper"
            align="end"
            sideOffset={6}
            collisionPadding={12}
            className="z-[10050] min-w-[max(var(--radix-select-trigger-width),14rem)] max-w-[calc(100vw-24px)] overflow-hidden rounded-xl border border-slate-200 bg-white p-1.5 text-slate-800 shadow-xl dark:border-white/15 dark:bg-slate-900 dark:text-slate-100"
          >
            <Select.Viewport>
              {options.map(option => (
                <Select.Item
                  key={option.value}
                  value={option.value}
                  textValue={option.label}
                  className="relative flex cursor-pointer select-none items-start gap-2.5 rounded-lg py-2 pl-2.5 pr-8 text-sm outline-none data-[highlighted]:bg-primary-50 data-[state=checked]:font-semibold dark:data-[highlighted]:bg-primary-500/15"
                >
                  {option.dot && <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${option.dot}`} aria-hidden="true" />}
                  <span className="min-w-0">
                    <Select.ItemText>{option.label}</Select.ItemText>
                    {option.description && (
                      <span className="block text-xs font-normal text-slate-500 dark:text-slate-400">{option.description}</span>
                    )}
                  </span>
                  <Select.ItemIndicator className="absolute right-2 top-2.5 text-primary-600 dark:text-primary-400">
                    <Check size={15} />
                  </Select.ItemIndicator>
                </Select.Item>
              ))}
            </Select.Viewport>
          </Select.Content>
        </Select.Portal>
      </Select.Root>
    </FilterField>
  );
}
