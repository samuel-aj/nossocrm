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

export interface EvolutionConnectionDetails {
  state?: unknown;
  status?: unknown;
  date_time?: unknown;
  disconnectionAt?: unknown;
  statusReason?: unknown;
  disconnectionReasonCode?: unknown;
  lastDisconnect?: { error?: { output?: { statusCode?: unknown } } };
}

/** Only copy documented numeric socket codes. Raw errors may contain credentials or contact data. */
export function evolutionDisconnectReason(data?: EvolutionConnectionDetails | null): string | undefined {
  for (const value of [data?.disconnectionReasonCode, data?.statusReason, data?.lastDisconnect?.error?.output?.statusCode]) {
    if ((typeof value === 'number' || typeof value === 'string') && /^[4-5]\d{2}$/.test(String(value))) {
      return `evolution_disconnect_${value}`;
    }
  }
}

export function evolutionConnectionEvent(event: string, data: EvolutionConnectionDetails | null, envelopeTime: unknown) {
  const providerState = event === 'status.instance' ? data?.status : data?.state;
  const state = providerState === 'open' ? 'connected' : providerState === 'connecting' ? 'connecting'
    : ['close', 'closed', 'disconnected', 'refused'].includes(String(providerState)) ? 'disconnected' : 'unknown';
  const emittedAt = (event === 'status.instance' ? connectionEventTime(data?.disconnectionAt) : null)
    ?? connectionEventTime(envelopeTime) ?? connectionEventTime(data?.date_time);
  const code = state === 'disconnected' ? evolutionDisconnectReason(data) : undefined;
  if (!emittedAt) return { state: 'unknown', emittedAt, reason: code ? `webhook_undated_${code}` : 'webhook_undated' };
  return { state, emittedAt, reason: code ?? (state === 'unknown' ? 'webhook_unknown_state' : state) };
}
