/**
 * "Digitando..." do agente: quanto tempo ele fica com a presença de digitação
 * antes de mandar cada linha. O tempo vem do TAMANHO do texto (mensagem maior,
 * mais tempo digitando), entre um mínimo e um máximo, para o atendimento não
 * parecer um robô cuspindo mensagens instantâneas.
 *
 * CLIENT-SAFE: só funções puras (o editor usa para mostrar a prévia).
 */
import type { AgentTyping } from './types';

/**
 * Milissegundos de digitação para `text`. 0 quando está desligado ou o texto é
 * vazio. Configuração invertida (mínimo maior que o máximo) não trava o envio:
 * o maior dos dois vira o teto.
 */
export function typingDelayMs(text: string, cfg: AgentTyping | null | undefined): number {
  if (!cfg?.enabled) return 0;
  const chars = (text ?? '').trim().length;
  if (chars === 0) return 0;
  const min = Math.max(0, cfg.min_ms);
  const max = Math.max(min, cfg.max_ms);
  return Math.round(Math.min(Math.max(chars * cfg.ms_per_char, min), max));
}

/** Tempo em segundos, arredondado para uma casa ("3,2 s"), para mostrar na tela. */
export function typingSecondsLabel(ms: number): string {
  return (ms / 1000).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}
