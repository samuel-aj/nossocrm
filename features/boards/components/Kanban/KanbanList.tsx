import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check, UserPlus } from 'lucide-react';
import { DealView, CustomFieldDefinition, BoardStage } from '@/types';
import { ActivityStatusIcon } from './ActivityStatusIcon';
import { OwnerBadge } from './OwnerBadge';
import { FocusTrap } from '@/lib/a11y/components/FocusTrap';
import type { DealActivityStatus } from '@/features/boards/utils/dealActivityStatus';

// Shared default for cards with no pending activities — same reference on
// every render so React.memo on KanbanListRow can skip re-renders.
export const NO_ACTIVITY_STATUS: DealActivityStatus = { kind: 'none', daysFromToday: 0, daysOverdue: 0 };

type QuickAddType = 'CALL' | 'MEETING' | 'EMAIL';

// Formatadores reaproveitados (instanciar Intl a cada linha é caro numa
// tabela grande). Valor redondo sai sem centavos ("R$ 10.000"); com centavos
// mostra os dois dígitos ("R$ 10.000,50"), nunca arredondando escondido.
const BRL_INTEIRO = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});
const BRL_CENTAVOS = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const DATA_COMPLETA = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
const DATA_CURTA = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });

/** Valor do negócio em real, no padrão do resto do CRM (era "$10 000"). */
const formatValor = (value: number): string => {
  if (!Number.isFinite(value)) return '-';
  return Number.isInteger(value) ? BRL_INTEIRO.format(value) : BRL_CENTAVOS.format(value);
};

/**
 * Data de criação enxuta: "Hoje", "Ontem", "Há 3 dias" e, a partir de uma
 * semana, a data curta. A data e a hora exatas ficam no title (tooltip), o
 * que libera a coluna e mantém a linha com uma altura só.
 */
const formatCriadoEm = (iso: string): { label: string; full: string } | null => {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const full = DATA_COMPLETA.format(d);

  const hoje = new Date();
  const inicioHoje = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate()).getTime();
  const inicioData = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dias = Math.floor((inicioHoje - inicioData) / 86_400_000);

  if (dias === 0) return { label: 'Hoje', full };
  if (dias === 1) return { label: 'Ontem', full };
  if (dias > 1 && dias < 7) return { label: `Há ${dias} dias`, full };
  return { label: DATA_CURTA.format(d), full };
};

/** Etiquetas ganham cor própria (estável por nome) pra dar de bater o olho e
 *  distinguir, em vez de um bloco cinza igual pra todas. */
const TAG_CORES = [
  'bg-indigo-50 text-indigo-700 ring-indigo-200/70 dark:bg-indigo-500/10 dark:text-indigo-300 dark:ring-indigo-400/20',
  'bg-emerald-50 text-emerald-700 ring-emerald-200/70 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-400/20',
  'bg-amber-50 text-amber-700 ring-amber-200/70 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-400/20',
  'bg-rose-50 text-rose-700 ring-rose-200/70 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-400/20',
  'bg-sky-50 text-sky-700 ring-sky-200/70 dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-400/20',
  'bg-violet-50 text-violet-700 ring-violet-200/70 dark:bg-violet-500/10 dark:text-violet-300 dark:ring-violet-400/20',
  'bg-teal-50 text-teal-700 ring-teal-200/70 dark:bg-teal-500/10 dark:text-teal-300 dark:ring-teal-400/20',
  'bg-orange-50 text-orange-700 ring-orange-200/70 dark:bg-orange-500/10 dark:text-orange-300 dark:ring-orange-400/20',
];
const corDaTag = (tag: string): string => {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) hash = (hash * 31 + tag.charCodeAt(i)) >>> 0;
  return TAG_CORES[hash % TAG_CORES.length];
};

/**
 * Posiciona um menu flutuante (React Portal) ancorado num botão-gatilho,
 * igual ao dropdown de agendar atividade (`ActivityStatusIcon`): nunca
 * clipa dentro do container com scroll da tabela, fecha ao clicar fora ou
 * apertar Esc, e reposiciona em resize/scroll.
 */
function useAnchoredMenu(open: boolean, onClose: () => void) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const MENU_WIDTH = 220;
    const MENU_MAX_HEIGHT = 280;
    const GAP = 4;
    const place = () => {
      const btn = triggerRef.current;
      if (!btn) return;
      const rect = btn.getBoundingClientRect();

      let left = rect.left;
      if (left + MENU_WIDTH > window.innerWidth - 8) left = window.innerWidth - 8 - MENU_WIDTH;
      if (left < 8) left = 8;

      const spaceBelow = window.innerHeight - rect.bottom;
      const openUpward = spaceBelow < MENU_MAX_HEIGHT + GAP;
      const top = openUpward ? rect.top - MENU_MAX_HEIGHT - GAP : rect.bottom + GAP;

      setPos({ top: Math.max(8, top), left });
    };
    place();

    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      onClose();
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleDown);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleDown);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open, onClose]);

  return { triggerRef, menuRef, pos };
}

type KanbanListRowProps = {
  deal: DealView;
  stageLabel: string;
  stages: BoardStage[];
  customFieldDefinitions: CustomFieldDefinition[];
  activityStatus: DealActivityStatus;
  isMenuOpen: boolean;
  /** Classe bg-* da etapa: filete à esquerda ligando a linha ao grupo dela. */
  accentColor?: string;
  onSelect: (dealId: string) => void;
  onToggleMenu: (e: React.MouseEvent, dealId: string) => void;
  onQuickAdd: (dealId: string, type: QuickAddType, dealTitle: string) => void;
  onCloseMenu: () => void;
  onMoveDealToStage?: (dealId: string, newStageId: string) => void;
  /** Estado do dropdown de estágio erguido pro pai (QualificationView): só
   *  um aberto por vez, igual ao menu de atividade — ver comentário lá. */
  isStageMenuOpen: boolean;
  onToggleStageMenu: (dealId: string) => void;
  onCloseStageMenu: () => void;
};

/** Padding padrão das células: linha mais densa que a antiga (px-6 py-3),
 *  sem o vão enorme que sobrava entre as colunas. */
const CELL = 'px-4 py-2.5 align-middle';

/**
 * Linha da lista de deals (usada pela QualificationView em todas as abas).
 * Performance: tabela pode ter muitas linhas.
 * `React.memo` + `isMenuOpen` por-linha evita re-render em massa ao alternar o menu.
 */
export const KanbanListRow = React.memo(function KanbanListRow({
  deal,
  stageLabel,
  stages,
  customFieldDefinitions,
  activityStatus,
  isMenuOpen,
  accentColor,
  onSelect,
  onToggleMenu,
  onQuickAdd,
  onCloseMenu,
  onMoveDealToStage,
  isStageMenuOpen,
  onToggleStageMenu,
  onCloseStageMenu,
}: KanbanListRowProps) {
  const { triggerRef: stageTriggerRef, menuRef: stageMenuRef, pos: stageMenuPos } = useAnchoredMenu(
    isStageMenuOpen,
    onCloseStageMenu
  );
  const criado = formatCriadoEm(deal.createdAt);
  const stageAtual = stages.find((s) => s.id === deal.status);

  // Ganho/perdido têm cor própria; em aberto, a pílula usa a bolinha da cor
  // da etapa (mesma cor do Kanban) sobre um fundo neutro.
  const stagePillClasses = deal.isWon
    ? 'bg-emerald-50 text-emerald-700 ring-emerald-200/70 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-400/20'
    : deal.isLost
      ? 'bg-rose-50 text-rose-700 ring-rose-200/70 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-400/20'
      : 'bg-slate-100/80 text-slate-700 ring-slate-200/70 dark:bg-white/[0.06] dark:text-slate-200 dark:ring-white/10';

  return (
    <tr
      onClick={() => onSelect(deal.id)}
      onKeyDown={(e) => {
        // Só quando a PRÓPRIA linha está focada: sem isso, o Enter que
        // escolhe uma etapa no dropdown (portal, mas que borbulha na
        // árvore do React) também abriria o card do lead.
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(deal.id);
        }
      }}
      tabIndex={0}
      aria-label={`Abrir ${deal.title}`}
      className="group cursor-pointer outline-none transition-colors hover:bg-primary-50/60 focus-visible:bg-primary-50/80 dark:hover:bg-white/[0.045] dark:focus-visible:bg-white/[0.06]"
    >
      <td className={`relative ${CELL} w-12`}>
        {accentColor ? (
          <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-[3px] ${accentColor}`} />
        ) : (
          // Filete que aparece no hover: dá o mesmo "trilho" das abas
          // agrupadas sem poluir a lista parada.
          <span
            aria-hidden="true"
            className="absolute inset-y-0 left-0 w-[3px] bg-primary-500 opacity-0 transition-opacity group-hover:opacity-100"
          />
        )}
        <div className="flex items-center justify-center">
          <ActivityStatusIcon
            status={activityStatus}
            dealId={deal.id}
            dealTitle={deal.title}
            isOpen={isMenuOpen}
            onToggle={(e) => onToggleMenu(e, deal.id)}
            onOpenSchedule={(type) => onQuickAdd(deal.id, type, deal.title)}
            onRequestClose={onCloseMenu}
          />
        </div>
      </td>

      <td className={CELL}>
        <span
          className="block truncate font-semibold text-slate-900 dark:text-white group-hover:text-primary-700 dark:group-hover:text-primary-300 transition-colors"
          title={deal.title}
        >
          {deal.title}
        </span>
        {deal.contactName ? (
          <span className="mt-0.5 block truncate text-xs text-slate-400 dark:text-slate-500">
            {deal.contactName}
          </span>
        ) : null}
      </td>

      <td className={CELL}>
        {deal.tags.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1">
            {deal.tags.slice(0, 2).map((tag, index) => (
              <span
                key={`${deal.id}-tag-${index}`}
                title={tag}
                className={`max-w-full truncate rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${corDaTag(tag)}`}
              >
                {tag}
              </span>
            ))}
            {deal.tags.length > 2 && (
              <span
                title={deal.tags.slice(2).join(', ')}
                className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500 ring-1 ring-inset ring-slate-200/70 dark:bg-white/[0.06] dark:text-slate-400 dark:ring-white/10"
              >
                +{deal.tags.length - 2}
              </span>
            )}
          </div>
        ) : (
          <span className="text-slate-300 dark:text-slate-600">—</span>
        )}
      </td>

      <td className={CELL}>
        {onMoveDealToStage ? (
          <>
            <button
              ref={stageTriggerRef}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleStageMenu(deal.id);
              }}
              aria-haspopup="listbox"
              aria-expanded={isStageMenuOpen}
              aria-label={`Estágio: ${stageLabel}. Clique para mudar.`}
              title="Mudar estágio"
              className={`inline-flex max-w-full items-center gap-1.5 rounded-full py-1 pl-2 pr-1.5 text-xs font-semibold ring-1 ring-inset transition-colors focus-visible-ring hover:brightness-[0.97] dark:hover:brightness-125 ${stagePillClasses}`}
            >
              {!deal.isWon && !deal.isLost && (
                <span
                  aria-hidden="true"
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${stageAtual?.color || 'bg-slate-400'}`}
                />
              )}
              <span className="truncate">{stageLabel}</span>
              <ChevronDown
                size={12}
                aria-hidden="true"
                className={`shrink-0 opacity-50 transition-transform ${isStageMenuOpen ? 'rotate-180' : ''}`}
              />
            </button>

            {isStageMenuOpen && stageMenuPos && typeof document !== 'undefined'
              ? createPortal(
                  <FocusTrap
                    active={isStageMenuOpen}
                    onEscape={onCloseStageMenu}
                    initialFocus={`#stage-opt-${deal.id}-${deal.status}`}
                    returnFocus
                  >
                    <div
                      ref={stageMenuRef}
                      role="listbox"
                      aria-label="Estágios disponíveis"
                      style={{ position: 'fixed', top: stageMenuPos.top, left: stageMenuPos.left, width: 220 }}
                      className="z-[9999] max-h-[280px] overflow-y-auto scrollbar-custom rounded-xl bg-white p-1.5 shadow-2xl ring-1 ring-slate-200 dark:bg-slate-800 dark:ring-white/10 animate-in fade-in zoom-in-95 duration-100"
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <p className="px-2 pb-1.5 pt-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">
                        Mover para
                      </p>
                      {stages.map((stage) => (
                        <button
                          key={stage.id}
                          id={`stage-opt-${deal.id}-${stage.id}`}
                          type="button"
                          role="option"
                          aria-selected={stage.id === deal.status}
                          onClick={() => {
                            if (stage.id !== deal.status) onMoveDealToStage(deal.id, stage.id);
                            onCloseStageMenu();
                          }}
                          className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm focus-visible-ring hover:bg-slate-100 dark:hover:bg-white/10 ${
                            stage.id === deal.status
                              ? 'bg-primary-500/10 font-semibold text-primary-600 dark:text-primary-300'
                              : 'text-slate-700 dark:text-slate-200'
                          }`}
                        >
                          <span
                            aria-hidden="true"
                            className={`h-2.5 w-2.5 shrink-0 rounded-full ${stage.color || 'bg-slate-500'}`}
                          />
                          <span className="flex-1 truncate">{stage.label}</span>
                          {stage.id === deal.status && <Check size={14} className="shrink-0" aria-hidden="true" />}
                        </button>
                      ))}
                    </div>
                  </FocusTrap>,
                  document.body
                )
              : null}
          </>
        ) : (
          <span
            className={`inline-flex max-w-full items-center gap-1.5 rounded-full px-2 py-1 text-xs font-semibold ring-1 ring-inset ${stagePillClasses}`}
          >
            {!deal.isWon && !deal.isLost && (
              <span
                aria-hidden="true"
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${stageAtual?.color || 'bg-slate-400'}`}
              />
            )}
            <span className="truncate">{stageLabel}</span>
          </span>
        )}
      </td>

      <td className={`${CELL} text-right`}>
        <span className="font-semibold tabular-nums text-slate-800 dark:text-slate-100">
          {formatValor(deal.value)}
        </span>
      </td>

      <td className={CELL}>
        {deal.ownerId ? (
          <OwnerBadge ownerId={deal.ownerId} showName />
        ) : (
          <span className="inline-flex items-center gap-1.5 text-xs text-slate-400 dark:text-slate-500">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-dashed border-slate-300 dark:border-slate-600">
              <UserPlus size={11} aria-hidden="true" />
            </span>
            Sem responsável
          </span>
        )}
      </td>

      <td className={CELL}>
        {criado ? (
          <span
            className="whitespace-nowrap text-xs tabular-nums text-slate-500 dark:text-slate-400"
            title={`Criado em ${criado.full}`}
          >
            {criado.label}
          </span>
        ) : (
          <span className="text-slate-300 dark:text-slate-600">—</span>
        )}
      </td>

      {/* Custom Fields Cells */}
      {customFieldDefinitions.map((field) => (
        <td key={field.id} className={`${CELL} text-right text-sm text-slate-600 dark:text-slate-300`}>
          {deal.customFields?.[field.key] || <span className="text-slate-300 dark:text-slate-600">—</span>}
        </td>
      ))}
    </tr>
  );
});
