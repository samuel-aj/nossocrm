'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { usePathname } from 'next/navigation';
import { Wrench } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { FeedbackComposer } from './FeedbackComposer';

/** Abre a caixa de ajustes por cima da tela atual, levando o caminho da tela como contexto. */
export function ReportButton() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname() || '/';
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label="Reportar um ajuste"
        className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/10">
        <Wrench className="h-4 w-4" /><span className="max-md:hidden">Reportar</span>
      </button>
      {/* Portal: o cabeçalho usa backdrop-filter (classe glass), que prenderia o modal fixo dentro dele. */}
      {open && typeof document !== 'undefined' && createPortal(
        <Modal isOpen onClose={() => setOpen(false)} title="Reportar um ajuste">
          <FeedbackComposer screenPath={pathname} onSent={() => setOpen(false)} />
        </Modal>,
        document.body,
      )}
    </>
  );
}
