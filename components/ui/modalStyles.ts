/**
 * Modal design tokens (Tailwind class strings).
 *
 * Goal: keep all modals visually/behaviorally coherent:
 * - consistent overlay (color + blur + padding)
 * - consistent panel (radius + border + shadow)
 * - consistent viewport caps (no overflow on small screens)
 * - consistent header/body/footer spacing
 */
export const MODAL_OVERLAY_CLASS =
  // Use a very high z-index so modals never render behind fixed sidebars/overlays.
  // On desktop, avoid covering the left navigation sidebar by offsetting from `--app-sidebar-width`.
  'fixed inset-0 md:left-[var(--app-sidebar-width,0px)] z-[9999] flex items-stretch sm:items-center justify-center bg-slate-900/60 backdrop-blur-sm p-2 sm:p-4';

export const MODAL_PANEL_BASE_CLASS =
  'bg-white dark:bg-dark-card border border-slate-200 dark:border-white/10 shadow-2xl w-full flex flex-col overflow-hidden rounded-xl sm:rounded-2xl';

// Hard caps to avoid overflow. `dvh` is more stable on mobile browser chrome than `vh`.
export const MODAL_VIEWPORT_CAP_CLASS =
  // UX: default modals should not feel "full screen". Keep room around them.
  'max-h-[calc(90dvh-1rem)] sm:max-h-[calc(90dvh-2rem)]';

export const MODAL_HEADER_CLASS =
  'p-3 sm:p-4 border-b border-slate-200 dark:border-white/10 flex items-center justify-between shrink-0';

export const MODAL_TITLE_CLASS =
  'text-base sm:text-lg font-bold text-slate-900 dark:text-white font-display';

export const MODAL_CLOSE_BUTTON_CLASS =
  'p-2 hover:bg-slate-100 dark:hover:bg-white/5 rounded-lg transition-colors focus-visible-ring';

// min-h-0 + overflow: quando o conteúdo passa do teto de altura do painel
// (90dvh), o corpo ROLA em vez de ser cortado (o painel tem overflow-hidden).
// Modais que já definem a própria rolagem via bodyClassName continuam valendo.
export const MODAL_BODY_CLASS = 'p-4 sm:p-5 min-h-0 overflow-y-auto';

export const MODAL_FOOTER_CLASS =
  'p-4 sm:p-5 border-t border-slate-200 dark:border-white/10 bg-white dark:bg-dark-card shrink-0';

