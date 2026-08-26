'use client';

/**
 * Paleta de passos: flutua sobre o quadro, no canto superior esquerdo (estilo
 * Typebot). Clique adiciona perto do centro da tela; arrastar solta o passo onde
 * o mouse largar. Em telas pequenas vira uma faixa horizontal no topo do quadro.
 */
import React from 'react';
import { NODE_META, toneClass } from './nodes';
import { DND_MIME, STEP_TYPES, type StepType } from './types';

export function Palette({ onAdd }: { onAdd: (type: StepType) => void }) {
  return (
    <aside
      aria-label="Passos disponíveis"
      className="absolute z-10 top-3 left-3 right-3 md:right-auto md:w-52 md:max-h-[calc(100%-1.5rem)] bg-white/95 dark:bg-slate-900/95 backdrop-blur border border-slate-200 dark:border-white/10 rounded-xl shadow-lg p-2 flex md:flex-col gap-1 overflow-x-auto md:overflow-x-hidden md:overflow-y-auto"
    >
      <p className="hidden md:block px-2 pt-1 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        Adicionar passo
      </p>
      {STEP_TYPES.map((type) => {
        const meta = NODE_META[type];
        const Icon = meta.icon;
        return (
          // div em vez de button: o Firefox não inicia o arrasto nativo a partir de <button draggable>.
          <div
            key={type}
            role="button"
            tabIndex={0}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(DND_MIME, type);
              e.dataTransfer.effectAllowed = 'move';
            }}
            onClick={() => onAdd(type)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onAdd(type);
              }
            }}
            title={`${meta.hint}. Clique para adicionar ou arraste para o quadro.`}
            className="shrink-0 inline-flex items-center gap-2 px-2.5 py-2 rounded-lg text-sm text-left text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10 cursor-grab active:cursor-grabbing select-none outline-none focus-visible:ring-2 focus-visible:ring-purple-500/40 transition-colors"
          >
            <span className={`p-1 rounded-md shrink-0 ${toneClass(meta.tone)}`} aria-hidden="true">
              <Icon size={14} />
            </span>
            <span className="whitespace-nowrap">{meta.label}</span>
          </div>
        );
      })}
      <p className="hidden md:block px-2 pt-2 text-[11px] leading-snug text-slate-400">
        Clique ou arraste para o quadro. Ligue uma saída (bolinha à direita) à entrada de outro passo (bolinha à
        esquerda). Cada saída aceita uma ligação: ligar de novo substitui a anterior. A saída "Então" do gatilho
        define o primeiro passo. Delete apaga o que estiver selecionado.
      </p>
    </aside>
  );
}

export default Palette;
