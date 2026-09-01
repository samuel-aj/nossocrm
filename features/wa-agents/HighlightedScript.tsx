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
import { caretIndexFromPoint, caretRectAt, indexFromPoint } from './caret';
import { splitPromptTokens, type KnownTokens, type TokenPart } from './tokens';
import { PROMPT_TOKEN_MIME, isPromptTokenDrag } from './ui';

/**
 * Fonte/padding compartilhados pela textarea e pelo espelho: precisam bater exatamente.
 * No celular a regra global de app/globals.css força `font-size: 16px !important` em
 * input/select/textarea (evita o zoom do iOS) e não alcança o <pre>; por isso as duas
 * camadas usam text-base abaixo de 768px e text-xs a partir daí.
 */
const BOX_CLASS = 'px-3 py-2 text-base md:text-xs font-mono leading-relaxed';

const TOKEN_CLASS: Record<string, string> = {
  var: 'rounded bg-blue-200/70 dark:bg-blue-400/30',
  iavar: 'rounded bg-fuchsia-200/70 dark:bg-fuchsia-400/30',
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
  /**
   * Chip solto no texto: `at` é a posição medida no espelho (undefined quando
   * não deu para medir; aí o chamador usa o cursor atual). Passar isto liga o
   * arrastar-e-soltar de tokens, com cursor próprio desenhado no ponto exato.
   */
  onInsertToken?: (token: string, at?: number) => void;
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
  onInsertToken,
}) => {
  const innerRef = useRef<HTMLTextAreaElement | null>(null);
  const ref = textareaRef ?? innerRef;
  const mirrorRef = useRef<HTMLPreElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  /** Arrasto de chip em andamento sobre o campo (pinta a borda) */
  const [dragging, setDragging] = useState(false);
  /** Onde o chip vai cair: índice no texto + a barrinha já medida, em coordenadas do contêiner */
  const [drop, setDrop] = useState<{ at: number; left: number; top: number; height: number } | null>(null);
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

  // ------------------------------------------------------------------ arrasto
  /** Posição sob o ponteiro: medida no espelho; se não der, pergunta ao navegador. */
  const posicaoDoPonto = (x: number, y: number): number | null => {
    const medida = indexFromPoint(mirrorRef.current, x, y);
    if (medida !== null) return medida;
    return ref.current ? caretIndexFromPoint(ref.current, x, y) : null;
  };

  const arrastando = !!onInsertToken;
  const temArquivos = (e: React.DragEvent) => Array.from(e.dataTransfer.types ?? []).includes('Files');

  /** Mede a barrinha do cursor para o índice `at` (só é chamada em evento, nunca na renderização). */
  const medirCaret = (at: number | null): { at: number; left: number; top: number; height: number } | null => {
    const mirror = mirrorRef.current;
    const box = boxRef.current;
    if (at === null || !mirror || !box) return null;
    const rect = caretRectAt(mirror, at);
    if (!rect) return null;
    const base = box.getBoundingClientRect();
    return { at, left: rect.left - base.left, top: rect.top - base.top, height: rect.height || 14 };
  };

  const limparArrasto = () => {
    setDragging(false);
    setDrop(null);
  };

  const handleDragOver = (e: React.DragEvent<HTMLTextAreaElement>) => {
    if (!arrastando) return;
    if (isPromptTokenDrag(e.dataTransfer.types)) {
      // Sem preventDefault o navegador recusa o drop
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setDragging(true);
      setDrop(medirCaret(posicaoDoPonto(e.clientX, e.clientY)));
      return;
    }
    // Arquivo solto aqui abriria no navegador: cancelamos. Texto comum segue o padrão.
    if (temArquivos(e)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'none';
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLTextAreaElement>) => {
    if (!arrastando) return;
    if (!isPromptTokenDrag(e.dataTransfer.types)) {
      if (temArquivos(e)) e.preventDefault();
      limparArrasto();
      return;
    }
    e.preventDefault();
    const token = (e.dataTransfer.getData(PROMPT_TOKEN_MIME) || e.dataTransfer.getData('text/plain')).trim();
    const at = posicaoDoPonto(e.clientX, e.clientY) ?? drop?.at ?? null;
    limparArrasto();
    if (token) onInsertToken?.(token, at ?? undefined);
  };

  return (
    <div
      ref={boxRef}
      className={`relative rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-slate-800 focus-within:ring-2 focus-within:ring-purple-500/20 focus-within:border-purple-500 ${
        dragging ? 'ring-2 ring-purple-500 border-purple-500' : ''
      } ${className}`}
    >
      {/*
        pointer-events-none é OBRIGATÓRIO: sem ele o espelho entra no teste de
        posição do navegador e rouba o cursor do arrastar — a barrinha de onde a
        variável vai cair some e o token acaba no fim do texto.
      */}
      <pre
        ref={mirrorRef}
        aria-hidden="true"
        data-token-mirror="true"
        className={`${BOX_CLASS} absolute inset-0 z-0 m-0 overflow-hidden whitespace-pre-wrap break-words text-transparent select-none pointer-events-none`}
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
        className={`${BOX_CLASS} relative z-10 w-full bg-transparent border-0 outline-none resize-y whitespace-pre-wrap break-words text-slate-900 dark:text-white placeholder:text-slate-400`}
        rows={rows}
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        aria-label={ariaLabel}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        onScroll={sync}
        onDragOver={handleDragOver}
        onDragLeave={limparArrasto}
        onDragEnd={limparArrasto}
        onDrop={handleDrop}
      />

      {/* Cursor de onde o chip vai cair: desenhado por nós, porque a barrinha
          nativa não aparece de forma confiável com a camada de destaque. */}
      {drop ? (
        <span
          aria-hidden="true"
          className="absolute z-20 w-0.5 rounded-full bg-purple-600 dark:bg-purple-400 pointer-events-none animate-pulse"
          style={{ left: drop.left, top: drop.top, height: drop.height }}
        />
      ) : null}
    </div>
  );
};

export default HighlightedScript;
