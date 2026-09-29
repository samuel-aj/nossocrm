/** Cores determinísticas pros marcadores de tag (hash do nome → paleta fixa). */
const TAG_MARKER_STYLES = [
  { dot: 'bg-rose-500', chip: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/30' },
  { dot: 'bg-amber-500', chip: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30' },
  { dot: 'bg-emerald-500', chip: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/30' },
  { dot: 'bg-sky-500', chip: 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-500/10 dark:text-sky-300 dark:border-sky-500/30' },
  { dot: 'bg-violet-500', chip: 'bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-500/10 dark:text-violet-300 dark:border-violet-500/30' },
  { dot: 'bg-fuchsia-500', chip: 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200 dark:bg-fuchsia-500/10 dark:text-fuchsia-300 dark:border-fuchsia-500/30' },
  { dot: 'bg-teal-500', chip: 'bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-500/10 dark:text-teal-300 dark:border-teal-500/30' },
  { dot: 'bg-orange-500', chip: 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-500/10 dark:text-orange-300 dark:border-orange-500/30' },
];

export function tagMarkerStyle(tag: string) {
  let h = 0;
  for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) >>> 0;
  return TAG_MARKER_STYLES[h % TAG_MARKER_STYLES.length];
}
