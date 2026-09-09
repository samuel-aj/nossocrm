import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check, UserPlus } from 'lucide-react';
import { DealView, CustomFieldDefinition, BoardStage } from '@/types';
import { ActivityStatusIcon } from './ActivityStatusIcon';
import { OwnerBadge } from './OwnerBadge';
import { FocusTrap } from '@/lib/a11y/components/FocusTrap';
import type { DealActivityStatus } from '@/features/boards/utils/dealActivityStatus';
import type { OrgMember } from '@/lib/query/hooks';

/** Iniciais do responsável nas opções do menu (o OwnerBadge tem as dele,
 *  mas não exporta o helper). */
const iniciais = (nome: string): string => {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return '?';
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
};

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
const HORA = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });
const DIA_MES = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' });
const DIA_MES_ANO = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });

/** Valor do negócio em real, no padrão do resto do CRM (era "$10 000"). */
const formatValor = (value: number): string => {
  if (!Number.isFinite(value)) return '-';
  return Number.isInteger(value) ? BRL_INTEIRO.format(value) : BRL_CENTAVOS.format(value);
};

/**
 * Data + hora numa linha só, no mesmo formato do card do Kanban
 * (`rotuloChegada` em DealCard.tsx): "Hoje - 14:32", "Ontem - 09:15",
 * "12/08 - 18:40". A data completa fica no title (tooltip).
 *
 * Diferença proposital do card: aqui o ANO entra quando o lead é de outro
 * ano ("12/08/25 - 18:40"). Numa coluna ordenável, dois leads de agostos
 * diferentes apareceriam idênticos; no card, que mostra um lead por vez,
 * isso não acontece.
 */
const formatCriadoEm = (iso: string): { label: string; full: string } | null => {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const full = DATA_COMPLETA.format(d);
  const hora = HORA.format(d);

  const hoje = new Date();
  const inicioHoje = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate()).getTime();
  const inicioData = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  // Math.round (e não floor): em fuso com horário de verão o dia da virada
  // tem 23h, e o floor comeria um dia na conta.
  const dias = Math.round((inicioHoje - inicioData) / 86_400_000);

  const data =
    dias === 0
      ? 'Hoje'
      : dias === 1
        ? 'Ontem'
        : d.getFullYear() === hoje.getFullYear()
          ? DIA_MES.format(d)
          : DIA_MES_ANO.format(d);

  return { label: `${data} - ${hora}`, full };
};

/** Linguagem única de selo pra tabela inteira: mesmo raio, mesma altura e
 *  mesma tipografia em Tag e Estágio. Cor aleatória por etiqueta deixava a
 *  tabela com cara de confete; a cor agora só aparece onde SIGNIFICA algo
 *  (a etapa do funil, ganho e perdido). */
const PILL_BASE =
  'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-semibold leading-none ring-1 ring-inset';
const PILL_NEUTRO =
  'bg-primary-50 text-primary-700 ring-primary-100 dark:bg-primary-500/10 dark:text-primary-300 dark:ring-primary-400/20';

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
  /** TAGS pela própria célula da lista (adicionar/remover num dropdown, como
   *  o estágio e o responsável). `canEditTags` false = célula só de leitura. */
  canEditTags: boolean;
  tagSuggestions: string[];
  isTagsMenuOpen: boolean;
  onToggleTagsMenu: (dealId: string) => void;
  onCloseTagsMenu: () => void;
  onChangeTags: (dealId: string, tags: string[]) => void;
  /** Trocar responsável pela lista. `canAssignOwner` false (vendedor) deixa
   *  a célula só de leitura, mesma regra do card do lead. */
  canAssignOwner: boolean;
  assignableMembers: OrgMember[];
  isOwnerMenuOpen: boolean;
  onToggleOwnerMenu: (dealId: string) => void;
  onCloseOwnerMenu: () => void;
  onChangeOwner: (dealId: string, ownerId: string) => void;
  /** Divisória no topo da linha, usada nas abas AGRUPADAS (a aba Todos usa
   *  o divide-y do tbody). Ela pula a primeira célula de propósito: assim a
   *  faixa colorida da etapa desce inteira, ligando o grupo, em vez de ser
   *  cortada por um filete a cada lead. */
  showDivider?: boolean;
  /** Seleção em massa ("Selecionar vários"): checkbox no início da linha e o
   *  clique passa a marcar/desmarcar em vez de abrir o lead — mesma mecânica
   *  do card do kanban. */
  selectionMode?: boolean;
  selected?: boolean;
  onToggleSelect?: (dealId: string) => void;
};

/** Padding padrão das células. py-3 dá a mesma altura de linha com e sem a
 *  segunda linha (contato), mantendo o ritmo vertical parelho. */
const CELL = 'px-4 py-3 align-middle';

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
  canAssignOwner,
  assignableMembers,
  isOwnerMenuOpen,
  onToggleOwnerMenu,
  onCloseOwnerMenu,
  onChangeOwner,
  canEditTags,
  tagSuggestions,
  isTagsMenuOpen,
  onToggleTagsMenu,
  onCloseTagsMenu,
  onChangeTags,
  showDivider = false,
  selectionMode = false,
  selected = false,
  onToggleSelect,
}: KanbanListRowProps) {
  // Mesma cor/espessura da divisória da aba Todos (divide-slate-200) e, como
  // lá, atravessando a linha INTEIRA — inclusive a célula do alerta. A faixa
  // colorida da etapa é um span posicionado dentro da célula, então ela é
  // pintada por cima do filete e continua descendo sem corte.
  const DIVISORIA = showDivider ? ' border-t border-slate-200 dark:border-white/10' : '';
  const CELULA = CELL + DIVISORIA;
  const CELULA_ALERTA = 'relative px-2 py-3 align-middle' + DIVISORIA;
  const { triggerRef: stageTriggerRef, menuRef: stageMenuRef, pos: stageMenuPos } = useAnchoredMenu(
    isStageMenuOpen,
    onCloseStageMenu
  );
  const { triggerRef: ownerTriggerRef, menuRef: ownerMenuRef, pos: ownerMenuPos } = useAnchoredMenu(
    isOwnerMenuOpen,
    onCloseOwnerMenu
  );
  const { triggerRef: tagsTriggerRef, menuRef: tagsMenuRef, pos: tagsMenuPos } = useAnchoredMenu(
    isTagsMenuOpen,
    onCloseTagsMenu
  );
  // Campo "nova tag" do dropdown de tags (limpo ao fechar/abrir o menu)
  const [novaTag, setNovaTag] = useState('');
  useEffect(() => {
    if (!isTagsMenuOpen) setNovaTag('');
  }, [isTagsMenuOpen]);

  // Marca/desmarca uma tag do lead (sem duplicar; comparação sem maiúsculas)
  const alternarTag = (tag: string) => {
    const chave = tag.toLowerCase();
    const tem = deal.tags.some((t) => t.toLowerCase() === chave);
    onChangeTags(
      deal.id,
      tem ? deal.tags.filter((t) => t.toLowerCase() !== chave) : [...deal.tags, tag]
    );
  };

  const adicionarNovaTag = () => {
    const t = novaTag.trim();
    if (!t) return;
    if (!deal.tags.some((x) => x.toLowerCase() === t.toLowerCase())) {
      onChangeTags(deal.id, [...deal.tags, t]);
    }
    setNovaTag('');
  };

  // Opções do menu: tags do quadro + as do próprio lead, sem repetidas
  const opcoesDeTags = React.useMemo(() => {
    const vistas = new Set<string>();
    const lista: string[] = [];
    for (const t of [...deal.tags, ...tagSuggestions]) {
      const chave = t.toLowerCase();
      if (!vistas.has(chave)) {
        vistas.add(chave);
        lista.push(t);
      }
    }
    return lista.sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [deal.tags, tagSuggestions]);
  const criado = formatCriadoEm(deal.createdAt);
  const stageAtual = stages.find((s) => s.id === deal.status);

  // Ganho/perdido têm cor própria; em aberto, a pílula usa a bolinha da cor
  // da etapa (mesma cor do Kanban) sobre um fundo neutro.
  const stagePillClasses = deal.isWon
    ? 'bg-emerald-50 text-emerald-700 ring-emerald-200/70 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-400/20'
    : deal.isLost
      ? 'bg-rose-50 text-rose-700 ring-rose-200/70 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-400/20'
      : 'bg-slate-50 text-slate-700 ring-slate-200 dark:bg-white/[0.06] dark:text-slate-200 dark:ring-white/10';

  // No modo seleção, o clique/Enter na linha marca/desmarca em vez de abrir
  // o lead — mesma mecânica do card do kanban.
  const acionarLinha = () => {
    if (selectionMode) onToggleSelect?.(deal.id);
    else onSelect(deal.id);
  };

  return (
    <tr
      onClick={acionarLinha}
      onKeyDown={(e) => {
        // Só quando a PRÓPRIA linha está focada: sem isso, o Enter que
        // escolhe uma etapa no dropdown (portal, mas que borbulha na
        // árvore do React) também abriria o card do lead.
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          acionarLinha();
        }
      }}
      tabIndex={0}
      aria-label={selectionMode ? `Selecionar ${deal.title}` : `Abrir ${deal.title}`}
      aria-selected={selectionMode ? selected : undefined}
      className={`group cursor-pointer transition-colors focus-visible-ring hover:bg-primary-50/60 focus-visible:bg-primary-50/80 dark:hover:bg-white/[0.045] dark:focus-visible:bg-white/[0.06] ${
        selected ? 'bg-primary-50/80 dark:bg-primary-500/10' : ''
      }`}
    >
      {/* Checkbox de seleção múltipla: primeira célula, só no modo seleção.
          A faixa colorida da etapa (accentColor) muda pra cá — ela vive na
          PRIMEIRA célula da linha pra descer colada na borda esquerda. */}
      {selectionMode && (
        <td className={'relative px-2 py-3 align-middle text-center' + (showDivider ? ' border-t border-slate-200 dark:border-white/10' : '')}>
          {accentColor && (
            <span aria-hidden="true" className={`absolute -top-px bottom-0 left-0 w-[3px] ${accentColor}`} />
          )}
          <input
            type="checkbox"
            checked={selected}
            onClick={(e) => e.stopPropagation()}
            onChange={() => onToggleSelect?.(deal.id)}
            aria-label={`Selecionar ${deal.title}`}
            className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-primary-600 focus:ring-primary-500 cursor-pointer align-middle"
          />
        </td>
      )}
      {/* Padding próprio (px-2, não o px-4 das outras células): a coluna do
          ícone é estreita e, com table-fixed, o padding come a largura útil
          em vez de alargar a coluna — o ícone e o selo "Nd" de atraso
          vazariam por cima da coluna do lado. */}
      <td className={CELULA_ALERTA}>
        {selectionMode ? null : accentColor ? (
          <span aria-hidden="true" className={`absolute -top-px bottom-0 left-0 w-[3px] ${accentColor}`} />
        ) : (
          // Filete que aparece no hover: dá o mesmo "trilho" das abas
          // agrupadas sem poluir a lista parada.
          <span
            aria-hidden="true"
            className="absolute -top-px bottom-0 left-0 w-[3px] bg-primary-500 opacity-0 transition-opacity group-hover:opacity-100"
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

      <td className={CELULA}>
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

      <td className={CELULA}>
        {canEditTags ? (
          <>
            {/* Célula clicável: abre o dropdown de tags, como estágio/responsável */}
            <button
              ref={tagsTriggerRef}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleTagsMenu(deal.id);
              }}
              aria-haspopup="listbox"
              aria-expanded={isTagsMenuOpen}
              aria-label={
                deal.tags.length > 0 ? `Tags: ${deal.tags.join(', ')}. Clique para editar.` : 'Adicionar tags'
              }
              title="Adicionar/remover tags"
              className="-mx-1.5 flex max-w-full flex-wrap items-center gap-1 rounded-md px-1.5 py-1 text-left transition-colors focus-visible-ring hover:bg-slate-100 dark:hover:bg-white/10"
            >
              {deal.tags.length > 0 ? (
                <>
                  {deal.tags.slice(0, 2).map((tag, index) => (
                    <span key={`${deal.id}-tag-${index}`} title={tag} className={`max-w-full truncate ${PILL_BASE} ${PILL_NEUTRO}`}>
                      {tag}
                    </span>
                  ))}
                  {deal.tags.length > 2 && (
                    <span
                      title={deal.tags.slice(2).join(', ')}
                      className={`${PILL_BASE} bg-slate-100 text-slate-500 ring-slate-200/70 dark:bg-white/[0.06] dark:text-slate-400 dark:ring-white/10`}
                    >
                      +{deal.tags.length - 2}
                    </span>
                  )}
                </>
              ) : (
                <span className="text-slate-300 dark:text-slate-600">—</span>
              )}
              <ChevronDown
                size={12}
                aria-hidden="true"
                className={`shrink-0 text-slate-400 opacity-60 transition-transform ${isTagsMenuOpen ? 'rotate-180' : ''}`}
              />
            </button>

            {isTagsMenuOpen && tagsMenuPos && typeof document !== 'undefined'
              ? createPortal(
                  <FocusTrap active={isTagsMenuOpen} onEscape={onCloseTagsMenu} initialFocus={`#tags-input-${deal.id}`} returnFocus>
                    <div
                      ref={tagsMenuRef}
                      role="listbox"
                      aria-label="Tags do lead"
                      aria-multiselectable="true"
                      style={{ position: 'fixed', top: tagsMenuPos.top, left: tagsMenuPos.left, width: 220 }}
                      className="z-[9999] max-h-[280px] overflow-y-auto scrollbar-custom rounded-xl bg-white p-1.5 shadow-2xl ring-1 ring-slate-200 dark:bg-slate-800 dark:ring-white/10 animate-in fade-in zoom-in-95 duration-100"
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <p className="px-2 pb-1.5 pt-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">Tags</p>
                      {/* Nova tag: Enter adiciona no lead na hora */}
                      <input
                        id={`tags-input-${deal.id}`}
                        value={novaTag}
                        onChange={(e) => setNovaTag(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            adicionarNovaTag();
                          }
                          e.stopPropagation();
                        }}
                        placeholder="Nova tag + Enter"
                        maxLength={60}
                        className="mb-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-800 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 dark:border-white/10 dark:bg-white/5 dark:text-slate-100"
                      />
                      {opcoesDeTags.length === 0 ? (
                        <p className="px-2.5 py-2 text-xs text-slate-400">Sem tags neste quadro ainda.</p>
                      ) : (
                        opcoesDeTags.map((tag) => {
                          const marcada = deal.tags.some((t) => t.toLowerCase() === tag.toLowerCase());
                          return (
                            <button
                              key={tag.toLowerCase()}
                              type="button"
                              role="option"
                              aria-selected={marcada}
                              onClick={() => alternarTag(tag)}
                              className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm focus-visible-ring hover:bg-slate-100 dark:hover:bg-white/10 ${
                                marcada
                                  ? 'bg-primary-500/10 font-semibold text-primary-600 dark:text-primary-300'
                                  : 'text-slate-700 dark:text-slate-200'
                              }`}
                            >
                              <span
                                aria-hidden="true"
                                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                                  marcada
                                    ? 'border-primary-500 bg-primary-500 text-white'
                                    : 'border-slate-300 dark:border-slate-600'
                                }`}
                              >
                                {marcada && <Check size={11} />}
                              </span>
                              <span className="flex-1 truncate">{tag}</span>
                            </button>
                          );
                        })
                      )}
                    </div>
                  </FocusTrap>,
                  document.body
                )
              : null}
          </>
        ) : deal.tags.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1">
            {deal.tags.slice(0, 2).map((tag, index) => (
              <span
                key={`${deal.id}-tag-${index}`}
                title={tag}
                className={`max-w-full truncate ${PILL_BASE} ${PILL_NEUTRO}`}
              >
                {tag}
              </span>
            ))}
            {deal.tags.length > 2 && (
              <span
                title={deal.tags.slice(2).join(', ')}
                className={`${PILL_BASE} bg-slate-100 text-slate-500 ring-slate-200/70 dark:bg-white/[0.06] dark:text-slate-400 dark:ring-white/10`}
              >
                +{deal.tags.length - 2}
              </span>
            )}
          </div>
        ) : (
          <span className="text-slate-300 dark:text-slate-600">—</span>
        )}
      </td>

      <td className={CELULA}>
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
              className={`max-w-full pr-1.5 transition-colors focus-visible-ring hover:brightness-[0.97] dark:hover:brightness-125 ${PILL_BASE} ${stagePillClasses}`}
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
          <span className={`max-w-full ${PILL_BASE} ${stagePillClasses}`}>
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

      <td className={CELULA}>
        <span className="font-semibold tabular-nums text-slate-800 dark:text-slate-100">
          {formatValor(deal.value)}
        </span>
      </td>

      <td className={CELULA}>
        {canAssignOwner ? (
          <>
            <button
              ref={ownerTriggerRef}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleOwnerMenu(deal.id);
              }}
              aria-haspopup="listbox"
              aria-expanded={isOwnerMenuOpen}
              aria-label="Mudar responsável"
              title="Mudar responsável"
              className="-mx-1.5 inline-flex max-w-full items-center gap-1 rounded-md px-1.5 py-1 transition-colors focus-visible-ring hover:bg-slate-100 dark:hover:bg-white/10"
            >
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
              <ChevronDown
                size={12}
                aria-hidden="true"
                className={`shrink-0 text-slate-400 transition-transform ${isOwnerMenuOpen ? 'rotate-180' : ''}`}
              />
            </button>

            {isOwnerMenuOpen && ownerMenuPos && typeof document !== 'undefined'
              ? createPortal(
                  <FocusTrap
                    active={isOwnerMenuOpen}
                    onEscape={onCloseOwnerMenu}
                    initialFocus={`#owner-opt-${deal.id}-${deal.ownerId || 'none'}`}
                    returnFocus
                  >
                    <div
                      ref={ownerMenuRef}
                      role="listbox"
                      aria-label="Responsáveis disponíveis"
                      style={{ position: 'fixed', top: ownerMenuPos.top, left: ownerMenuPos.left, width: 220 }}
                      className="z-[9999] max-h-[280px] overflow-y-auto scrollbar-custom rounded-xl bg-white p-1.5 shadow-2xl ring-1 ring-slate-200 dark:bg-slate-800 dark:ring-white/10 animate-in fade-in zoom-in-95 duration-100"
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <p className="px-2 pb-1.5 pt-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">
                        Responsável
                      </p>
                      <button
                        id={`owner-opt-${deal.id}-none`}
                        type="button"
                        role="option"
                        aria-selected={!deal.ownerId}
                        onClick={() => {
                          onChangeOwner(deal.id, '');
                          onCloseOwnerMenu();
                        }}
                        className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm focus-visible-ring hover:bg-slate-100 dark:hover:bg-white/10 ${
                          !deal.ownerId
                            ? 'bg-primary-500/10 font-semibold text-primary-600 dark:text-primary-300'
                            : 'text-slate-600 dark:text-slate-300'
                        }`}
                      >
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-dashed border-slate-300 text-slate-400 dark:border-slate-600">
                          <UserPlus size={12} aria-hidden="true" />
                        </span>
                        <span className="flex-1 truncate">Sem responsável</span>
                        {!deal.ownerId && <Check size={14} className="shrink-0" aria-hidden="true" />}
                      </button>
                      {assignableMembers.map((membro) => (
                        <button
                          key={membro.id}
                          id={`owner-opt-${deal.id}-${membro.id}`}
                          type="button"
                          role="option"
                          aria-selected={membro.id === deal.ownerId}
                          onClick={() => {
                            onChangeOwner(deal.id, membro.id);
                            onCloseOwnerMenu();
                          }}
                          className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm focus-visible-ring hover:bg-slate-100 dark:hover:bg-white/10 ${
                            membro.id === deal.ownerId
                              ? 'bg-primary-500/10 font-semibold text-primary-600 dark:text-primary-300'
                              : 'text-slate-700 dark:text-slate-200'
                          }`}
                        >
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary-500 to-primary-600 text-[10px] font-bold text-white">
                            {iniciais(membro.name)}
                          </span>
                          <span className="flex-1 truncate">
                            {membro.name}
                            {membro.role === 'admin' ? ' (admin)' : ''}
                          </span>
                          {membro.id === deal.ownerId && <Check size={14} className="shrink-0" aria-hidden="true" />}
                        </button>
                      ))}
                    </div>
                  </FocusTrap>,
                  document.body
                )
              : null}
          </>
        ) : deal.ownerId ? (
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

      <td className={CELULA}>
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
        <td key={field.id} className={`${CELULA} text-right text-sm text-slate-600 dark:text-slate-300`}>
          {deal.customFields?.[field.key] || <span className="text-slate-300 dark:text-slate-600">—</span>}
        </td>
      ))}
    </tr>
  );
});
