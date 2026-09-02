'use client';

/**
 * Lista de "regras" em cartões compactos (ações durante a conversa, resultados
 * do encerramento): cada cartão mostra só o resumo; Editar abre a configuração
 * completa num modal; ações secundárias (mover, duplicar, excluir) ficam no
 * menu "...". Reordenar: arrastar pela alça (mouse) ou pelo menu (teclado e
 * celular).
 */
import React, { useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Copy, GripVertical, Pencil, Trash2 } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { BTN_PRIMARY, BTN_SMALL, KebabMenu, type KebabItem } from './ui';

/** Lista com o item `from` movido para a posição `to`. */
export function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return items;
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export type RuleCardContent = {
  icon: React.ReactNode;
  title: string;
  /** Linha "Quando: ..." (ou um aviso, quando faltar) */
  subtitle?: React.ReactNode;
  /** Chips do que acontece */
  body?: React.ReactNode;
  /** Itens extras do menu "..." (antes de mover/duplicar/excluir) */
  extraMenu?: KebabItem[];
};

export function RuleList<T>({
  items,
  onChange,
  keyOf,
  render,
  duplicate,
  onEdit,
  itemLabel,
  emptyText,
}: {
  items: T[];
  onChange: (items: T[]) => void;
  keyOf: (item: T, index: number) => string;
  render: (item: T, index: number) => RuleCardContent;
  /** Cópia de um item (com chave/nome ajustados); ausente = sem "Duplicar" */
  duplicate?: (item: T, items: T[]) => T;
  onEdit: (index: number) => void;
  /** "ação", "resultado" (para rótulos de acessibilidade) */
  itemLabel: string;
  emptyText: string;
}) {
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  // Só o arrasto iniciado na alça reordena (o texto do cartão continua selecionável)
  const armed = useRef(false);

  const finishDrag = () => {
    setDragFrom(null);
    setDragOver(null);
    armed.current = false;
  };

  if (items.length === 0) {
    return (
      <p className="text-sm text-slate-500 dark:text-slate-400 rounded-xl border border-dashed border-slate-200 dark:border-white/10 px-4 py-5 text-center">
        {emptyText}
      </p>
    );
  }

  return (
    <ul className="space-y-2" aria-label={`Lista de ${itemLabel}s`}>
      {items.map((item, index) => {
        const c = render(item, index);
        const menu: KebabItem[] = [
          ...(c.extraMenu ?? []),
          {
            label: 'Mover para cima',
            icon: <ArrowUp size={14} aria-hidden="true" />,
            disabled: index === 0,
            onSelect: () => onChange(moveItem(items, index, index - 1)),
          },
          {
            label: 'Mover para baixo',
            icon: <ArrowDown size={14} aria-hidden="true" />,
            disabled: index === items.length - 1,
            onSelect: () => onChange(moveItem(items, index, index + 1)),
          },
          ...(duplicate
            ? [
                {
                  label: 'Duplicar',
                  icon: <Copy size={14} aria-hidden="true" />,
                  onSelect: () => {
                    const copy = duplicate(item, items);
                    const next = [...items];
                    next.splice(index + 1, 0, copy);
                    onChange(next);
                  },
                },
              ]
            : []),
          {
            label: 'Excluir',
            icon: <Trash2 size={14} aria-hidden="true" />,
            danger: true,
            onSelect: () => onChange(items.filter((_, i) => i !== index)),
          },
        ];
        const isOver = dragOver === index && dragFrom !== null && dragFrom !== index;
        return (
          <li
            key={keyOf(item, index)}
            draggable
            onDragStart={(e) => {
              if (!armed.current) {
                e.preventDefault();
                return;
              }
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', String(index));
              setDragFrom(index);
            }}
            onDragOver={(e) => {
              if (dragFrom === null) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              if (dragOver !== index) setDragOver(index);
            }}
            onDrop={(e) => {
              if (dragFrom === null) return;
              e.preventDefault();
              onChange(moveItem(items, dragFrom, index));
              finishDrag();
            }}
            onDragEnd={finishDrag}
            className={`group relative flex items-start gap-2 rounded-xl border bg-white dark:bg-slate-900 p-3 transition-colors ${
              isOver
                ? 'border-purple-400 ring-2 ring-purple-500/20'
                : 'border-slate-200 dark:border-white/10 hover:border-slate-300 dark:hover:border-white/20'
            } ${dragFrom === index ? 'opacity-50' : ''}`}
          >
            <button
              type="button"
              aria-label={`Arrastar ${itemLabel} para reordenar`}
              title="Arrastar para reordenar"
              onPointerDown={() => {
                armed.current = true;
              }}
              onPointerUp={() => {
                armed.current = false;
              }}
              className="mt-1.5 -ml-1 shrink-0 cursor-grab active:cursor-grabbing text-slate-300 hover:text-slate-500 dark:text-slate-600 dark:hover:text-slate-300 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
            >
              <GripVertical size={14} aria-hidden="true" />
            </button>
            <span className="mt-0.5 p-1.5 rounded-lg bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 shrink-0">
              {c.icon}
            </span>
            <div className="flex-1 min-w-0 space-y-1">
              <button
                type="button"
                className="block w-full text-left rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-500/30"
                onClick={() => onEdit(index)}
                aria-label={`Editar ${itemLabel} ${c.title}`}
              >
                <span className="block text-sm font-semibold text-slate-900 dark:text-white truncate">{c.title}</span>
                {c.subtitle ? <span className="block text-xs text-slate-500 dark:text-slate-400 line-clamp-2">{c.subtitle}</span> : null}
              </button>
              {c.body ? <div className="pt-0.5">{c.body}</div> : null}
            </div>
            <div className="flex items-center gap-0.5 shrink-0">
              <button type="button" className={BTN_SMALL} onClick={() => onEdit(index)}>
                <Pencil size={13} aria-hidden="true" />
                Editar
              </button>
              <KebabMenu items={menu} label={`Mais ações: ${c.title}`} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Modal de configuração completa de uma regra; as alterações valem na hora. */
export function RuleEditorModal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Modal isOpen={open} onClose={onClose} title={title} size="xl" className="max-w-3xl">
      <div className="space-y-4">
        {children}
        <div className="flex justify-end pt-2 border-t border-slate-100 dark:border-white/5">
          <button type="button" className={BTN_PRIMARY} onClick={onClose}>
            Concluir
          </button>
        </div>
      </div>
    </Modal>
  );
}
