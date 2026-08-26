/**
 * Janela de atendimento de 24 h da API oficial do WhatsApp (Meta Cloud).
 *
 * Regra da Meta: o número só pode mandar mensagem LIVRE (texto, mídia, áudio)
 * durante 24 h contadas da ÚLTIMA MENSAGEM RECEBIDA do contato. Passado isso,
 * só entra um MODELO aprovado (template) — e a janela reabre quando o contato
 * responder. Módulo puro (sem React/Supabase): vale no cliente e em teste.
 */

/** Duração da janela de atendimento da Meta: 24 h em milissegundos */
export const META_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface ServiceWindow {
  /** true = ainda dá pra mandar mensagem livre */
  open: boolean;
  /** Instante (epoch ms) em que a janela fecha; null = sem mensagem recebida */
  expiresAt: number | null;
  /** Quanto falta pra fechar (ms); 0 quando fechada ou sem mensagem recebida */
  remainingMs: number;
}

/**
 * Calcula a janela a partir da última mensagem recebida (ISO 8601 / timestamptz).
 * Sem mensagem recebida (ou data inválida) = janela fechada, sem prazo.
 */
export function getServiceWindow(
  lastInboundAt: string | null | undefined,
  now: number = Date.now()
): ServiceWindow {
  if (!lastInboundAt) return { open: false, expiresAt: null, remainingMs: 0 };
  const receivedAt = Date.parse(lastInboundAt);
  if (!Number.isFinite(receivedAt)) return { open: false, expiresAt: null, remainingMs: 0 };
  const expiresAt = receivedAt + META_WINDOW_MS;
  const remainingMs = Math.max(0, expiresAt - now);
  return { open: remainingMs > 0, expiresAt, remainingMs };
}

/** Tempo restante pra faixa do chat: "5 h 12 min" / "45 min" / "menos de 1 min" */
export function formatRemaining(ms: number): string {
  const totalMin = Math.floor(Math.max(0, ms) / 60_000);
  if (totalMin < 1) return 'menos de 1 min';
  const h = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  if (h === 0) return `${min} min`;
  return min === 0 ? `${h} h` : `${h} h ${min} min`;
}
