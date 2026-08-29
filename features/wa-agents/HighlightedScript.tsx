'use client';

/**
 * Campo de texto do roteiro com as variáveis e marcadores DESTACADOS.
 *
 * A textarea continua sendo uma textarea de verdade (o arrastar e soltar dos
 * chips depende de selectionStart e caretPositionFromPoint): o destaque é uma
 * camada espelho atrás dela, com a mesma fonte, o mesmo padding e a mesma
 * largura, pintando só o fundo de cada token. O texto que se lê é o da
 * textarea, que fica transparente por cima.
 *
 * Cores: azul = variável do CRM, roxo = ação durante a conversa, verde = mídia,
 * âmbar = escrito como token mas sem correspondente (não vai puxar nada).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { splitPromptTokens, type KnownTokens, type TokenPart } from './tokens';

/**
 * Fonte/padding compartilhados pela textarea e pelo espelho: precisam bater exatamente.
 * No celular a regra global de app/globals.css força `font-size: 16px !important` em
 * input/select/textarea (evita o zoom do iOS) e não alcança o <pre>; por isso as duas
 * camadas usam text-base abaixo de 768px e text-xs a partir daí.
 */
const BOX_CLASS = 'px-3 py-2 text-base md:text-xs font-mono leading-relaxed';

const TOKEN_CLASS: Record<string, string> = {
  var: 'rounded bg-blue-200/70 dark:bg-blue-400/30',
  acao: 'rounded bg-purple-200/70 dark:bg-purple-400/30',
  midia: 'rounded bg-green-200/70 dark:bg-green-400/30',
  desconhecido: 'rounded bg-amber-200/80 dark:bg-amber-400/30 ring-1 ring-amber-500/70',
};

function tokenClass(part: TokenPart): string {
  if (part.kind === 'text') return '';
  return part.known ? TOKEN_CLASS[part.kind] : TOKEN_CLASS.desconhecido;
}

export type HighlightedScriptProps = {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  known: KnownTokens;
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>;
  rows?: number;
  maxLength?: number;
  placeholder?: string;
  ariaLabel?: string;
  /** classes extras do contêiner (ex.: altura mínima, anel de destaque) */
  className?: string;
  onDragOver?: React.DragEventHandler<HTMLTextAreaElement>;
  onDragEnter?: React.DragEventHandler<HTMLTextAreaElement>;
  onDragLeave?: React.DragEventHandler<HTMLTextAreaElement>;
  onDrop?: React.DragEventHandler<HTMLTextAreaElement>;
};

/**
 * Componente React `HighlightedScript`.
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export const HighlightedScript: React.FC<HighlightedScriptProps> = ({
  id,
  value,
  onChange,
  known,
  textareaRef,
  rows = 12,
  maxLength,
  placeholder,
  ariaLabel,
  className = '',
  onDragOver,
  onDragEnter,
  onDragLeave,
  onDrop,
}) => {
  const innerRef = useRef<HTMLTextAreaElement | null>(null);
  const ref = textareaRef ?? innerRef;
  const mirrorRef = useRef<HTMLPreElement | null>(null);
  // Largura/altura copiadas da textarea: com a mesma caixa, a quebra de linha do
  // espelho é idêntica (inclusive quando aparece a barra de rolagem).
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const medir = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);

  const sync = useCallback(() => {
    const el = ref.current;
    const mirror = mirrorRef.current;
    if (!el || !mirror) return;
    mirror.scrollTop = el.scrollTop;
    mirror.scrollLeft = el.scrollLeft;
  }, [ref]);

  useEffect(sync, [value, sync]);

  const parts = splitPromptTokens(value, known);

  return (
    <div
      className={`relative rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-slate-800 focus-within:ring-2 focus-within:ring-purple-500/20 focus-within:border-purple-500 ${className}`}
    >
      <pre
        ref={mirrorRef}
        aria-hidden="true"
        className={`${BOX_CLASS} absolute inset-0 m-0 overflow-hidden whitespace-pre-wrap break-words text-transparent select-none`}
        style={box ? { width: box.w, height: box.h } : undefined}
      >
        {parts.map((p, i) => (
          <span key={i} className={tokenClass(p)}>
            {p.text}
          </span>
        ))}
        {'\n'}
      </pre>
      <textarea
        ref={ref}
        id={id}
        className={`${BOX_CLASS} relative w-full bg-transparent border-0 outline-none resize-y whitespace-pre-wrap break-words text-slate-900 dark:text-white placeholder:text-slate-400`}
        rows={rows}
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        aria-label={ariaLabel}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        onScroll={sync}
        onDragOver={onDragOver}
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      />
    </div>
  );
};

export default HighlightedScript;
