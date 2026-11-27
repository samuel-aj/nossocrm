/** Quantos avisos de cada grupo o sino mostra antes de "Ver anteriores". */
export const RECENT_LIMIT = 5;
/** Idade máxima, em dias, de um aviso comum para abrir já visível no sino. */
export const RECENT_DAYS = 7;

const DAY_MS = 86_400_000;

export function isRecentDate(date: Date, days = RECENT_DAYS, now = Date.now()) {
  return now - date.getTime() <= days * DAY_MS;
}

/**
 * Separa a lista (já ordenada do mais novo para o mais antigo) em "recentes" e "anteriores".
 * Nada é descartado: o que não entra em `recent` fica em `older`, na mesma ordem.
 */
export function splitRecent<T>(
  items: readonly T[],
  isRecent: (item: T) => boolean,
  mustShow?: (item: T) => boolean,
) {
  let available = RECENT_LIMIT - (mustShow ? items.filter(mustShow).length : 0);
  const recent: T[] = [];
  const older: T[] = [];
  for (const item of items) {
    if (mustShow?.(item)) {
      recent.push(item);
    } else if (available > 0 && isRecent(item)) {
      recent.push(item);
      available--;
    } else {
      older.push(item);
    }
  }
  return { recent, older };
}
