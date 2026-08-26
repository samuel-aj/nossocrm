'use client';

/**
 * Editor do roteiro do agente: textarea grande + paleta de chips (variáveis,
 * ações durante a conversa e mídias). Cada chip pode ser clicado (insere no
 * cursor) ou arrastado até o ponto exato do texto (HTML5 drag and drop).
 *
 * A inserção em si fica com o editor pai (`onInsertToken`), que também é
 * chamado pelas outras abas ("Inserir no roteiro"); aqui só calculamos a
 * posição do cursor a partir do ponto onde o chip foi solto.
 */
import React, { useState } from 'react';
import { Braces, ListChecks, Paperclip, Image as ImageIcon, Film, Music, FileText, Info } from 'lucide-react';
import { PROMPT_VARIABLES } from '@/lib/wa-agents/catalog';
import { HELP_CLASS, Notice, TEXTAREA_CLASS, TokenChip } from './ui';

export type PromptPaletteAction = { key: string; label: string };
export type PromptPaletteMedia = { name: string; kind: 'image' | 'video' | 'audio' | 'document' };

export const PROMPT_MAX_LENGTH = 60000;

/** Marcador de ação durante a conversa no roteiro. */
export function actionToken(key: string): string {
  return `[[acao:${key}]]`;
}

/** Marcador de mídia no roteiro. */
export function mediaToken(name: string): string {
  return `[[midia:${name}]]`;
}

/**
 * Insere `token` em `value`, substituindo a seleção `start..end`, com um
 * espaço antes/depois quando o texto ao redor não tiver espaço.
 * Devolve o novo texto e a posição do cursor logo após o token.
 */
export function insertToken(value: string, token: string, start: number, end: number = start): { next: string; caret: number } {
  const s = Math.max(0, Math.min(start, value.length));
  const e = Math.max(s, Math.min(end, value.length));
  const before = value.slice(0, s);
  const after = value.slice(e);
  const needBefore = before.length > 0 && !/\s$/.test(before);
  const needAfter = after.length > 0 && !/^\s/.test(after);
  const inserted = `${needBefore ? ' ' : ''}${token}${needAfter ? ' ' : ''}`;
  return { next: before + inserted + after, caret: s + inserted.length };
}

type CaretPosition = { offsetNode: Node; offset: number };
type DocumentWithCaret = Document & {
  caretPositionFromPoint?: (x: number, y: number) => CaretPosition | null;
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
};

/**
 * Posição do cursor na textarea a partir de um ponto da tela
 * (`caretPositionFromPoint`, com `caretRangeFromPoint` como reserva).
 * Devolve null quando o navegador não sabe responder; o chamador usa o cursor atual.
 */
export function caretIndexFromPoint(el: HTMLTextAreaElement, x: number, y: number): number | null {
  const doc = el.ownerDocument as DocumentWithCaret;
  const clamp = (n: number) => Math.max(0, Math.min(n, el.value.length));
  if (typeof doc.caretPositionFromPoint === 'function') {
    const pos = doc.caretPositionFromPoint(x, y);
    // Firefox e Chrome novos devolvem a própria textarea como nó; alguns devolvem o nó de texto interno.
    if (pos && (pos.offsetNode === el || pos.offsetNode.nodeType === Node.TEXT_NODE)) return clamp(pos.offset);
  }
  if (typeof doc.caretRangeFromPoint === 'function') {
    const range = doc.caretRangeFromPoint(x, y);
    if (range && (range.startContainer === el || range.startContainer.nodeType === Node.TEXT_NODE)) {
      return clamp(range.startOffset);
    }
  }
  return null;
}

const MEDIA_ICONS: Record<PromptPaletteMedia['kind'], React.ReactNode> = {
  image: <ImageIcon size={12} aria-hidden="true" />,
  video: <Film size={12} aria-hidden="true" />,
  audio: <Music size={12} aria-hidden="true" />,
  document: <FileText size={12} aria-hidden="true" />,
};

function PaletteGroup({
  icon,
  title,
  help,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
        <span className="text-purple-600 dark:text-purple-400">{icon}</span>
        {title}
      </p>
      {help ? <p className="text-[11px] text-slate-500 dark:text-slate-400">{help}</p> : null}
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

/**
 * Componente React `PromptEditor`.
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export const PromptEditor: React.FC<{
  id?: string;
  value: string;
  onChange: (value: string) => void;
  /** Ref da textarea (o editor pai usa para inserir no cursor e focar) */
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  /** Insere um token no cursor atual ou na posição `at` (quando solto por arrasto) */
  onInsertToken: (token: string, at?: number) => void;
  actions: PromptPaletteAction[];
  media: PromptPaletteMedia[];
  /** Destaque temporário da textarea (após "Inserir no roteiro" de outra aba) */
  highlight?: boolean;
}> = ({ id = 'agent-system-prompt', value, onChange, textareaRef, onInsertToken, actions, media, highlight = false }) => {
  const [dragOver, setDragOver] = useState(false);

  const handleDrop = (e: React.DragEvent<HTMLTextAreaElement>) => {
    // Sempre cancela o padrão: um arquivo solto aqui não pode abrir no navegador.
    e.preventDefault();
    setDragOver(false);
    const token = e.dataTransfer.getData('text/plain').trim();
    if (!token) return;
    const el = e.currentTarget;
    const at = caretIndexFromPoint(el, e.clientX, e.clientY);
    onInsertToken(token, at ?? undefined);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_272px] gap-4">
      {/* Paleta: acima em telas pequenas, à direita nas grandes */}
      <aside className="lg:order-2 space-y-4 lg:sticky lg:top-4 self-start" aria-label="Paleta do roteiro">
        <p className={HELP_CLASS}>Clique para inserir no cursor ou arraste até o ponto certo do texto.</p>

        <PaletteGroup icon={<Braces size={14} aria-hidden="true" />} title="Variáveis">
          {PROMPT_VARIABLES.map((v) => (
            <TokenChip key={v.key} token={v.key} title={`${v.description} (${v.key})`} onInsert={onInsertToken} />
          ))}
        </PaletteGroup>

        <PaletteGroup
          icon={<ListChecks size={14} aria-hidden="true" />}
          title="Ações durante a conversa"
          help={
            actions.length === 0
              ? 'Crie ações na aba Ações para marcar no roteiro o momento exato em que acontecem.'
              : 'Marca o momento exato em que o agente executa a ação.'
          }
        >
          {actions.map((a) => (
            <TokenChip
              key={a.key}
              token={actionToken(a.key)}
              label={a.label || a.key}
              tone="purple"
              title={`Ação "${a.label}": ${actionToken(a.key)}`}
              onInsert={onInsertToken}
            />
          ))}
        </PaletteGroup>

        <PaletteGroup
          icon={<Paperclip size={14} aria-hidden="true" />}
          title="Mídias"
          help={
            media.length === 0
              ? 'Envie mídias na aba Conhecimento e mídias para marcar onde o agente as envia.'
              : 'Marca o momento em que o agente envia a mídia.'
          }
        >
          {media.map((m) => (
            <TokenChip
              key={m.name}
              token={mediaToken(m.name)}
              label={m.name}
              tone="green"
              icon={MEDIA_ICONS[m.kind]}
              title={`Mídia "${m.name}": ${mediaToken(m.name)}`}
              onInsert={onInsertToken}
            />
          ))}
        </PaletteGroup>
      </aside>

      <div className="lg:order-1 min-w-0 space-y-2">
        <textarea
          ref={textareaRef}
          id={id}
          className={`${TEXTAREA_CLASS} font-mono text-xs leading-relaxed min-h-[420px] transition-shadow ${
            dragOver
              ? 'ring-2 ring-purple-500 border-purple-500 bg-purple-50/60 dark:bg-purple-900/10'
              : highlight
                ? 'ring-2 ring-purple-400 border-purple-400'
                : ''
          }`}
          rows={26}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            if (!dragOver) setDragOver(true);
          }}
          onDragEnter={() => setDragOver(true)}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          aria-label="Roteiro do agente"
          maxLength={PROMPT_MAX_LENGTH}
          spellCheck={false}
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className={HELP_CLASS}>
            Lembrete: cada quebra de linha da resposta vira uma mensagem separada no WhatsApp. Uma ideia por linha, no
            máximo 3 linhas, nunca linhas em branco.
          </p>
          <p className="text-[11px] text-slate-400 tabular-nums" aria-live="polite">
            {value.length.toLocaleString('pt-BR')} / {PROMPT_MAX_LENGTH.toLocaleString('pt-BR')}
          </p>
        </div>
        <Notice tone="blue">
          <span className="flex items-start gap-2">
            <Info size={16} className="shrink-0 mt-0.5" aria-hidden="true" />
            <span>
              O CRM adiciona sozinho, sem você escrever: data e hora, nome e telefone do lead, dados do negócio (etapa,
              campos), histórico da conversa e os trechos da base de conhecimento.
            </span>
          </span>
        </Notice>
      </div>
    </div>
  );
};

export default PromptEditor;
