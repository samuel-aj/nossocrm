'use client';

/**
 * Paleta de blocos: flutua sobre o quadro, no canto superior esquerdo (estilo
 * Typebot), recolhível para só ícones. Em telas estreitas vira uma barra
 * horizontal na parte de baixo do quadro. Clique adiciona ao balão selecionado
 * (ou cria um balão novo); arrastar solta o bloco onde o mouse largar: no
 * quadro (balão novo) ou sobre um balão (entra nele).
 */
import React from 'react';
import { ChevronDown, ChevronUp, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { BlockCatalog } from './catalog';
import type { StepType } from './types';

const SURFACE =
  'bg-white/95 dark:bg-slate-900/95 backdrop-blur border border-slate-200 dark:border-white/10 rounded-xl shadow-lg';
const TOGGLE =
  'p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:text-white dark:hover:bg-white/10 transition-colors';

export function Palette({
  onAdd,
  collapsed,
  onToggle,
}: {
  onAdd: (type: StepType) => void;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      {/* Desktop: coluna à esquerda, recolhível para só ícones */}
      <aside
        aria-label="Blocos disponíveis"
        className={`hidden md:flex absolute z-10 top-3 left-3 max-h-[calc(100%-1.5rem)] flex-col ${SURFACE} ${
          collapsed ? 'w-12 p-1.5' : 'w-52 p-2'
        }`}
      >
        <div className={`flex items-center ${collapsed ? 'justify-center' : 'justify-between px-2'} pb-1`}>
          {collapsed ? null : (
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Blocos</p>
          )}
          <button
            type="button"
            className={TOGGLE}
            onClick={onToggle}
            aria-label={collapsed ? 'Expandir a paleta' : 'Recolher a paleta'}
            title={collapsed ? 'Expandir a paleta' : 'Recolher a paleta'}
          >
            {collapsed ? <PanelLeftOpen size={16} aria-hidden="true" /> : <PanelLeftClose size={16} aria-hidden="true" />}
          </button>
        </div>
        <div className="min-h-0 overflow-y-auto overflow-x-hidden">
          <BlockCatalog onPick={onAdd} draggable iconsOnly={collapsed} />
        </div>
        {collapsed ? null : (
          <p className="px-2 pt-2 text-[11px] leading-snug text-slate-400">
            Clique para adicionar ao balão selecionado (ou criar um balão novo). Arraste para o quadro ou para dentro de
            um balão. Ligue uma saída (bolinha à direita) à entrada de outro balão (bolinha à esquerda); ligar de novo
            substitui a anterior.
          </p>
        )}
      </aside>

      {/* Celular: barra na parte de baixo, recolhível */}
      <div aria-label="Blocos disponíveis" className={`md:hidden absolute z-10 inset-x-2 bottom-2 ${SURFACE}`}>
        <div className="flex items-center justify-between px-2 pt-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Blocos</p>
          <button
            type="button"
            className={TOGGLE}
            onClick={onToggle}
            aria-label={collapsed ? 'Mostrar os blocos' : 'Esconder os blocos'}
            title={collapsed ? 'Mostrar os blocos' : 'Esconder os blocos'}
          >
            {collapsed ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
          </button>
        </div>
        {collapsed ? null : (
          <div className="overflow-x-auto px-1 pb-1">
            <BlockCatalog onPick={onAdd} horizontal />
          </div>
        )}
      </div>
    </>
  );
}

export default Palette;
