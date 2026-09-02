'use client';

/** Bloco recolhido por padrão ("Configurações avançadas"), aberto por um clique. */
import React, { useId, useState } from 'react';
import { ChevronRight } from 'lucide-react';

export function Disclosure({
  label,
  defaultOpen = false,
  children,
  className,
}: {
  label: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();
  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={bodyId}
        className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-primary-600 dark:text-slate-400 dark:hover:text-primary-300 transition-colors"
      >
        <ChevronRight size={14} className={`transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden="true" />
        {label}
      </button>
      {open ? (
        <div id={bodyId} className="mt-3">
          {children}
        </div>
      ) : null}
    </div>
  );
}

export default Disclosure;
