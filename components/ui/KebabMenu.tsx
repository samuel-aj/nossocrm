'use client';

/**
 * Menu "..." de ações secundárias (mover, duplicar, excluir, copiar...).
 * Renderiza num portal acima dos modais (z-[10000]). Compartilhado pelas
 * telas de Configurações, agentes de IA e editor de boards.
 */
import React from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { MoreHorizontal } from 'lucide-react';

export type KebabItem = {
  label: string;
  icon?: React.ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
};

export const KEBAB_TRIGGER_CLASS =
  'p-2 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-white dark:hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors';

export function KebabMenu({
  items,
  label = 'Mais ações',
  size = 16,
  className,
}: {
  items: KebabItem[];
  label?: string;
  size?: number;
  className?: string;
}) {
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <button type="button" className={className ?? KEBAB_TRIGGER_CLASS} aria-label={label} title="Mais ações">
          <MoreHorizontal size={size} aria-hidden="true" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          className="z-[10000] min-w-[11rem] rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 shadow-xl p-1 animate-in fade-in-0 zoom-in-95"
        >
          {items.map((it) => (
            <DropdownMenu.Item
              key={it.label}
              disabled={it.disabled}
              onSelect={() => it.onSelect()}
              className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-sm cursor-pointer outline-none select-none data-[disabled]:opacity-40 data-[disabled]:pointer-events-none ${
                it.danger
                  ? 'text-red-600 dark:text-red-400 data-[highlighted]:bg-red-50 dark:data-[highlighted]:bg-red-900/20'
                  : 'text-slate-700 dark:text-slate-200 data-[highlighted]:bg-slate-100 dark:data-[highlighted]:bg-white/10'
              }`}
            >
              {it.icon}
              {it.label}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export default KebabMenu;
