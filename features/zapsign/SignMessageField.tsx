'use client';

/**
 * Mensagem do WhatsApp que leva o link de assinatura, para quem não sabe
 * escrever variável: botões "+ Primeiro nome", "+ Link de assinatura"...
 * entram no ponto do cursor, e logo abaixo uma prévia mostra como o cliente
 * vai receber, com os dados de verdade (ou de exemplo, na etapa).
 *
 * Sem {{link}} no texto, o servidor põe o link no final; a prévia já mostra.
 */
import React, { useRef } from 'react';
import { Plus } from 'lucide-react';
import { renderTemplate } from '@/lib/wa-agents/template';
import { DEFAULT_SIGN_MESSAGE, SIGN_MESSAGE_VARS, firstName, hasSignLink, insertSignToken, signVarToken, splitSignMessage } from '@/lib/zapsign/message';
import { FIELD, LABEL } from './ui';

export type SignMessageSample = {
  /** nome do cliente (quem assina) */
  nome: string;
  /** nome do documento como vai ficar na ZapSign */
  documento: string;
  /** título do lead */
  titulo?: string;
};

type Props = {
  id: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  sample: SignMessageSample;
  /** título da prévia ("Assim o cliente recebe" na aba; "Exemplo" na etapa) */
  previewTitle?: string;
  /** observação curta abaixo (ex.: janela de 24 h da Meta) */
  note?: React.ReactNode;
  maxLength?: number;
};

const CHIP =
  'inline-flex items-center gap-0.5 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-700 transition-colors hover:border-primary-400 hover:text-primary-700 disabled:opacity-50 disabled:hover:border-slate-200 disabled:hover:text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:hover:border-primary-500/60 dark:hover:text-primary-300';

/** Nome do documento resolvido com os mesmos dados que o servidor usa. */
export function sampleDocName(docName: string, templateName: string, nome: string, titulo?: string): string {
  const raw = docName.trim() || `${templateName || 'Documento'} - {{contato.nome}}`;
  return renderTemplate(raw, { contato: { nome, primeiro_nome: firstName(nome) }, negocio: { titulo: titulo ?? '' } }).slice(0, 255);
}

export function SignMessageField({ id, value, onChange, disabled, sample, previewTitle = 'Assim o cliente recebe', note, maxLength = 1000 }: Props) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const caret = useRef<{ start: number; end: number } | null>(null);
  const remember = () => {
    const el = ref.current;
    if (el) caret.current = { start: el.selectionStart ?? el.value.length, end: el.selectionEnd ?? el.selectionStart ?? el.value.length };
  };
  const insert = (key: string) => {
    const el = ref.current;
    const pos = caret.current ?? { start: value.length, end: value.length };
    const { next, caret: at } = insertSignToken(value, signVarToken(key), pos.start, pos.end);
    if (next.length > maxLength) return;
    onChange(next);
    caret.current = { start: at, end: at };
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at, at);
    });
  };

  const text = value.trim() ? value : DEFAULT_SIGN_MESSAGE;
  const values: Record<string, string> = {
    nome: sample.nome,
    primeiro_nome: firstName(sample.nome),
    documento: sample.documento,
    'negocio.titulo': sample.titulo ?? '',
  };
  const parts = splitSignMessage(text);
  const linkMissing = !hasSignLink(text);

  return (
    <div>
      <label htmlFor={id} className={LABEL}>
        Mensagem no WhatsApp
      </label>
      <textarea
        ref={ref}
        id={id}
        className={`${FIELD} resize-y`}
        rows={3}
        maxLength={maxLength}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onSelect={remember}
        onKeyUp={remember}
        onBlur={remember}
      />
      <div role="group" aria-label="Inserir na mensagem" className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] text-slate-500 dark:text-slate-400">Inserir:</span>
        {SIGN_MESSAGE_VARS.map((v) => (
          <button key={v.key} type="button" className={CHIP} title={v.description} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={() => insert(v.key)}>
            <Plus size={11} aria-hidden="true" />
            {v.label}
          </button>
        ))}
      </div>
      <div className="mt-2 rounded-lg border border-emerald-200/70 bg-emerald-50/50 px-3 py-2 dark:border-emerald-500/20 dark:bg-emerald-900/10" aria-label={previewTitle}>
        <p className="mb-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700/80 dark:text-emerald-300/80">{previewTitle}</p>
        <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-slate-700 dark:text-slate-200">
          {parts.map((p, i) =>
            p.kind === 'text' ? (
              <React.Fragment key={i}>{p.text}</React.Fragment>
            ) : p.name === 'link' ? (
              <span key={i} className="rounded bg-sky-100 px-1 font-medium text-sky-800 dark:bg-sky-500/20 dark:text-sky-200">
                link de assinatura
              </span>
            ) : p.known ? (
              <span key={i} className="rounded-sm bg-emerald-100/80 font-medium text-emerald-900 dark:bg-emerald-500/20 dark:text-emerald-100">
                {values[p.name] || '…'}
              </span>
            ) : (
              <span key={i} className="rounded bg-amber-100 px-1 font-mono text-[11px] text-amber-800 dark:bg-amber-500/20 dark:text-amber-200" title="Variável que o CRM não conhece: vai em branco">
                {signVarToken(p.name)}
              </span>
            )
          )}
          {linkMissing ? (
            <>
              {'\n\n'}
              <span className="rounded bg-sky-100 px-1 font-medium text-sky-800 dark:bg-sky-500/20 dark:text-sky-200">link de assinatura</span>
            </>
          ) : null}
        </p>
        {linkMissing ? <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">A mensagem não tem o link, então ele vai no final.</p> : null}
      </div>
      {note ? <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{note}</p> : null}
    </div>
  );
}

export default SignMessageField;
