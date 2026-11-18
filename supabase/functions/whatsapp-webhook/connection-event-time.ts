/** Only a source timestamp can order a retried callback relative to an active probe. */
export function connectionEventTime(value: unknown, now = Date.now()): string | null {
  let ms: number;
  if (typeof value === 'number' || (typeof value === 'string' && /^\d{10,13}$/.test(value))) {
    const epoch = Number(value);
    ms = epoch < 1e11 ? epoch * 1000 : epoch;
  } else if (typeof value === 'string' && /(Z|[+-]\d\d:\d\d)$/i.test(value)) {
    ms = Date.parse(value);
  } else {
    return null;
  }
  if (!Number.isFinite(ms) || ms < Date.UTC(2000, 0) || ms > now + 30_000) return null;
  return new Date(Math.min(ms, now)).toISOString();
}
