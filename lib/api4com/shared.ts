/**
 * API4com: tipos e regras puras compartilhadas entre servidor e navegador
 * (estado da ligação, resultado a partir da causa de desligamento, rótulos).
 */

export type CallStatus = 'dialing' | 'ringing' | 'answered' | 'ended' | 'failed';
export type CallResult = 'answered' | 'no_answer' | 'busy' | 'voicemail' | 'invalid' | 'cancelled' | 'failed';

export type CallRow = {
  id: string;
  organization_id: string;
  user_id: string;
  deal_id: string | null;
  contact_id: string | null;
  called: string;
  extension: string | null;
  call_id: string | null;
  status: CallStatus;
  result: CallResult | null;
  started_at: string;
  answered_at: string | null;
  ended_at: string | null;
  duration: number | null;
  hangup_cause: string | null;
  hangup_cause_code: string | null;
  record_url: string | null;
  error: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

export const STATUS_LABEL: Record<CallStatus, string> = {
  dialing: 'Chamando o seu Webphone',
  ringing: 'Chamando o cliente',
  answered: 'Em ligação',
  ended: 'Ligação encerrada',
  failed: 'Não foi possível ligar',
};

export const RESULT_LABEL: Record<CallResult, string> = {
  answered: 'Atendida',
  no_answer: 'Não atendida',
  busy: 'Ocupado',
  voicemail: 'Caixa postal',
  invalid: 'Número inválido',
  cancelled: 'Cancelada',
  failed: 'Falhou',
};

/** Causa de desligamento da API4com (FreeSWITCH) -> resultado que o CRM mostra. */
export function resultFor(cause: string | null | undefined, duration: number): CallResult {
  const c = (cause ?? '').trim().toUpperCase();
  if (c === 'NORMAL_CLEARING' && duration > 0) return 'answered';
  if (c === 'USER_BUSY') return 'busy';
  if (c === 'NUMBER_CHANGED') return 'voicemail';
  if (c === 'UNALLOCATED_NUMBER' || c === 'INVALID_NUMBER_FORMAT') return 'invalid';
  if (c === 'ORIGINATOR_CANCEL') return 'cancelled';
  if (c === 'NO_ANSWER' || c === 'NORMAL_CLEARING' || c === 'ALLOTTED_TIMEOUT' || c === 'NO_USER_RESPONSE') return 'no_answer';
  return duration > 0 ? 'answered' : 'failed';
}

/** 269 -> "4 min 29 s"; 35 -> "35 s". */
export function formatDuration(seconds: number | null | undefined): string {
  const s = Math.max(0, Math.round(Number(seconds ?? 0)));
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m === 0) return `${r} s`;
  return r === 0 ? `${m} min` : `${m} min ${r} s`;
}

/** +5511987654321 -> "+55 11 98765-4321" (só para mostrar). */
export function formatPhone(e164: string): string {
  // A central às vezes manda o número sem o "+" (5511987654321)
  const m = /^\+?55(\d{2})(\d{4,5})(\d{4})$/.exec(e164);
  if (m) return `+55 ${m[1]} ${m[2]}-${m[3]}`;
  return e164;
}

/** Dados para o telefone embutido no CRM se registrar no ramal (SIP por WSS). */
export type SipCredentials = {
  wsUrl: string;
  uri: string;
  username: string;
  password: string;
  realm: string;
};
