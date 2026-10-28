'use client';

/**
 * Modal "Preencher o contrato" da aba Contrato: abre quando a pessoa escolhe o
 * modelo (ou pelo botão do cartão de resumo) e mostra só o que vai no
 * documento, variável por variável, com o valor editável.
 */
import React from 'react';
import { Check, FileSignature } from 'lucide-react';
import { FillModal, FILL_PRIMARY_BTN } from './FillModal';
import { VariableValueRows, fillSummary } from './VariableValueRows';
import type { SignatureDraft } from './useSignatureDraft';

export function VariableValuesModal({ open, onClose, draft, idPrefix }: { open: boolean; onClose: () => void; draft: SignatureDraft; idPrefix: string }) {
  const summary = fillSummary(draft);
  const contact = draft.prep.data?.contact;
  const pending = summary.empty > 0 && !draft.form.allowEmpty;
  return (
    <FillModal
      open={open}
      onClose={onClose}
      title="Preencher o contrato"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className={`text-xs font-semibold ${summary.empty && !draft.form.allowEmpty ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>{summary.text}</p>
          <button type="button" onClick={onClose} className={FILL_PRIMARY_BTN} title={pending ? 'Ainda há campos em branco: preencha ou marque para enviar assim mesmo' : undefined}>
            <Check size={14} aria-hidden="true" /> {pending ? 'Fechar por enquanto' : 'Concluir'}
          </button>
        </div>
      }
    >
      <div className="flex items-start gap-3 rounded-xl bg-primary-50 dark:bg-primary-900/20 p-3.5">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/80 dark:bg-white/10 text-primary-600 dark:text-primary-300">
          <FileSignature size={16} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">{draft.templateName || 'Modelo da ZapSign'}</p>
          <p className="mt-0.5 text-xs text-primary-800 dark:text-primary-200">
            {contact?.name ? (
              <>
                Signatário: <b>{contact.name}</b>.{' '}
              </>
            ) : null}
            Cada campo abaixo entra no documento como está escrito. Ajuste o que precisar.
          </p>
        </div>
      </div>
      <VariableValueRows draft={draft} idPrefix={`${idPrefix}-m`} autoFocusFirst />
    </FillModal>
  );
}

export default VariableValuesModal;
